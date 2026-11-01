'use client';

import React, { useEffect, useRef, useState } from 'react';
import { getCurrentProfile, getSupabaseClient, sendMessage } from '@pixchats/core';
import type { Profile } from '@pixchats/core';
import { getNotificationPrefs } from '../lib/notificationPrefs';
import {
  triggerIncomingCallNativeAlert,
  stopIncomingCallNativeAlert,
} from '../lib/nativePlatform';
import { AvatarWithStatus } from './AvatarWithStatus';

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

const RELAY_SAMPLE_RATE = 10000;

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
        // Фирменная трёхнотная мелодия звонка PixChats (C5 -> E5 -> G5 -> C6)
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
        // Гудок исходящего вызова (440 Гц)
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
  const [me, setMe] = useState<Profile | null>(null);
  const [session, setSession] = useState<ActiveCallSession | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [remoteRelayFrame, setRemoteRelayFrame] = useState<string | null>(null);
  const [groupParticipants, setGroupParticipants] = useState<CallParticipant[]>([]);
  const [speakingUsers, setSpeakingUsers] = useState<Record<string, boolean>>({});

  const meRef = useRef<Profile | null>(null);
  meRef.current = me;

  const micMutedRef = useRef<boolean>(false);
  micMutedRef.current = micMuted;

  const sessionRef = useRef<ActiveCallSession | null>(null);
  sessionRef.current = session;

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const roomChannelRef = useRef<any>(null);
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

  // Ресурсы гибридного голосового ретранслятора (Web Audio PCM Relay + WebRTC Stats)
  const micSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micProcessorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const micZeroGainRef = useRef<GainNode | null>(null);
  const nextPlayTimeBySenderRef = useRef<Record<string, number>>({});
  const speakingTimersRef = useRef<Record<string, any>>({});
  const webrtcAudioActiveRef = useRef<boolean>(false);
  const lastWebrtcBytesRef = useRef<number>(0);
  const statsTimerRef = useRef<any>(null);

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

  // Воспроизведение полученного PCM-фрагмента голоса через Web Audio API (резервный канал + микшер для групповых чатов)
  function playRemotePcmChunk(base64Pcm: string, sampleRate: number, senderId?: string) {
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
      if (nextTime < now || nextTime > now + 0.65) {
        nextTime = now + 0.04;
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      const gainNode = ctx.createGain();
      gainNode.gain.value = 1.45;

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
    lastWebrtcBytesRef.current = 0;
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

        if (rms > 0.0007) {
          trailingSilenceChunks = 3;
        } else if (trailingSilenceChunks > 0) {
          trailingSilenceChunks--;
        } else {
          pendingSamples = [];
          return;
        }

        // Даунсэмплинг до RELAY_SAMPLE_RATE (10 кГц моно)
        const outLength = Math.floor(input.length / ratio);
        for (let i = 0; i < outLength; i++) {
          const idx = Math.min(input.length - 1, Math.floor(i * ratio));
          const s = Math.max(-1, Math.min(1, input[idx]));
          pendingSamples.push(s < 0 ? s * 0x8000 : s * 0x7fff);
        }

        // Отправляем пакет каждые ~160 мс (1600 сэмплов при 10 кГц)
        if (pendingSamples.length >= 1600) {
          const int16 = new Int16Array(pendingSamples);
          pendingSamples = [];
          const b64 = encodeInt16ToBase64(int16);
          if (meRef.current?.id) {
            markSpeakerActive(meRef.current.id);
          }
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

    // Мониторим, идёт ли реальный аудио-поток по прямому WebRTC (чтобы не дублировать звук)
    statsTimerRef.current = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) {
        webrtcAudioActiveRef.current = false;
        return;
      }
      const ice = pc.iceConnectionState;
      if (ice !== 'connected' && ice !== 'completed') {
        webrtcAudioActiveRef.current = false;
        return;
      }
      try {
        const stats = await pc.getStats();
        let audioBytes = 0;
        stats.forEach((report: any) => {
          if (
            report.type === 'inbound-rtp' &&
            (report.kind === 'audio' || report.mediaType === 'audio')
          ) {
            audioBytes += report.bytesReceived || 0;
          }
        });
        const delta = audioBytes - lastWebrtcBytesRef.current;
        lastWebrtcBytesRef.current = audioBytes;
        const audioPlaying = Boolean(
          remoteAudioRef.current &&
            !remoteAudioRef.current.paused &&
            remoteAudioRef.current.srcObject
        );
        webrtcAudioActiveRef.current = delta > 400 && audioPlaying;
      } catch {
        webrtcAudioActiveRef.current = false;
      }
    }, 1200);
  }

  // Звуковой сигнал вызова (HTML5 WAV + Web Audio API + Вибрация)
  function startRingtone(isIncoming: boolean) {
    stopRingtone();
    const prefs = getNotificationPrefs();
    if (!prefs.sound) return;

    // 1. HTML5 Audio loop (надёжно работает на мобильных браузерах и в WebView)
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

    // 2. Дублирующий синтезатор Web Audio API + периодическая вибрация на телефонах
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
          osc.frequency.setValueAtTime(523.25, now); // C5
          osc.frequency.setValueAtTime(659.25, now + 0.18); // E5
          osc.frequency.setValueAtTime(783.99, now + 0.36); // G5
        } else {
          osc.frequency.setValueAtTime(440, now); // A4 гудок
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

        // 60-минутный лимит (3600 секунд) для обычных пользователей
        if (!isDevCall && next >= 3600) {
          clearInterval(timer);
          void handleEndCall();
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [session?.status, session?.callerIsDeveloper]);

  function syncRemoteAudioPlayback() {
    const stream = remoteStreamRef.current;
    if (!stream) return;
    if (remoteAudioRef.current) {
      if (remoteAudioRef.current.srcObject !== stream) {
        remoteAudioRef.current.srcObject = stream;
      }
      remoteAudioRef.current.muted = false;
      remoteAudioRef.current.volume = 1.0;
      void remoteAudioRef.current.play().catch(() => {});
    }
    if (remoteVideoRef.current && stream.getVideoTracks().length > 0) {
      if (remoteVideoRef.current.srcObject !== stream) {
        remoteVideoRef.current.srcObject = stream;
      }
      remoteVideoRef.current.muted = false;
      void remoteVideoRef.current.play().catch(() => {});
    }
  }

  // Привязка локального и удалённого медиа-потоков к video/audio элементам
  useEffect(() => {
    if (localVideoRef.current && (screenStreamRef.current || localStreamRef.current)) {
      localVideoRef.current.srcObject = screenStreamRef.current || localStreamRef.current;
    }
    syncRemoteAudioPlayback();
  }, [session, minimized, cameraEnabled, screenSharing, hasRemoteVideo]);

  // Гибридная ретрансляция видеокадров (камера / экран) для групповых звонков и симметричного NAT
  useEffect(() => {
    if (!session || (!cameraEnabled && !screenSharing)) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const timer = setInterval(() => {
      const vid = localVideoRef.current;
      if (!vid || !ctx || !roomChannelRef.current || vid.readyState < 2) return;
      const vw = vid.videoWidth || 480;
      const vh = vid.videoHeight || 270;
      const targetW = Math.min(480, vw);
      const targetH = Math.max(180, Math.round((vh / vw) * targetW));
      canvas.width = targetW;
      canvas.height = targetH;
      try {
        ctx.drawImage(vid, 0, 0, targetW, targetH);
        const frame = canvas.toDataURL('image/jpeg', 0.52);
        roomChannelRef.current.send({
          type: 'broadcast',
          event: 'video-frame',
          payload: {
            senderId: meRef.current?.id,
            frame,
          },
        });
      } catch {}
    }, 240);
    return () => clearInterval(timer);
  }, [session?.callId, cameraEnabled, screenSharing]);

  async function acquireLocalMedia(wantVideo: boolean): Promise<MediaStream> {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: wantVideo ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
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
    setRemoteRelayFrame(null);
    setGroupParticipants([]);
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

    // Если микрофон не был получен, добавляем приёмный аудио-трансивер, чтобы слышать собеседника
    if (localStream.getAudioTracks().length === 0) {
      try {
        pc.addTransceiver('audio', { direction: 'recvonly' });
      } catch {}
    }

    pc.ontrack = (event) => {
      const addTrackIfNeeded = (track: MediaStreamTrack) => {
        track.enabled = true;
        if (!remoteStream.getTracks().some((t) => t.id === track.id)) {
          remoteStream.addTrack(track);
        }
        if (track.kind === 'video') {
          setHasRemoteVideo(true);
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
      if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
        stopRingtone();
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
      if (makingOfferRef.current) return;
      if (pc.signalingState !== 'stable') return;
      makingOfferRef.current = true;
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
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
            setSession((prev) => (prev ? { ...prev, status: 'connected' } : null));
          }
          // Если второй участник уже в комнате, а соединение ещё не установлено — инициируем Offer
          if (isInitiator && hasOtherPeer && !pc.remoteDescription && pc.signalingState === 'stable') {
            void sendWebRtcOffer();
          }
        } catch {}
      })
      .on('broadcast', { event: 'call-accepted' }, async ({ payload }) => {
        if (payload?.senderId && payload.senderId === meRef.current?.id) return;
        stopRingtone();
        setSession((prev) => (prev ? { ...prev, status: 'connected' } : null));
        await sendWebRtcOffer();
      })
      .on('broadcast', { event: 'webrtc-offer' }, async ({ payload }) => {
        if (!payload?.sdp || (payload?.senderId && payload.senderId === meRef.current?.id)) return;
        stopRingtone();
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
        markSpeakerActive(payload.senderId);
        setSession((prev) =>
          prev && prev.status !== 'connected' ? { ...prev, status: 'connected' } : prev
        );
        // Если прямой WebRTC не передаёт звук (например, из-за симметричного NAT) или это групповой звонок — воспроизводим через Web Audio PCM Relay
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
            // Повторяем сигнал готовности, если инициатор ещё загружает микрофон
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

    // Отправляем приглашение в персональный сигнальный канал собеседника
    const supabase = getSupabaseClient();
    const targetChannel = supabase.channel(`pixchats-calls:${params.targetUserId}`);
    targetChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        targetChannel.send({
          type: 'broadcast',
          event: 'call-invite',
          payload: {
            callId,
            chatId: params.chatId,
            callerId: currentMe.id,
            callerName: currentMe.display_name,
            callerAvatar: currentMe.avatar_url,
            mode: params.mode,
            isGroup: false,
            callerIsDeveloper: isDeveloperUser(currentMe),
          },
        });
        setTimeout(() => {
          supabase.removeChannel(targetChannel);
        }, 2000);
      }
    });
  }

  // Начать групповой голосовой чат (Пункт 4: всем участникам группы приходит входящий вызов)
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

    // Оповещаем всех участников группы входящим вызовом (если это запуск нового звонка, а не тихое подключение к текущему)
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

        for (const uid of targetIds) {
          const ch = supabase.channel(`pixchats-calls:${uid}`);
          ch.subscribe((st) => {
            if (st === 'SUBSCRIBED') {
              ch.send({
                type: 'broadcast',
                event: 'call-invite',
                payload: {
                  callId,
                  chatId: params.chatId,
                  callerId: currentMe.id,
                  callerName: `🔊 ${params.chatTitle} (${currentMe.display_name})`,
                  callerAvatar: params.chatAvatar || currentMe.avatar_url,
                  mode,
                  isGroup: true,
                  callerIsDeveloper: isDeveloperUser(currentMe),
                },
              });
              setTimeout(() => {
                supabase.removeChannel(ch);
              }, 2500);
            }
          });
        }

        // Также отправляем сервисное уведомление в ленту группы
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

  async function handleToggleCamera() {
    if (!localStreamRef.current) return;
    const videoTracks = localStreamRef.current.getVideoTracks();

    if (videoTracks.length > 0) {
      const nextEnabled = !cameraEnabled;
      videoTracks.forEach((t) => {
        t.enabled = nextEnabled;
      });
      setCameraEnabled(nextEnabled);
      roomChannelRef.current?.send({
        type: 'broadcast',
        event: 'media-update',
        payload: { senderId: meRef.current?.id, video: nextEnabled },
      });
    } else {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const camTrack = camStream.getVideoTracks()[0];
        if (camTrack) {
          localStreamRef.current.addTrack(camTrack);
          if (pcRef.current) {
            pcRef.current.addTrack(camTrack, localStreamRef.current);
            const offer = await pcRef.current.createOffer();
            await pcRef.current.setLocalDescription(offer);
            roomChannelRef.current?.send({
              type: 'broadcast',
              event: 'webrtc-offer',
              payload: { senderId: meRef.current?.id, sdp: offer },
            });
          }
          setCameraEnabled(true);
          roomChannelRef.current?.send({
            type: 'broadcast',
            event: 'media-update',
            payload: { senderId: meRef.current?.id, video: true },
          });
        }
      } catch {}
    }
  }

  async function handleToggleScreenShare() {
    if (screenSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      setScreenSharing(false);

      const camTrack = localStreamRef.current?.getVideoTracks()?.[0] || null;
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
      if (sender && camTrack && cameraEnabled) {
        await sender.replaceTrack(camTrack);
      } else {
        roomChannelRef.current?.send({
          type: 'broadcast',
          event: 'media-update',
          payload: { senderId: meRef.current?.id, video: Boolean(cameraEnabled) },
        });
      }
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) return;

      screenStreamRef.current = displayStream;
      setScreenSharing(true);

      screenTrack.onended = () => {
        setScreenSharing(false);
        screenStreamRef.current = null;
        roomChannelRef.current?.send({
          type: 'broadcast',
          event: 'media-update',
          payload: { senderId: meRef.current?.id, video: Boolean(cameraEnabled) },
        });
      };

      if (pcRef.current) {
        const sender = pcRef.current.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(screenTrack);
        } else {
          pcRef.current.addTrack(screenTrack, displayStream);
          const offer = await pcRef.current.createOffer();
          await pcRef.current.setLocalDescription(offer);
          roomChannelRef.current?.send({
            type: 'broadcast',
            event: 'webrtc-offer',
            payload: { senderId: meRef.current?.id, sdp: offer },
          });
        }
      }

      roomChannelRef.current?.send({
        type: 'broadcast',
        event: 'media-update',
        payload: { senderId: meRef.current?.id, video: true },
      });
    } catch {}
  }

  // Глобальная подписка на входящие звонки (личные и групповые)
  useEffect(() => {
    let personalCallChannel: any = null;

    (async () => {
      const profile = await getCurrentProfile();
      if (!profile) return;
      setMe(profile);
      meRef.current = profile;

      const supabase = getSupabaseClient();
      personalCallChannel = supabase
        .channel(`pixchats-calls:${profile.id}`)
        .on('broadcast', { event: 'call-invite' }, ({ payload }) => {
          if (!payload || sessionRef.current) return;

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
        })
        .on('broadcast', { event: 'call-cancelled' }, ({ payload }) => {
          if (payload?.callId && sessionRef.current?.callId === payload.callId) {
            cleanupCallResources();
          }
        })
        .subscribe();
    })();

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
      if (personalCallChannel) {
        getSupabaseClient().removeChannel(personalCallChannel);
      }
    };
  }, [me?.id]);

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
              style={{ width: 'auto', padding: '6px 8px', fontSize: 12, background: micMuted ? 'var(--danger)' : undefined }}
              onClick={handleToggleMic}
              title={micMuted ? 'Включить микрофон' : 'Выключить микрофон'}
            >
              {micMuted ? '🔇' : '🎤'}
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
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
            {session.callerIsDeveloper
              ? '👑 Безлимитный звонок разработчика Pixset Studio'
              : session.isGroup
                ? `🔊 Голосовая комната группы (${groupParticipants.length || 1} уч.)`
                : '🔒 Зашифрованный звонок PixChats (WebRTC)'}
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

      {/* Центральная область */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          width: '100%',
          maxWidth: 960,
          margin: '16px auto',
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
        {hasRemoteVideo ? (
          <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
            />
            {remoteRelayFrame && (session.isGroup || !remoteStreamRef.current?.getVideoTracks().some((t) => t.readyState === 'live')) && (
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
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        )}
      </div>

      {/* Нижняя панель управления звонком */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          className="btn"
          style={{
            width: 'auto',
            padding: '11px 18px',
            borderColor: micMuted ? 'var(--danger)' : undefined,
            color: micMuted ? 'var(--danger)' : undefined,
          }}
          onClick={handleToggleMic}
        >
          {micMuted ? '🔇 Микрофон выкл' : '🎤 Микрофон вкл'}
        </button>

        <button
          type="button"
          className="btn"
          style={{
            width: 'auto',
            padding: '11px 18px',
            borderColor: cameraEnabled ? 'var(--accent)' : undefined,
            color: cameraEnabled ? 'var(--accent)' : undefined,
          }}
          onClick={handleToggleCamera}
        >
          {cameraEnabled ? '📷 Камера вкл' : '📷 Включить камеру'}
        </button>

        <button
          type="button"
          className="btn"
          style={{
            width: 'auto',
            padding: '11px 18px',
            borderColor: screenSharing ? 'var(--accent)' : undefined,
            color: screenSharing ? 'var(--accent)' : undefined,
          }}
          onClick={handleToggleScreenShare}
        >
          {screenSharing ? '🖥️ Остановить экран' : '🖥️ Демонстрация экрана'}
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

