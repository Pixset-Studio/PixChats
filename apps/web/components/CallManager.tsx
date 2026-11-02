'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  getCurrentProfile,
  getCachedCurrentProfile,
  getSupabaseClient,
  sendMessage,
} from '@pixchats/core';
import type { Profile } from '@pixchats/core';
import { getNotificationPrefs } from '../lib/notificationPrefs';
import {
  triggerIncomingCallNativeAlert,
  stopIncomingCallNativeAlert,
  isMobilePhoneDevice,
} from '../lib/nativePlatform';
import { AvatarWithStatus } from './AvatarWithStatus';
import {
  getPreferredAudioConstraints,
  getPreferredVideoConstraints,
  getPreferredMediaDevices,
} from '../lib/mediaDevicesStore';

export interface StartCallParams {
  targetUserId: string;
  targetName: string;
  targetAvatar?: string | null;
  chatId?: string;
  mode: 'audio' | 'video';
}

export interface StartGroupCallParams {
  chatId: string;
  chatTitle: string;
  chatAvatar?: string | null;
  mode?: 'audio' | 'video';
  joinOnly?: boolean;
}

export function startPixChatsCall(params: StartCallParams): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<StartCallParams>('pixchats:start_call', { detail: params }));
}

export function startPixChatsGroupCall(params: StartGroupCallParams): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<StartGroupCallParams>('pixchats:start_group_call', { detail: params })
  );
}

interface CallParticipant {
  id: string;
  name: string;
  avatar?: string | null;
}

interface ActiveCallSession {
  callId: string;
  chatId?: string;
  peerId: string;
  peerName: string;
  peerAvatar?: string | null;
  mode: 'audio' | 'video';
  direction: 'outgoing' | 'incoming';
  status: 'ringing' | 'connecting' | 'connected';
  isGroup?: boolean;
  callerIsDeveloper?: boolean;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 10,
};

const RELAY_SAMPLE_RATE = 16000;

function enhanceOpusSdp(sdp?: string): string | undefined {
  if (!sdp) return sdp;
  try {
    return sdp.replace(
      /a=fmtp:(\d+) minptime=10;useinbandfec=1/g,
      'a=fmtp:$1 minptime=10;useinbandfec=1;stereo=0;sprop-stereo=0;maxaveragebitrate=64000;cbr=0'
    );
  } catch {
    return sdp;
  }
}

function encodeInt16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunkSize) as unknown as number[]
    );
  }
  return btoa(binary);
}

function decodeBase64ToInt16(b64: string): Int16Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Генерирует компактный WAV-файл мелодии вызова в памяти (Data URI),
 * чтобы рингтон гарантированно звучал через HTML5 <audio> на мобильных устройствах и ПК.
 */
function createRingtoneWavDataUrl(isIncoming: boolean): string {
  try {
    const sampleRate = 8000;
    const durationSec = 1.6;
    const numSamples = Math.floor(sampleRate * durationSec);
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      let sample = 0;
      if (isIncoming) {
        if (t < 0.22) {
          sample = Math.sin(2 * Math.PI * 523.25 * t) * 0.35;
        } else if (t >= 0.24 && t < 0.46) {
          sample = Math.sin(2 * Math.PI * 659.25 * t) * 0.35;
        } else if (t >= 0.48 && t < 0.72) {
          sample = Math.sin(2 * Math.PI * 783.99 * t) * 0.38;
        } else if (t >= 0.75 && t < 1.1) {
          sample = Math.sin(2 * Math.PI * 1046.5 * t) * Math.exp(-(t - 0.75) * 4) * 0.4;
        }
      } else {
        if (t < 0.7) {
          sample = Math.sin(2 * Math.PI * 440 * t) * 0.25;
        }
      }
      const pcm = Math.max(-1, Math.min(1, sample));
      view.setInt16(44 + i * 2, pcm * 32767, true);
    }

    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `data:audio/wav;base64,${btoa(binary)}`;
  } catch {
    return '';
  }
}

export function CallManager() {
  const [me, setMe] = useState<Profile | null>(() => getCachedCurrentProfile());
  const [session, setSession] = useState<ActiveCallSession | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [remoteWebrtcVideoReady, setRemoteWebrtcVideoReady] = useState(false);
  const [remoteRelayFrame, setRemoteRelayFrame] = useState<string | null>(null);
  const [groupParticipants, setGroupParticipants] = useState<CallParticipant[]>([]);
  const [speakingUsers, setSpeakingUsers] = useState<Record<string, boolean>>({});
  const [callNotice, setCallNotice] = useState<string | null>(null);
  const [speakerphoneActive, setSpeakerphoneActive] = useState<boolean>(true);
  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment'>('user');
  const [isMobilePhone, setIsMobilePhone] = useState<boolean>(() => isMobilePhoneDevice());

  useEffect(() => {
    setIsMobilePhone(isMobilePhoneDevice());
  }, []);

  const meRef = useRef<Profile | null>(me);
  meRef.current = me;

  const micMutedRef = useRef<boolean>(false);
  micMutedRef.current = micMuted;

  const sessionRef = useRef<ActiveCallSession | null>(null);
  sessionRef.current = session;

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const roomChannelRef = useRef<any>(null);
  const globalCallChannelRef = useRef<any>(null);
  const inviteRetryTimerRef = useRef<any>(null);
  const inviteTargetChannelRef = useRef<any>(null);
  const dismissedCallIdsRef = useRef<Set<string>>(new Set());

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const makingOfferRef = useRef<boolean>(false);
  const acceptRetryTimerRef = useRef<any>(null);
  const ringtoneTimerRef = useRef<any>(null);
  const ringtoneAudioElRef = useRef<HTMLAudioElement | null>(null);
  const sharedAudioCtxRef = useRef<AudioContext | null>(null);
  const durationRef = useRef<number>(0);

  // Ресурсы голосового ретранслятора (используется ТОЛЬКО для групповых чатов или при полном отказе ICE)
  const micSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micProcessorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const micZeroGainRef = useRef<GainNode | null>(null);
  const nextPlayTimeBySenderRef = useRef<Record<string, number>>({});
  const speakingTimersRef = useRef<Record<string, any>>({});
  const webrtcAudioActiveRef = useRef<boolean>(false);
  const statsTimerRef = useRef<any>(null);

  function showTransientCallNotice(msg: string) {
    setCallNotice(msg);
    setTimeout(() => {
      setCallNotice((prev) => (prev === msg ? null : prev));
    }, 3200);
  }

  function getOrResumeAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      if (!sharedAudioCtxRef.current || sharedAudioCtxRef.current.state === 'closed') {
        sharedAudioCtxRef.current = new AudioCtx();
      }
      if (sharedAudioCtxRef.current.state === 'suspended') {
        void sharedAudioCtxRef.current.resume().catch(() => {});
      }
      return sharedAudioCtxRef.current;
    } catch {
      return null;
    }
  }

  function unlockAudioElements() {
    getOrResumeAudioContext();
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = false;
      remoteAudioRef.current.volume = 1.0;
      if (remoteAudioRef.current.srcObject) {
        void remoteAudioRef.current.play().catch(() => {});
      }
    }
  }

  // Разблокируем аудио-движок при первом касании экрана на телефоне/ПК
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const unlockAudio = () => {
      unlockAudioElements();
    };
    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('touchstart', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, []);

  function markSpeakerActive(senderId?: string) {
    if (!senderId) return;
    setSpeakingUsers((prev) => (prev[senderId] ? prev : { ...prev, [senderId]: true }));
    if (speakingTimersRef.current[senderId]) {
      clearTimeout(speakingTimersRef.current[senderId]);
    }
    speakingTimersRef.current[senderId] = setTimeout(() => {
      setSpeakingUsers((prev) => {
        if (!prev[senderId]) return prev;
        const copy = { ...prev };
        delete copy[senderId];
        return copy;
      });
    }, 700);
  }

  // Воспроизведение полученного PCM-фрагмента голоса через Web Audio API (для групповых чатов или резерва при блоке UDP)
  function playRemotePcmChunk(base64Pcm: string, sampleRate: number, senderId?: string) {
    // В личном звонке НИКОГДА не накладываем PCM поверх живого WebRTC потока, чтобы не было эффекта фильтра/эха!
    const currentSess = sessionRef.current;
    if (currentSess && !currentSess.isGroup && webrtcAudioActiveRef.current) {
      return;
    }

    try {
      const ctx = getOrResumeAudioContext();
      if (!ctx) return;

      const int16 = decodeBase64ToInt16(base64Pcm);
      if (int16.length === 0) return;

      const rate = sampleRate > 0 ? sampleRate : RELAY_SAMPLE_RATE;
      const audioBuffer = ctx.createBuffer(1, int16.length, rate);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < int16.length; i++) {
        channelData[i] = int16[i] / 32768.0;
      }

      const key = senderId || 'default-peer';
      const now = ctx.currentTime;
      let nextTime = nextPlayTimeBySenderRef.current[key] || 0;
      if (nextTime < now || nextTime > now + 0.5) {
        nextTime = now + 0.03;
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      const gainNode = ctx.createGain();
      gainNode.gain.value = 1.0;

      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      source.start(nextTime);
      nextPlayTimeBySenderRef.current[key] = nextTime + audioBuffer.duration;
    } catch {}
  }

  function stopVoicePcmRelay() {
    if (statsTimerRef.current) {
      clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
    }
    if (micProcessorNodeRef.current) {
      try {
        micProcessorNodeRef.current.onaudioprocess = null;
        micProcessorNodeRef.current.disconnect();
      } catch {}
      micProcessorNodeRef.current = null;
    }
    if (micSourceNodeRef.current) {
      try {
        micSourceNodeRef.current.disconnect();
      } catch {}
      micSourceNodeRef.current = null;
    }
    if (micZeroGainRef.current) {
      try {
        micZeroGainRef.current.disconnect();
      } catch {}
      micZeroGainRef.current = null;
    }
    nextPlayTimeBySenderRef.current = {};
    Object.values(speakingTimersRef.current).forEach((t) => clearTimeout(t));
    speakingTimersRef.current = {};
    setSpeakingUsers({});
    webrtcAudioActiveRef.current = false;
  }

  function startVoicePcmRelay(localStream: MediaStream) {
    stopVoicePcmRelay();
    if (localStream.getAudioTracks().length === 0) return;

    try {
      const ctx = getOrResumeAudioContext();
      if (!ctx) return;

      const source = ctx.createMediaStreamSource(localStream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const zeroGain = ctx.createGain();
      zeroGain.gain.value = 0;

      const inputSampleRate = ctx.sampleRate || 48000;
      const ratio = inputSampleRate / RELAY_SAMPLE_RATE;
      let pendingSamples: number[] = [];
      let trailingSilenceChunks = 0;

      processor.onaudioprocess = (e) => {
        if (micMutedRef.current) {
          pendingSamples = [];
          return;
        }
        const sess = sessionRef.current;
        if (!sess || !roomChannelRef.current) return;
        if (sess.status !== 'connected' && sess.status !== 'connecting') return;

        const input = e.inputBuffer.getChannelData(0);
        let sumSq = 0;
        for (let i = 0; i < input.length; i++) {
          sumSq += input[i] * input[i];
        }
        const rms = Math.sqrt(sumSq / input.length);

        if (rms > 0.001) {
          if (meRef.current?.id) {
            markSpeakerActive(meRef.current.id);
          }
          trailingSilenceChunks = 3;
        } else if (trailingSilenceChunks > 0) {
          trailingSilenceChunks--;
        } else {
          pendingSamples = [];
          return;
        }

        // Если это личный звонок 1-на-1 и прямое WebRTC-соединение активно — не шлём лишний PCM по WebSocket
        if (!sess.isGroup && webrtcAudioActiveRef.current) {
          pendingSamples = [];
          return;
        }

        // Анти-алиасинг фильтр (boxcar averaging) при даунсэмплинге до 16 кГц, чтобы голос звучал чисто без эффекта робота
        const outLength = Math.floor(input.length / ratio);
        for (let i = 0; i < outLength; i++) {
          const startIdx = Math.floor(i * ratio);
          const endIdx = Math.min(input.length, Math.max(startIdx + 1, Math.floor((i + 1) * ratio)));
          let acc = 0;
          for (let j = startIdx; j < endIdx; j++) {
            acc += input[j];
          }
          const avg = acc / (endIdx - startIdx);
          const s = Math.max(-1, Math.min(1, avg));
          pendingSamples.push(s < 0 ? s * 0x8000 : s * 0x7fff);
        }

        // Отправляем пакет каждые ~150 мс (2400 сэмплов при 16 кГц)
        if (pendingSamples.length >= 2400) {
          const int16 = new Int16Array(pendingSamples);
          pendingSamples = [];
          const b64 = encodeInt16ToBase64(int16);
          try {
            roomChannelRef.current.send({
              type: 'broadcast',
              event: 'voice-pcm',
              payload: {
                senderId: meRef.current?.id,
                sr: RELAY_SAMPLE_RATE,
                pcm: b64,
              },
            });
          } catch {}
        }
      };

      source.connect(processor);
      processor.connect(zeroGain);
      zeroGain.connect(ctx.destination);

      micSourceNodeRef.current = source;
      micProcessorNodeRef.current = processor;
      micZeroGainRef.current = zeroGain;
    } catch {}

    // Мониторим состояние WebRTC, чтобы в 1-на-1 звонках работал чистый 48kHz Opus без наложения PCM
    statsTimerRef.current = setInterval(() => {
      const pc = pcRef.current;
      const sess = sessionRef.current;
      if (!pc || !sess || sess.isGroup) {
        webrtcAudioActiveRef.current = false;
        return;
      }
      const ice = pc.iceConnectionState;
      const conn = pc.connectionState;
      const hasLiveRemoteAudioTrack = Boolean(
        remoteStreamRef.current
          ?.getAudioTracks()
          .some((t) => t.readyState === 'live' && t.enabled)
      );
      if (
        (ice === 'connected' || ice === 'completed' || conn === 'connected') &&
        hasLiveRemoteAudioTrack
      ) {
        webrtcAudioActiveRef.current = true;
      } else if (ice === 'failed' || ice === 'disconnected' || ice === 'closed') {
        webrtcAudioActiveRef.current = false;
      }
    }, 600);
  }

  // Звуковой сигнал вызова (HTML5 WAV + Web Audio API + Вибрация)
  function startRingtone(isIncoming: boolean) {
    stopRingtone();
    const prefs = getNotificationPrefs();
    if (!prefs.sound) return;

    try {
      const wavUrl = createRingtoneWavDataUrl(isIncoming);
      if (wavUrl) {
        const audio = new Audio(wavUrl);
        audio.loop = true;
        audio.volume = 0.85;
        void audio.play().catch(() => {});
        ringtoneAudioElRef.current = audio;
      }
    } catch {}

    const playTone = () => {
      try {
        if (isIncoming && typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([500, 250, 500]);
        }
        const ctx = getOrResumeAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        if (isIncoming) {
          osc.frequency.setValueAtTime(523.25, now);
          osc.frequency.setValueAtTime(659.25, now + 0.18);
          osc.frequency.setValueAtTime(783.99, now + 0.36);
        } else {
          osc.frequency.setValueAtTime(440, now);
        }

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.16, now + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.7);
      } catch {}
    };

    playTone();
    ringtoneTimerRef.current = setInterval(playTone, 2000);
  }

  function stopRingtone() {
    if (ringtoneTimerRef.current) {
      clearInterval(ringtoneTimerRef.current);
      ringtoneTimerRef.current = null;
    }
    if (ringtoneAudioElRef.current) {
      try {
        ringtoneAudioElRef.current.pause();
        ringtoneAudioElRef.current.src = '';
      } catch {}
      ringtoneAudioElRef.current = null;
    }
    stopIncomingCallNativeAlert();
  }

  function stopInviteRetryLoop() {
    if (inviteRetryTimerRef.current) {
      clearInterval(inviteRetryTimerRef.current);
      inviteRetryTimerRef.current = null;
    }
    if (inviteTargetChannelRef.current) {
      try {
        getSupabaseClient().removeChannel(inviteTargetChannelRef.current);
      } catch {}
      inviteTargetChannelRef.current = null;
    }
  }

  function isDeveloperUser(profile: Profile | null, extraStr?: string): boolean {
    if (!profile && !extraStr) return false;
    if ((profile as any)?.is_admin) return true;
    const combined = `${profile?.username || ''} ${(profile as any)?.email || ''} ${profile?.display_name || ''} ${extraStr || ''}`.toLowerCase();
    return (
      combined.includes('pixset') ||
      combined.includes('admin') ||
      combined.includes('official') ||
      combined.includes('dev')
    );
  }

  // Таймер длительности активного разговора и 60-минутный лимит
  useEffect(() => {
    if (session?.status !== 'connected') {
      setDurationSec(0);
      durationRef.current = 0;
      return;
    }
    const isDevCall = Boolean(session.callerIsDeveloper);

    const timer = setInterval(() => {
      setDurationSec((prev) => {
        const next = prev + 1;
        durationRef.current = next;

        if (!isDevCall && next >= 3600) {
          clearInterval(timer);
          void handleEndCall();
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [session?.status, session?.callerIsDeveloper]);

  // Автоматический сброс неотвеченного исходящего вызова через 45 секунд
  useEffect(() => {
    if (!session || session.direction !== 'outgoing' || session.status !== 'ringing' || session.isGroup) {
      return;
    }
    const timeout = setTimeout(() => {
      if (sessionRef.current?.status === 'ringing') {
        void handleEndCall();
      }
    }, 45000);
    return () => clearTimeout(timeout);
  }, [session?.callId, session?.status, session?.direction, session?.isGroup]);

  function syncRemoteAudioPlayback() {
    const stream = remoteStreamRef.current;
    if (!stream) return;
    if (remoteAudioRef.current) {
      if (remoteAudioRef.current.srcObject !== stream) {
        remoteAudioRef.current.srcObject = stream;
      }
      const { audioOutputId } = getPreferredMediaDevices();
      if (audioOutputId && typeof (remoteAudioRef.current as any).setSinkId === 'function') {
        void (remoteAudioRef.current as any).setSinkId(audioOutputId).catch(() => {});
      }
      remoteAudioRef.current.muted = false;
      remoteAudioRef.current.volume = 1.0;
      void remoteAudioRef.current.play().catch(() => {});
    }
    if (remoteVideoRef.current && stream.getVideoTracks().length > 0) {
      if (remoteVideoRef.current.srcObject !== stream) {
        remoteVideoRef.current.srcObject = stream;
      }
      remoteVideoRef.current.muted = true; // Звук уже воспроизводится через persistentAudioEl, поэтому video muted для надёжного autoplay
      void remoteVideoRef.current.play().catch(() => {});
    }
  }

  // Привязка локального и удалённого медиа-потоков к video/audio элементам
  useEffect(() => {
    const activeLocalVideoStream = screenStreamRef.current || localStreamRef.current;
    if (localVideoRef.current && activeLocalVideoStream) {
      if (localVideoRef.current.srcObject !== activeLocalVideoStream) {
        localVideoRef.current.srcObject = activeLocalVideoStream;
      }
      void localVideoRef.current.play().catch(() => {});
    }
    syncRemoteAudioPlayback();
  }, [session, minimized, cameraEnabled, screenSharing, hasRemoteVideo]);

  // Независимый захват кадров с активного видеопотока (камера или демонстрация экрана) через offscreen <video>
  // Гарантирует 100% доставку видео собеседнику без серого экрана даже при симметричном NAT или свёрнутом окне!
  useEffect(() => {
    if (!session || (!cameraEnabled && !screenSharing)) return;
    const activeStream = screenSharing
      ? screenStreamRef.current
      : localStreamRef.current;
    if (!activeStream || activeStream.getVideoTracks().length === 0) return;

    const offscreenVid = document.createElement('video');
    offscreenVid.muted = true;
    offscreenVid.playsInline = true;
    offscreenVid.autoplay = true;
    offscreenVid.srcObject = activeStream;
    void offscreenVid.play().catch(() => {});

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const timer = setInterval(() => {
      if (!ctx || !roomChannelRef.current) return;
      const sourceVid =
        offscreenVid.readyState >= 2 && offscreenVid.videoWidth > 0
          ? offscreenVid
          : localVideoRef.current;
      if (!sourceVid || sourceVid.readyState < 2) return;

      const vw = sourceVid.videoWidth || (screenSharing ? 800 : 480);
      const vh = sourceVid.videoHeight || (screenSharing ? 450 : 270);
      const maxW = screenSharing ? 720 : 480;
      const targetW = Math.min(maxW, vw);
      const targetH = Math.max(180, Math.round((vh / vw) * targetW));
      canvas.width = targetW;
      canvas.height = targetH;
      try {
        ctx.drawImage(sourceVid, 0, 0, targetW, targetH);
        const frame = canvas.toDataURL('image/jpeg', screenSharing ? 0.62 : 0.56);
        roomChannelRef.current.send({
          type: 'broadcast',
          event: 'video-frame',
          payload: {
            senderId: meRef.current?.id,
            frame,
            isScreen: screenSharing,
          },
        });
      } catch {}
    }, 150);

    return () => {
      clearInterval(timer);
      try {
        offscreenVid.pause();
        offscreenVid.srcObject = null;
      } catch {}
    };
  }, [session?.callId, cameraEnabled, screenSharing]);

  async function acquireLocalMedia(wantVideo: boolean): Promise<MediaStream> {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      const audioConstraints = getPreferredAudioConstraints({
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
      });
      const videoConstraints = getPreferredVideoConstraints({
        width: { ideal: 1280 },
        height: { ideal: 720 },
      });
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: wantVideo ? videoConstraints : false,
        });
        setCameraEnabled(wantVideo && stream.getVideoTracks().length > 0);
        setMicMuted(false);
        micMutedRef.current = false;
        return stream;
      } catch {
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
          setCameraEnabled(false);
          setMicMuted(false);
          micMutedRef.current = false;
          return fallbackStream;
        } catch {}
      }
    }
    setCameraEnabled(false);
    return new MediaStream();
  }

  function cleanupCallResources() {
    stopRingtone();
    stopInviteRetryLoop();
    stopVoicePcmRelay();

    if (acceptRetryTimerRef.current) {
      clearInterval(acceptRetryTimerRef.current);
      acceptRetryTimerRef.current = null;
    }

    pendingCandidatesRef.current = [];
    makingOfferRef.current = false;

    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {}
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }

    if (remoteAudioRef.current) {
      try {
        remoteAudioRef.current.srcObject = null;
      } catch {}
    }

    remoteStreamRef.current = null;

    if (roomChannelRef.current) {
      try {
        getSupabaseClient().removeChannel(roomChannelRef.current);
      } catch {}
      roomChannelRef.current = null;
    }

    setSession(null);
    setMinimized(false);
    setMicMuted(false);
    micMutedRef.current = false;
    setCameraEnabled(false);
    setScreenSharing(false);
    setHasRemoteVideo(false);
    setRemoteWebrtcVideoReady(false);
    setRemoteRelayFrame(null);
    setGroupParticipants([]);
    setCallNotice(null);
  }

  async function flushPendingIceCandidates(pc: RTCPeerConnection) {
    if (!pc.remoteDescription) return;
    const queued = [...pendingCandidatesRef.current];
    pendingCandidatesRef.current = [];
    for (const cand of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch {}
    }
  }

  async function renegotiatePeerConnection() {
    const pc = pcRef.current;
    const room = roomChannelRef.current;
    if (!pc || !room || makingOfferRef.current) return;
    if (pc.signalingState !== 'stable') return;
    makingOfferRef.current = true;
    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      if (offer.sdp) {
        offer.sdp = enhanceOpusSdp(offer.sdp);
      }
      await pc.setLocalDescription(offer);
      room.send({
        type: 'broadcast',
        event: 'webrtc-offer',
        payload: { senderId: meRef.current?.id, sdp: pc.localDescription || offer },
      });
    } catch {
    } finally {
      makingOfferRef.current = false;
    }
  }

  async function syncOutgoingVideoTrack(newVideoTrack: MediaStreamTrack | null, ownerStream: MediaStream | null) {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      const videoTransceiver = pc.getTransceivers().find(
        (t) => t.sender.track?.kind === 'video' || t.receiver.track?.kind === 'video'
      );
      if (videoTransceiver) {
        await videoTransceiver.sender.replaceTrack(newVideoTrack);
        videoTransceiver.direction = newVideoTrack ? 'sendrecv' : 'recvonly';
      } else if (newVideoTrack && ownerStream) {
        pc.addTrack(newVideoTrack, ownerStream);
      }
      await renegotiatePeerConnection();
    } catch {}
  }

  function createPeerConnection(callId: string, localStream: MediaStream): RTCPeerConnection {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const remoteStream = new MediaStream();
    remoteStreamRef.current = remoteStream;
    pendingCandidatesRef.current = [];

    const localTracks = localStream.getTracks();
    localTracks.forEach((track) => {
      track.enabled = true;
      pc.addTrack(track, localStream);
    });

    if (localStream.getAudioTracks().length === 0) {
      try {
        pc.addTransceiver('audio', { direction: 'recvonly' });
      } catch {}
    }
    if (localStream.getVideoTracks().length === 0) {
      try {
        pc.addTransceiver('video', { direction: 'recvonly' });
      } catch {}
    }

    pc.ontrack = (event) => {
      const addTrackIfNeeded = (track: MediaStreamTrack) => {
        track.enabled = true;
        if (!remoteStream.getTracks().some((t) => t.id === track.id)) {
          remoteStream.addTrack(track);
        }
        if (track.kind === 'audio') {
          if (!sessionRef.current?.isGroup) {
            webrtcAudioActiveRef.current = true;
          }
          track.onunmute = () => {
            if (!sessionRef.current?.isGroup) {
              webrtcAudioActiveRef.current = true;
            }
            syncRemoteAudioPlayback();
          };
        }
        if (track.kind === 'video') {
          if (!track.muted) {
            setHasRemoteVideo(true);
          }
          track.onunmute = () => {
            setHasRemoteVideo(true);
            syncRemoteAudioPlayback();
          };
          track.onmute = () => {
            setRemoteWebrtcVideoReady(false);
          };
        }
      };

      if (event.track) {
        addTrackIfNeeded(event.track);
      }
      if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach(addTrackIfNeeded);
      }

      const updatedStream = new MediaStream(remoteStream.getTracks());
      remoteStreamRef.current = updatedStream;
      syncRemoteAudioPlayback();
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && roomChannelRef.current) {
        roomChannelRef.current.send({
          type: 'broadcast',
          event: 'ice-candidate',
          payload: {
            senderId: meRef.current?.id,
            candidate: event.candidate.toJSON(),
          },
        });
      }
    };

    const handleConnectedState = () => {
      const state = pc.connectionState;
      const iceState = pc.iceConnectionState;

      if (iceState === 'disconnected' || iceState === 'failed' || state === 'failed') {
        try {
          pc.restartIce();
        } catch {}
      }

      if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
        stopRingtone();
        stopInviteRetryLoop();
        if (!sessionRef.current?.isGroup) {
          webrtcAudioActiveRef.current = true;
        }
        if (acceptRetryTimerRef.current) {
          clearInterval(acceptRetryTimerRef.current);
          acceptRetryTimerRef.current = null;
        }
        setSession((prev) => (prev ? { ...prev, status: 'connected' } : null));
        syncRemoteAudioPlayback();
      }
    };

    pc.onconnectionstatechange = handleConnectedState;
    pc.oniceconnectionstatechange = handleConnectedState;

    pcRef.current = pc;
    return pc;
  }

  function joinSignalingRoom(activeSess: ActiveCallSession, isInitiator: boolean, localStream: MediaStream) {
    const myProfile = meRef.current;
    const myId = myProfile?.id || 'anon';
    const supabase = getSupabaseClient();
    const room = supabase.channel(`pixchats-call-room:${activeSess.callId}`, {
      config: {
        presence: { key: myId },
        broadcast: { self: false },
      },
    });
    roomChannelRef.current = room;

    const pc = createPeerConnection(activeSess.callId, localStream);
    startVoicePcmRelay(localStream);

    const sendWebRtcOffer = async () => {
      await renegotiatePeerConnection();
    };

    room
      .on('presence', { event: 'sync' }, () => {
        try {
          const state = room.presenceState();
          const list: CallParticipant[] = [];
          Object.values(state).forEach((entries: any) => {
            if (Array.isArray(entries) && entries[0]) {
              list.push({
                id: entries[0].id,
                name: entries[0].name,
                avatar: entries[0].avatar,
              });
            }
          });
          setGroupParticipants(list);
          const currentMyId = meRef.current?.id;
          const hasOtherPeer = list.some((p) => p.id && p.id !== currentMyId);
          if (activeSess.isGroup && list.length >= 1) {
            stopRingtone();
            setSession((prev) => (prev ? { ...prev, status: 'connected' } : null));
          }
          if (hasOtherPeer) {
            stopRingtone();
            stopInviteRetryLoop();
            setSession((prev) => (prev ? { ...prev, status: 'connected' } : null));
          }
          if (isInitiator && hasOtherPeer && !pc.remoteDescription && pc.signalingState === 'stable') {
            void sendWebRtcOffer();
          }
        } catch {}
      })
      .on('broadcast', { event: 'call-accepted' }, async ({ payload }) => {
        if (payload?.senderId && payload.senderId === meRef.current?.id) return;
        stopRingtone();
        stopInviteRetryLoop();
        setSession((prev) => (prev ? { ...prev, status: 'connected' } : null));
        await sendWebRtcOffer();
      })
      .on('broadcast', { event: 'webrtc-offer' }, async ({ payload }) => {
        if (!payload?.sdp || (payload?.senderId && payload.senderId === meRef.current?.id)) return;
        stopRingtone();
        stopInviteRetryLoop();
        if (acceptRetryTimerRef.current) {
          clearInterval(acceptRetryTimerRef.current);
          acceptRetryTimerRef.current = null;
        }
        try {
          if (pc.signalingState !== 'stable') {
            await Promise.all([
              pc.setLocalDescription({ type: 'rollback' }),
              pc.setRemoteDescription(new RTCSessionDescription(payload.sdp)),
            ]);
          } else {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          }
          await flushPendingIceCandidates(pc);

          const answer = await pc.createAnswer();
          if (answer.sdp) {
            answer.sdp = enhanceOpusSdp(answer.sdp);
          }
          await pc.setLocalDescription(answer);
          room.send({
            type: 'broadcast',
            event: 'webrtc-answer',
            payload: { senderId: meRef.current?.id, sdp: pc.localDescription || answer },
          });
          setSession((prev) => (prev ? { ...prev, status: 'connected' } : null));
          syncRemoteAudioPlayback();
        } catch {}
      })
      .on('broadcast', { event: 'webrtc-answer' }, async ({ payload }) => {
        if (!payload?.sdp || (payload?.senderId && payload.senderId === meRef.current?.id)) return;
        try {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            await flushPendingIceCandidates(pc);
          }
          stopRingtone();
          stopInviteRetryLoop();
          setSession((prev) => (prev ? { ...prev, status: 'connected' } : null));
          syncRemoteAudioPlayback();
        } catch {}
      })
      .on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
        if (!payload?.candidate || (payload?.senderId && payload.senderId === meRef.current?.id)) return;
        try {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } else {
            pendingCandidatesRef.current.push(payload.candidate);
          }
        } catch {}
      })
      .on('broadcast', { event: 'voice-pcm' }, ({ payload }) => {
        if (!payload?.pcm || (payload?.senderId && payload.senderId === meRef.current?.id)) return;
        stopRingtone();
        stopInviteRetryLoop();
        markSpeakerActive(payload.senderId);
        setSession((prev) =>
          prev && prev.status !== 'connected' ? { ...prev, status: 'connected' } : prev
        );
        if (!webrtcAudioActiveRef.current || activeSess.isGroup) {
          playRemotePcmChunk(payload.pcm, payload.sr || RELAY_SAMPLE_RATE, payload.senderId);
        }
      })
      .on('broadcast', { event: 'video-frame' }, ({ payload }) => {
        if (!payload?.frame || (payload?.senderId && payload.senderId === meRef.current?.id)) return;
        setRemoteRelayFrame(payload.frame);
        setHasRemoteVideo(true);
      })
      .on('broadcast', { event: 'media-update' }, ({ payload }) => {
        if (payload?.senderId && payload.senderId === meRef.current?.id) return;
        if (typeof payload?.video === 'boolean') {
          setHasRemoteVideo(payload.video);
          if (!payload.video) {
            setRemoteRelayFrame(null);
            setRemoteWebrtcVideoReady(false);
          }
        }
      })
      .on('broadcast', { event: 'hangup' }, () => {
        if (!activeSess.isGroup) {
          cleanupCallResources();
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          const currentMe = meRef.current;
          if (currentMe) {
            await room.track({
              id: currentMe.id,
              name: currentMe.display_name,
              avatar: currentMe.avatar_url,
            });
          }
          if (!isInitiator || activeSess.isGroup) {
            const sendAccepted = () => {
              room.send({
                type: 'broadcast',
                event: 'call-accepted',
                payload: { senderId: meRef.current?.id },
              });
            };
            sendAccepted();
            setSession((prev) => (prev ? { ...prev, status: 'connected' } : null));
            if (!activeSess.isGroup) {
              if (acceptRetryTimerRef.current) clearInterval(acceptRetryTimerRef.current);
              acceptRetryTimerRef.current = setInterval(() => {
                if (pcRef.current && !pcRef.current.remoteDescription) {
                  sendAccepted();
                } else if (acceptRetryTimerRef.current) {
                  clearInterval(acceptRetryTimerRef.current);
                  acceptRetryTimerRef.current = null;
                }
              }, 1200);
            }
          }
        }
      });
  }

  // Начать исходящий личный звонок
  async function handleStartOutgoingCall(params: StartCallParams) {
    const currentMe = meRef.current || (await getCurrentProfile());
    if (!currentMe || sessionRef.current) return;
    if (!meRef.current) {
      setMe(currentMe);
      meRef.current = currentMe;
    }

    unlockAudioElements();
    stopInviteRetryLoop();

    const callId = `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newSession: ActiveCallSession = {
      callId,
      chatId: params.chatId,
      peerId: params.targetUserId,
      peerName: params.targetName,
      peerAvatar: params.targetAvatar,
      mode: params.mode,
      direction: 'outgoing',
      status: 'ringing',
      isGroup: false,
      callerIsDeveloper: isDeveloperUser(currentMe),
    };

    setSession(newSession);
    startRingtone(false);

    const localStream = await acquireLocalMedia(params.mode === 'video');
    localStreamRef.current = localStream;

    joinSignalingRoom(newSession, true, localStream);

    const invitePayload = {
      callId,
      chatId: params.chatId,
      targetUserId: params.targetUserId,
      callerId: currentMe.id,
      callerName: currentMe.display_name,
      callerAvatar: currentMe.avatar_url,
      mode: params.mode,
      isGroup: false,
      callerIsDeveloper: isDeveloperUser(currentMe),
    };

    // Отправляем приглашение и повторяем каждые 2.2 сек, пока идёт вызов (ringing),
    // чтобы звонок 100% доходил даже при переподключении сети или открытии вкладки собеседником!
    const supabase = getSupabaseClient();
    const targetChannel = supabase.channel(`pixchats-calls:${params.targetUserId}`);
    inviteTargetChannelRef.current = targetChannel;

    const sendInviteNow = () => {
      if (sessionRef.current?.callId !== callId || sessionRef.current?.status !== 'ringing') {
        stopInviteRetryLoop();
        return;
      }
      try {
        targetChannel.send({
          type: 'broadcast',
          event: 'call-invite',
          payload: invitePayload,
        });
      } catch {}
      try {
        globalCallChannelRef.current?.send({
          type: 'broadcast',
          event: 'call-invite',
          payload: invitePayload,
        });
      } catch {}
    };

    targetChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        sendInviteNow();
      }
    });
    // Также сразу дублируем в глобальный сигнальный канал
    sendInviteNow();
    inviteRetryTimerRef.current = setInterval(sendInviteNow, 2200);
  }

  // Начать групповой голосовой чат
  async function handleStartGroupCall(params: StartGroupCallParams) {
    const currentMe = meRef.current || (await getCurrentProfile());
    if (!currentMe || sessionRef.current) return;
    if (!meRef.current) {
      setMe(currentMe);
      meRef.current = currentMe;
    }

    unlockAudioElements();

    const callId = `group-call-${params.chatId}`;
    const mode = params.mode ?? 'audio';
    const newSession: ActiveCallSession = {
      callId,
      chatId: params.chatId,
      peerId: params.chatId,
      peerName: params.chatTitle || 'Голосовой чат группы',
      peerAvatar: params.chatAvatar,
      mode,
      direction: 'outgoing',
      status: 'connected',
      isGroup: true,
      callerIsDeveloper: isDeveloperUser(currentMe),
    };

    setSession(newSession);

    const localStream = await acquireLocalMedia(mode === 'video');
    localStreamRef.current = localStream;

    joinSignalingRoom(newSession, true, localStream);

    if (!params.joinOnly) {
      try {
        const supabase = getSupabaseClient();
        const { data: members } = await supabase
          .from('chat_members')
          .select('user_id')
          .eq('chat_id', params.chatId);

        const targetIds = (members ?? [])
          .map((r: any) => r.user_id)
          .filter((uid: string) => uid && uid !== currentMe.id);

        const groupInvitePayload = {
          callId,
          chatId: params.chatId,
          targetUserIds: targetIds,
          callerId: currentMe.id,
          callerName: `🔊 ${params.chatTitle} (${currentMe.display_name})`,
          callerAvatar: params.chatAvatar || currentMe.avatar_url,
          mode,
          isGroup: true,
          callerIsDeveloper: isDeveloperUser(currentMe),
        };

        try {
          globalCallChannelRef.current?.send({
            type: 'broadcast',
            event: 'call-invite',
            payload: groupInvitePayload,
          });
        } catch {}

        for (const uid of targetIds) {
          const ch = supabase.channel(`pixchats-calls:${uid}`);
          ch.subscribe((st) => {
            if (st === 'SUBSCRIBED') {
              ch.send({
                type: 'broadcast',
                event: 'call-invite',
                payload: { ...groupInvitePayload, targetUserId: uid },
              });
              setTimeout(() => {
                supabase.removeChannel(ch);
              }, 3500);
            }
          });
        }

        sendMessage(
          params.chatId,
          `🔊 ${currentMe.display_name} запустил(а) голосовой чат группы — нажмите «🔊 Голосовой чат» в шапке, чтобы присоединиться!`
        ).catch(() => {});
      } catch {}
    }
  }

  // Принять входящий звонок
  async function handleAcceptIncomingCall() {
    const current = sessionRef.current;
    const currentMe = meRef.current || (await getCurrentProfile());
    if (!current || !currentMe) return;

    unlockAudioElements();
    stopRingtone();
    setSession({ ...current, status: 'connected' });

    const localStream = await acquireLocalMedia(current.mode === 'video');
    localStreamRef.current = localStream;

    joinSignalingRoom(current, false, localStream);
  }

  // Завершить или отклонить звонок
  async function handleEndCall() {
    const current = sessionRef.current;
    const elapsed = durationRef.current;

    if (current?.callId) {
      dismissedCallIdsRef.current.add(current.callId);
    }

    stopInviteRetryLoop();

    if (roomChannelRef.current && !current?.isGroup) {
      try {
        roomChannelRef.current.send({
          type: 'broadcast',
          event: 'hangup',
          payload: { senderId: meRef.current?.id },
        });
      } catch {}
    }

    if (current && current.status === 'ringing' && !current.isGroup) {
      try {
        globalCallChannelRef.current?.send({
          type: 'broadcast',
          event: 'call-cancelled',
          payload: { callId: current.callId, targetUserId: current.peerId },
        });
      } catch {}
      try {
        const supabase = getSupabaseClient();
        const peerCh = supabase.channel(`pixchats-calls:${current.peerId}`);
        peerCh.subscribe((st) => {
          if (st === 'SUBSCRIBED') {
            peerCh.send({
              type: 'broadcast',
              event: 'call-cancelled',
              payload: { callId: current.callId },
            });
            setTimeout(() => supabase.removeChannel(peerCh), 1500);
          }
        });
      } catch {}
    }

    if (current?.chatId && current.direction === 'outgoing' && !current.isGroup) {
      const icon = current.mode === 'video' ? '📹' : '📞';
      const label = current.mode === 'video' ? 'Видеозвонок' : 'Аудиозвонок';
      const msgText =
        elapsed > 0
          ? `${icon} ${label} завершён · Длительность: ${formatDuration(elapsed)}`
          : `${icon} Отменённый ${label.toLowerCase()}`;
      sendMessage(current.chatId, msgText).catch(() => {});
    }

    cleanupCallResources();
  }

  function handleToggleMic() {
    if (!localStreamRef.current) return;
    const nextMuted = !micMuted;
    localStreamRef.current.getAudioTracks().forEach((t) => {
      t.enabled = !nextMuted;
    });
    micMutedRef.current = nextMuted;
    setMicMuted(nextMuted);
  }

  function handleToggleSpeakerphone() {
    const nextState = !speakerphoneActive;
    setSpeakerphoneActive(nextState);
    if (typeof window !== 'undefined' && (window as any).PixChatsAndroid?.setSpeakerphoneOn) {
      try {
        (window as any).PixChatsAndroid.setSpeakerphoneOn(nextState);
      } catch {}
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = nextState ? 1.0 : 0.45;
    }
    showTransientCallNotice(
      nextState ? '🔊 Громкая связь включена' : '🔈 Разговорный динамик'
    );
  }

  function handleReconnectCall() {
    showTransientCallNotice('🔄 Восстановление WebRTC соединения…');
    if (pcRef.current) {
      try {
        pcRef.current.restartIce();
      } catch {}
    }
    unlockAudioElements();
    if (remoteStreamRef.current) {
      syncRemoteAudioPlayback();
    }
  }

  async function handleToggleCamera() {
    if (!localStreamRef.current) {
      localStreamRef.current = new MediaStream();
    }
    const existingVideoTracks = localStreamRef.current.getVideoTracks().filter((t) => t.readyState === 'live');

    if (existingVideoTracks.length > 0 && cameraEnabled) {
      existingVideoTracks.forEach((t) => {
        t.enabled = false;
        t.stop();
        localStreamRef.current?.removeTrack(t);
      });
      setCameraEnabled(false);
      if (!screenSharing) {
        await syncOutgoingVideoTrack(null, null);
        roomChannelRef.current?.send({
          type: 'broadcast',
          event: 'media-update',
          payload: { senderId: meRef.current?.id, video: false },
        });
      }
      return;
    }

    try {
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: getPreferredVideoConstraints({
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: cameraFacingMode,
        }),
        audio: false,
      });
      const camTrack = camStream.getVideoTracks()[0];
      if (!camTrack) {
        showTransientCallNotice('Камера не найдена на устройстве');
        return;
      }

      // Останавливаем старые остановленные видео-дорожки
      localStreamRef.current.getVideoTracks().forEach((old) => {
        old.stop();
        localStreamRef.current?.removeTrack(old);
      });
      localStreamRef.current.addTrack(camTrack);

      if (!screenSharing) {
        await syncOutgoingVideoTrack(camTrack, localStreamRef.current);
      }

      setCameraEnabled(true);
      roomChannelRef.current?.send({
        type: 'broadcast',
        event: 'media-update',
        payload: { senderId: meRef.current?.id, video: true },
      });
    } catch {
      showTransientCallNotice('Не удалось включить камеру (проверьте доступ к камере)');
    }
  }

  async function handleFlipCamera() {
    if (!cameraEnabled) return;
    const nextFacing = cameraFacingMode === 'user' ? 'environment' : 'user';
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: getPreferredVideoConstraints({
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: nextFacing,
        }),
        audio: false,
      });
      const camTrack = camStream.getVideoTracks()[0];
      if (!camTrack) return;

      if (!localStreamRef.current) {
        localStreamRef.current = new MediaStream();
      }
      localStreamRef.current.getVideoTracks().forEach((old) => {
        old.stop();
        localStreamRef.current?.removeTrack(old);
      });
      localStreamRef.current.addTrack(camTrack);
      setCameraFacingMode(nextFacing);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
        void localVideoRef.current.play().catch(() => {});
      }

      if (!screenSharing) {
        await syncOutgoingVideoTrack(camTrack, localStreamRef.current);
      }
      showTransientCallNotice(
        nextFacing === 'user' ? '🤳 Фронтальная камера' : '📷 Основная (задняя) камера'
      );
    } catch {
      showTransientCallNotice('Не удалось переключить камеру');
    }
  }

  async function handleToggleScreenShare() {
    if (screenSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      setScreenSharing(false);

      const camTrack =
        cameraEnabled
          ? localStreamRef.current?.getVideoTracks().find((t) => t.readyState === 'live') || null
          : null;
      await syncOutgoingVideoTrack(camTrack, camTrack ? localStreamRef.current : null);
      roomChannelRef.current?.send({
        type: 'broadcast',
        event: 'media-update',
        payload: { senderId: meRef.current?.id, video: Boolean(camTrack && cameraEnabled) },
      });
      return;
    }

    try {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
        showTransientCallNotice('Демонстрация экрана не поддерживается на этом мобильном браузере');
        return;
      }

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 15, max: 30 },
        },
        audio: false,
      });
      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) return;

      screenStreamRef.current = displayStream;
      setScreenSharing(true);

      screenTrack.onended = () => {
        setScreenSharing(false);
        screenStreamRef.current = null;
        const camTrack =
          cameraEnabled
            ? localStreamRef.current?.getVideoTracks().find((t) => t.readyState === 'live') || null
            : null;
        void syncOutgoingVideoTrack(camTrack, camTrack ? localStreamRef.current : null);
        roomChannelRef.current?.send({
          type: 'broadcast',
          event: 'media-update',
          payload: { senderId: meRef.current?.id, video: Boolean(camTrack && cameraEnabled) },
        });
      };

      await syncOutgoingVideoTrack(screenTrack, displayStream);

      roomChannelRef.current?.send({
        type: 'broadcast',
        event: 'media-update',
        payload: { senderId: meRef.current?.id, video: true },
      });
    } catch (err: any) {
      if (err?.name !== 'NotAllowedError') {
        showTransientCallNotice('Не удалось запустить демонстрацию экрана');
      }
    }
  }

  // Глобальная подписка на входящие звонки (персональный канал + глобальный резервный канал)
  useEffect(() => {
    let personalCallChannel: any = null;
    let globalCallChannel: any = null;
    let currentSubscribedUserId: string | null = null;

    const handleIncomingInvitePayload = (payload: any, myUserId: string) => {
      if (!payload || !payload.callId) return;
      if (payload.callerId === myUserId) return;
      if (dismissedCallIdsRef.current.has(payload.callId)) return;
      if (sessionRef.current) return;

      // Проверяем адресата для глобального канала
      if (
        payload.targetUserId &&
        payload.targetUserId !== myUserId &&
        !(Array.isArray(payload.targetUserIds) && payload.targetUserIds.includes(myUserId))
      ) {
        return;
      }

      const incoming: ActiveCallSession = {
        callId: payload.callId,
        chatId: payload.chatId,
        peerId: payload.callerId,
        peerName: payload.callerName || 'Собеседник',
        peerAvatar: payload.callerAvatar,
        mode: payload.mode === 'video' ? 'video' : 'audio',
        direction: 'incoming',
        status: 'ringing',
        isGroup: Boolean(payload.isGroup),
        callerIsDeveloper: Boolean(payload.callerIsDeveloper),
      };

      setSession(incoming);
      startRingtone(true);

      const prefs = getNotificationPrefs();
      if (prefs.enabled && prefs.incomingCalls !== false) {
        void triggerIncomingCallNativeAlert({
          callerName: incoming.peerName,
          mode: incoming.mode,
          chatId: incoming.chatId,
          silent: !prefs.sound,
        });
      }
    };

    const handleCancelledPayload = (payload: any) => {
      if (payload?.callId) {
        dismissedCallIdsRef.current.add(payload.callId);
        if (sessionRef.current?.callId === payload.callId) {
          cleanupCallResources();
        }
      }
    };

    const setupSubscriptionsForProfile = (profile: Profile) => {
      if (currentSubscribedUserId === profile.id && personalCallChannel) return;
      currentSubscribedUserId = profile.id;
      setMe(profile);
      meRef.current = profile;

      const supabase = getSupabaseClient();
      if (personalCallChannel) {
        try {
          supabase.removeChannel(personalCallChannel);
        } catch {}
      }
      if (globalCallChannel) {
        try {
          supabase.removeChannel(globalCallChannel);
        } catch {}
      }

      personalCallChannel = supabase
        .channel(`pixchats-calls:${profile.id}`)
        .on('broadcast', { event: 'call-invite' }, ({ payload }) =>
          handleIncomingInvitePayload(payload, profile.id)
        )
        .on('broadcast', { event: 'call-cancelled' }, ({ payload }) =>
          handleCancelledPayload(payload)
        )
        .subscribe();

      globalCallChannel = supabase
        .channel('pixchats-calls-global', {
          config: { broadcast: { self: false } },
        })
        .on('broadcast', { event: 'call-invite' }, ({ payload }) =>
          handleIncomingInvitePayload(payload, profile.id)
        )
        .on('broadcast', { event: 'call-cancelled' }, ({ payload }) =>
          handleCancelledPayload(payload)
        )
        .subscribe();

      globalCallChannelRef.current = globalCallChannel;
    };

    const cached = getCachedCurrentProfile();
    if (cached) {
      setupSubscriptionsForProfile(cached);
    }

    void getCurrentProfile().then((prof) => {
      if (prof) setupSubscriptionsForProfile(prof);
    });

    const supabase = getSupabaseClient();
    const { data: authSub } = supabase.auth.onAuthStateChange(() => {
      void getCurrentProfile(true).then((prof) => {
        if (prof) setupSubscriptionsForProfile(prof);
      });
    });

    const onStartCallEvent = (e: Event) => {
      const custom = e as CustomEvent<StartCallParams>;
      if (custom.detail) {
        void handleStartOutgoingCall(custom.detail);
      }
    };

    const onStartGroupCallEvent = (e: Event) => {
      const custom = e as CustomEvent<StartGroupCallParams>;
      if (custom.detail) {
        void handleStartGroupCall(custom.detail);
      }
    };

    window.addEventListener('pixchats:start_call', onStartCallEvent);
    window.addEventListener('pixchats:start_group_call', onStartGroupCallEvent);
    return () => {
      window.removeEventListener('pixchats:start_call', onStartCallEvent);
      window.removeEventListener('pixchats:start_group_call', onStartGroupCallEvent);
      authSub?.subscription?.unsubscribe();
      if (personalCallChannel) {
        try {
          supabase.removeChannel(personalCallChannel);
        } catch {}
      }
      if (globalCallChannel) {
        try {
          supabase.removeChannel(globalCallChannel);
        } catch {}
      }
    };
  }, []);

  // Постоянный <audio> элемент вне условных веток, чтобы он никогда не размонтировался при смене статуса звонка
  const persistentAudioEl = (
    <audio
      ref={remoteAudioRef}
      autoPlay
      playsInline
      style={{
        position: 'fixed',
        width: 1,
        height: 1,
        opacity: 0.01,
        pointerEvents: 'none',
        left: -9999,
        top: -9999,
      }}
    />
  );

  if (!session) {
    return persistentAudioEl;
  }

  // 1. Входящий вызов (ожидание ответа)
  if (session.direction === 'incoming' && session.status === 'ringing') {
    return (
      <>
        {persistentAudioEl}
        <div
          className="modal-overlay"
          style={{ zIndex: 10000, background: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(8px)' }}
        >
          <div
            className="modal-card"
            style={{
              maxWidth: 360,
              textAlign: 'center',
              padding: '28px 24px',
              border: '2px solid var(--accent)',
              boxShadow: '0 16px 48px rgba(0, 0, 0, 0.7)',
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--accent)',
                marginBottom: 14,
              }}
            >
              {session.isGroup
                ? '🔊 Вызов в голосовой чат группы'
                : session.mode === 'video'
                  ? '📹 Входящий видеозвонок'
                  : '📞 Входящий аудиозвонок'}
            </div>

            <div
              className={`avatar ${!session.peerAvatar ? 'avatar-fallback' : ''}`}
              style={{
                width: 88,
                height: 88,
                fontSize: 32,
                margin: '0 auto 14px',
                border: '3px solid var(--accent)',
                boxShadow: '0 0 0 8px rgba(255, 212, 0, 0.14)',
                backgroundImage: session.peerAvatar ? `url(${session.peerAvatar})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              {!session.peerAvatar && session.peerName.replace('🔊 ', '').slice(0, 1).toUpperCase()}
            </div>

            <h3 style={{ margin: '0 0 6px', fontSize: 20 }}>{session.peerName}</h3>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
              {session.isGroup
                ? 'Приглашает всех участников подключиться к голосовому чату…'
                : 'Вызывает вас в PixChats…'}
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                type="button"
                className="btn"
                style={{
                  flex: 1,
                  background: '#dc2626',
                  borderColor: '#ef4444',
                  color: '#fff',
                  fontWeight: 700,
                  padding: '12px 16px',
                }}
                onClick={handleEndCall}
              >
                📵 Отклонить
              </button>
              <button
                type="button"
                className="btn"
                style={{
                  flex: 1,
                  background: '#16a34a',
                  borderColor: '#22c55e',
                  color: '#fff',
                  fontWeight: 700,
                  padding: '12px 16px',
                }}
                onClick={handleAcceptIncomingCall}
              >
                📞 {session.isGroup ? 'Войти' : 'Принять'}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // 2. Свёрнутое плавающее мини-окно звонка
  if (minimized) {
    return (
      <>
        {persistentAudioEl}
        <div
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            zIndex: 10000,
            width: 300,
            background: 'var(--surface-raised)',
            border: '1.5px solid var(--accent)',
            borderRadius: 14,
            padding: '10px 14px',
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, cursor: 'pointer' }} onClick={() => setMinimized(false)}>
            <AvatarWithStatus
              avatarUrl={session.peerAvatar}
              name={session.peerName}
              size={38}
              statusType="incall"
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {session.peerName}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--accent)' }}>
                {session.status === 'connected' ? formatDuration(durationSec) : 'Соединение…'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              className="btn"
              style={{
                width: 'auto',
                padding: '6px 10px',
                fontSize: 11.5,
                fontWeight: 700,
                background: micMuted ? '#dc2626' : 'rgba(34, 197, 94, 0.2)',
                borderColor: micMuted ? '#ef4444' : '#22c55e',
                color: micMuted ? '#fff' : '#22c55e',
              }}
              onClick={handleToggleMic}
              title={micMuted ? 'Микрофон ВЫКЛЮЧЕН — нажмите, чтобы включить' : 'Микрофон ВКЛЮЧЁН — нажмите, чтобы выключить'}
            >
              {micMuted ? '🔇 ВЫКЛ' : '🎤 ВКЛ'}
            </button>
            <button
              type="button"
              className="btn"
              style={{
                width: 'auto',
                padding: '6px 10px',
                fontSize: 11.5,
                fontWeight: 700,
                background: cameraEnabled ? 'rgba(34, 197, 94, 0.2)' : 'var(--surface)',
                borderColor: cameraEnabled ? '#22c55e' : 'var(--border)',
                color: cameraEnabled ? '#22c55e' : 'var(--text-muted)',
              }}
              onClick={handleToggleCamera}
              title={cameraEnabled ? 'Видео ВКЛЮЧЕНО' : 'Видео ВЫКЛЮЧЕНО'}
            >
              {cameraEnabled ? '📹 ВКЛ' : '📷 ВЫКЛ'}
            </button>
            <button
              type="button"
              className="btn"
              style={{ width: 'auto', padding: '6px 8px', fontSize: 12 }}
              onClick={() => setMinimized(false)}
              title="Развернуть окно звонка"
            >
              ⛶
            </button>
            <button
              type="button"
              className="btn"
              style={{ width: 'auto', padding: '6px 8px', fontSize: 12, background: '#dc2626', color: '#fff' }}
              onClick={handleEndCall}
              title="Завершить звонок"
            >
              📵
            </button>
          </div>
        </div>
      </>
    );
  }

  // 3. Полноэкранное окно активного звонка (личного или группового голосового чата)
  return (
    <>
      {persistentAudioEl}
      <div
        className="modal-overlay"
        style={{
          zIndex: 10000,
          background: 'rgba(9, 9, 11, 0.96)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 20,
        }}
      >
        {/* Верхняя панель */}
        <div
          style={{
            width: '100%',
            maxWidth: 960,
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
              {session.callerIsDeveloper
                ? '👑 Безлимитный звонок разработчика Pixset Studio'
                : session.isGroup
                  ? `🔊 Голосовая комната группы (${groupParticipants.length || 1} уч.)`
                  : '🔒 Зашифрованный звонок PixChats (HD Voice)'}
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              · {session.status === 'connected'
                  ? session.callerIsDeveloper
                    ? `${formatDuration(durationSec)} (Безлимит)`
                    : `${formatDuration(durationSec)} / 60:00`
                  : session.status === 'ringing'
                    ? 'Вызов…'
                    : 'Соединение…'}
            </span>
          </div>

          <button
            type="button"
            className="btn"
            style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
            onClick={() => setMinimized(true)}
          >
            🗕 Свернуть в мини-окно
          </button>
        </div>

        {/* Наглядная панель текущего статуса устройств в звонке */}
        <div
          style={{
            width: '100%',
            maxWidth: 960,
            margin: '10px auto 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 12px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              background: micMuted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.18)',
              border: `1.5px solid ${micMuted ? '#ef4444' : '#22c55e'}`,
              color: micMuted ? '#ef4444' : '#22c55e',
            }}
          >
            <span>{micMuted ? '🔇' : '🎤'}</span>
            <span>Микрофон: {micMuted ? 'ВЫКЛЮЧЕН' : 'ВКЛЮЧЁН'}</span>
          </span>

          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 12px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              background: cameraEnabled ? 'rgba(34, 197, 94, 0.18)' : 'rgba(138, 133, 120, 0.15)',
              border: `1.5px solid ${cameraEnabled ? '#22c55e' : 'var(--border)'}`,
              color: cameraEnabled ? '#22c55e' : 'var(--text-muted)',
            }}
          >
            <span>{cameraEnabled ? '📹' : '📷'}</span>
            <span>Видео: {cameraEnabled ? 'ВКЛЮЧЕНО' : 'ВЫКЛЮЧЕНО'}</span>
          </span>

          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 12px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              background: speakerphoneActive ? 'var(--accent)' : 'rgba(138, 133, 120, 0.15)',
              border: `1.5px solid ${speakerphoneActive ? 'var(--accent)' : 'var(--border)'}`,
              color: speakerphoneActive ? '#000' : 'var(--text-muted)',
            }}
          >
            <span>{speakerphoneActive ? '🔊' : '🔈'}</span>
            <span>Громкая связь: {speakerphoneActive ? 'ВКЛ' : 'ВЫКЛ'}</span>
          </span>

          {screenSharing && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 12px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
                background: 'var(--accent)',
                border: '1.5px solid var(--accent)',
                color: '#000',
              }}
            >
              🖥️ Экран: ВКЛ
            </span>
          )}
        </div>

        {callNotice && (
          <div
            style={{
              margin: '8px auto 0',
              padding: '8px 16px',
              borderRadius: 10,
              background: 'rgba(245, 158, 11, 0.16)',
              border: '1px solid var(--accent)',
              color: 'var(--accent)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {callNotice}
          </div>
        )}

        {/* Центральная область */}
        <div
          style={{
            position: 'relative',
            flex: 1,
            width: '100%',
            maxWidth: 960,
            margin: '12px auto',
            borderRadius: 16,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 18,
          }}
        >
          {hasRemoteVideo && (remoteWebrtcVideoReady || remoteRelayFrame) ? (
            <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                muted
                onLoadedData={() => {
                  if (remoteVideoRef.current && remoteVideoRef.current.videoWidth > 0) {
                    setRemoteWebrtcVideoReady(true);
                  }
                }}
                onResize={() => {
                  if (remoteVideoRef.current && remoteVideoRef.current.videoWidth > 0) {
                    setRemoteWebrtcVideoReady(true);
                  }
                }}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  background: '#000',
                  opacity: remoteWebrtcVideoReady ? 1 : 0,
                }}
              />
              {remoteRelayFrame && (session.isGroup || !remoteWebrtcVideoReady) && (
                <img
                  src={remoteRelayFrame}
                  alt="Видеопоток собеседника"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    background: '#000',
                  }}
                />
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <div
                className={`avatar ${!session.peerAvatar ? 'avatar-fallback' : ''}`}
                style={{
                  width: 112,
                  height: 112,
                  fontSize: 42,
                  margin: '0 auto 16px',
                  border: '3px solid var(--accent)',
                  boxShadow:
                    session.status === 'connected'
                      ? '0 0 0 10px rgba(34, 197, 94, 0.16)'
                      : '0 0 0 10px rgba(255, 212, 0, 0.14)',
                  backgroundImage: session.peerAvatar ? `url(${session.peerAvatar})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                {!session.peerAvatar && session.peerName.replace('🔊 ', '').slice(0, 1).toUpperCase()}
              </div>
              <h2 style={{ margin: '0 0 6px', fontSize: 22 }}>{session.peerName}</h2>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                {session.status === 'ringing'
                  ? 'Ожидание ответа собеседника…'
                  : session.status === 'connecting'
                    ? 'Установка защищённого аудио/видео канала…'
                    : `В разговоре · ${formatDuration(durationSec)}`}
              </div>

              {session.isGroup && groupParticipants.length > 0 && (
                <div
                  style={{
                    marginTop: 22,
                    display: 'flex',
                    gap: 12,
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                  }}
                >
                  {groupParticipants.map((part) => {
                    const isSpeaking = Boolean(speakingUsers[part.id]);
                    return (
                      <div
                        key={part.id}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 6,
                          padding: '10px 14px',
                          borderRadius: 12,
                          background: 'var(--bg-secondary)',
                          border: isSpeaking ? '2px solid #22c55e' : '1px solid var(--accent)',
                          boxShadow: isSpeaking ? '0 0 16px rgba(34, 197, 94, 0.35)' : undefined,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div
                          className={`avatar ${!part.avatar ? 'avatar-fallback' : ''}`}
                          style={{
                            width: 44,
                            height: 44,
                            fontSize: 16,
                            backgroundImage: part.avatar ? `url(${part.avatar})` : undefined,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                          }}
                        >
                          {!part.avatar && part.name.slice(0, 1).toUpperCase()}
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>
                          {part.name} {isSpeaking ? '🗣️' : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {(cameraEnabled || screenSharing) && (
            <div
              style={{
                position: 'absolute',
                bottom: 16,
                right: 16,
                width: 210,
                height: 136,
                borderRadius: 12,
                overflow: 'hidden',
                border: '2px solid var(--accent)',
                background: '#000',
                boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
              }}
            >
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: !screenSharing && cameraFacingMode === 'user' ? 'scaleX(-1)' : 'none',
                }}
              />
              {isMobilePhone && cameraEnabled && !screenSharing && (
                <button
                  type="button"
                  className="btn"
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    width: 'auto',
                    padding: '4px 8px',
                    fontSize: 11,
                    background: 'rgba(0,0,0,0.72)',
                    color: '#fff',
                    borderColor: 'var(--accent)',
                  }}
                  onClick={() => void handleFlipCamera()}
                  title="Перевернуть камеру"
                >
                  🔄
                </button>
              )}
            </div>
          )}
        </div>

        {/* Нижняя панель управления звонком с чёткой индикацией ВКЛ / ВЫКЛ */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            className="btn"
            style={{
              width: 'auto',
              padding: '11px 16px',
              background: micMuted ? 'rgba(220, 38, 38, 0.22)' : 'rgba(34, 197, 94, 0.16)',
              borderColor: micMuted ? '#ef4444' : '#22c55e',
              borderWidth: 2,
              color: micMuted ? '#ef4444' : '#22c55e',
              fontWeight: 700,
            }}
            onClick={handleToggleMic}
          >
            <span>{micMuted ? '🔇 Микрофон:' : '🎤 Микрофон:'}</span>
            <span
              style={{
                padding: '2px 7px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 800,
                background: micMuted ? '#ef4444' : '#22c55e',
                color: '#000',
              }}
            >
              {micMuted ? 'ВЫКЛ' : 'ВКЛ'}
            </span>
          </button>

          <button
            type="button"
            className="btn"
            style={{
              width: 'auto',
              padding: '11px 16px',
              background: cameraEnabled ? 'rgba(34, 197, 94, 0.16)' : 'var(--surface-raised)',
              borderColor: cameraEnabled ? '#22c55e' : 'var(--border)',
              borderWidth: 2,
              color: cameraEnabled ? '#22c55e' : 'var(--text)',
              fontWeight: 700,
            }}
            onClick={handleToggleCamera}
          >
            <span>{cameraEnabled ? '📹 Видео:' : '📷 Видео:'}</span>
            <span
              style={{
                padding: '2px 7px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 800,
                background: cameraEnabled ? '#22c55e' : 'rgba(255,255,255,0.12)',
                color: cameraEnabled ? '#000' : 'var(--text-muted)',
              }}
            >
              {cameraEnabled ? 'ВКЛ' : 'ВЫКЛ'}
            </span>
          </button>

          {isMobilePhone && cameraEnabled && (
            <button
              type="button"
              className="btn"
              style={{
                width: 'auto',
                padding: '11px 14px',
                fontWeight: 700,
              }}
              onClick={() => void handleFlipCamera()}
              title="Переключить между фронтальной и основной камерой"
            >
              🔄 Перевернуть камеру
            </button>
          )}

          <button
            type="button"
            className="btn"
            style={{
              width: 'auto',
              padding: '11px 16px',
              borderColor: speakerphoneActive ? 'var(--accent)' : 'var(--border)',
              borderWidth: 2,
              color: speakerphoneActive ? '#000' : 'var(--text)',
              background: speakerphoneActive ? 'var(--accent)' : 'var(--surface-raised)',
              fontWeight: 700,
            }}
            onClick={handleToggleSpeakerphone}
          >
            <span>{speakerphoneActive ? '🔊 Громкая:' : '🔈 Динамик:'}</span>
            <span
              style={{
                padding: '2px 7px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 800,
                background: speakerphoneActive ? '#000' : 'rgba(255,255,255,0.12)',
                color: speakerphoneActive ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {speakerphoneActive ? 'ВКЛ' : 'ВЫКЛ'}
            </span>
          </button>

          <button
            type="button"
            className="btn"
            style={{
              width: 'auto',
              padding: '11px 16px',
              borderColor: screenSharing ? 'var(--accent)' : 'var(--border)',
              borderWidth: 2,
              color: screenSharing ? '#000' : 'var(--text)',
              background: screenSharing ? 'var(--accent)' : 'var(--surface-raised)',
              fontWeight: 700,
            }}
            onClick={handleToggleScreenShare}
          >
            <span>🖥️ Экран:</span>
            <span
              style={{
                padding: '2px 7px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 800,
                background: screenSharing ? '#000' : 'rgba(255,255,255,0.12)',
                color: screenSharing ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {screenSharing ? 'ВКЛ' : 'ВЫКЛ'}
            </span>
          </button>

          <button
            type="button"
            className="btn"
            style={{
              width: 'auto',
              padding: '11px 16px',
            }}
            onClick={handleReconnectCall}
            title="Перезапустить аудиопоток при разрыве или задержках"
          >
            🔄 Восстановить связь
          </button>

          <button
            type="button"
            className="btn"
            style={{
              width: 'auto',
              padding: '11px 22px',
              background: '#dc2626',
              borderColor: '#ef4444',
              color: '#fff',
              fontWeight: 700,
            }}
            onClick={handleEndCall}
          >
            📵 {session.isGroup ? 'Покинуть голосовой чат' : 'Завершить звонок'}
          </button>
        </div>
      </div>
    </>
  );
}


