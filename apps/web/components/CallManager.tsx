'use client';

import React, { useEffect, useRef, useState } from 'react';
import { getCurrentProfile, getSupabaseClient, sendMessage } from '@pixchats/core';
import type { Profile } from '@pixchats/core';
import { getNotificationPrefs } from '../lib/notificationPrefs';
import { sendNativeOrWebNotification } from '../lib/nativePlatform';

export interface StartCallParams {
  targetUserId: string;
  targetName: string;
  targetAvatar?: string | null;
  chatId?: string;
  mode: 'audio' | 'video';
}

export function startPixChatsCall(params: StartCallParams): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<StartCallParams>('pixchats:start_call', { detail: params }));
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
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
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
  const ringtoneTimerRef = useRef<any>(null);
  const durationRef = useRef<number>(0);

  // Звуковой сигнал вызова (Web Audio API)
  function startRingtone(isIncoming: boolean) {
    stopRingtone();
    const prefs = getNotificationPrefs();
    if (!prefs.sound) return;

    const playTone = () => {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
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
        gain.gain.linearRampToValueAtTime(0.14, now + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.7);
      } catch {}
    };

    playTone();
    ringtoneTimerRef.current = setInterval(playTone, 2200);
  }

  function stopRingtone() {
    if (ringtoneTimerRef.current) {
      clearInterval(ringtoneTimerRef.current);
      ringtoneTimerRef.current = null;
    }
  }

  // Таймер длительности активного разговора
  useEffect(() => {
    if (session?.status !== 'connected') {
      setDurationSec(0);
      durationRef.current = 0;
      return;
    }
    const timer = setInterval(() => {
      setDurationSec((prev) => {
        const next = prev + 1;
        durationRef.current = next;
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [session?.status]);

  // Привязка локального и удалённого медиа-потоков к video/audio элементам
  useEffect(() => {
    if (localVideoRef.current && (screenStreamRef.current || localStreamRef.current)) {
      localVideoRef.current.srcObject = screenStreamRef.current || localStreamRef.current;
    }
    if (remoteVideoRef.current && remoteStreamRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }
    if (remoteAudioRef.current && remoteStreamRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current;
    }
  }, [session, minimized, cameraEnabled, screenSharing, hasRemoteVideo]);

  async function acquireLocalMedia(wantVideo: boolean): Promise<MediaStream> {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: wantVideo ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
        });
        setCameraEnabled(wantVideo && stream.getVideoTracks().length > 0);
        setMicMuted(false);
        return stream;
      } catch {
        if (wantVideo) {
          try {
            const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            setCameraEnabled(false);
            setMicMuted(false);
            return audioOnly;
          } catch {}
        }
      }
    }
    setCameraEnabled(false);
    return new MediaStream();
  }

  function cleanupCallResources() {
    stopRingtone();

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
    setCameraEnabled(false);
    setScreenSharing(false);
    setHasRemoteVideo(false);
  }

  function createPeerConnection(callId: string, localStream: MediaStream): RTCPeerConnection {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const remoteStream = new MediaStream();
    remoteStreamRef.current = remoteStream;

    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });

    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => {
        remoteStream.addTrack(track);
        if (track.kind === 'video') {
          setHasRemoteVideo(true);
        }
      });
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && roomChannelRef.current) {
        roomChannelRef.current.send({
          type: 'broadcast',
          event: 'ice-candidate',
          payload: {
            senderId: me?.id,
            candidate: event.candidate.toJSON(),
          },
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        stopRingtone();
        setSession((prev) => (prev ? { ...prev, status: 'connected' } : null));
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        // удерживаем сессию до явного завершения или восстановления
      }
    };

    pcRef.current = pc;
    return pc;
  }

  function joinSignalingRoom(activeSess: ActiveCallSession, isInitiator: boolean, localStream: MediaStream) {
    const supabase = getSupabaseClient();
    const room = supabase.channel(`pixchats-call-room:${activeSess.callId}`);
    roomChannelRef.current = room;

    const pc = createPeerConnection(activeSess.callId, localStream);

    room
      .on('broadcast', { event: 'call-accepted' }, async ({ payload }) => {
        if (!isInitiator || payload?.senderId === me?.id) return;
        stopRingtone();
        setSession((prev) => (prev ? { ...prev, status: 'connecting' } : null));
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          room.send({
            type: 'broadcast',
            event: 'webrtc-offer',
            payload: { senderId: me?.id, sdp: offer },
          });
        } catch {}
      })
      .on('broadcast', { event: 'webrtc-offer' }, async ({ payload }) => {
        if (!payload?.sdp || payload?.senderId === me?.id) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          room.send({
            type: 'broadcast',
            event: 'webrtc-answer',
            payload: { senderId: me?.id, sdp: answer },
          });
          stopRingtone();
          setSession((prev) => (prev ? { ...prev, status: 'connected' } : null));
        } catch {}
      })
      .on('broadcast', { event: 'webrtc-answer' }, async ({ payload }) => {
        if (!payload?.sdp || payload?.senderId === me?.id) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          stopRingtone();
          setSession((prev) => (prev ? { ...prev, status: 'connected' } : null));
        } catch {}
      })
      .on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
        if (!payload?.candidate || payload?.senderId === me?.id) return;
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch {}
      })
      .on('broadcast', { event: 'media-update' }, ({ payload }) => {
        if (payload?.senderId === me?.id) return;
        if (typeof payload?.video === 'boolean') {
          setHasRemoteVideo(payload.video);
        }
      })
      .on('broadcast', { event: 'hangup' }, () => {
        cleanupCallResources();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && !isInitiator) {
          room.send({
            type: 'broadcast',
            event: 'call-accepted',
            payload: { senderId: me?.id },
          });
        }
      });
  }

  // Начать исходящий звонок
  async function handleStartOutgoingCall(params: StartCallParams) {
    if (!me || sessionRef.current) return;

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
            callerId: me.id,
            callerName: me.display_name,
            callerAvatar: me.avatar_url,
            mode: params.mode,
          },
        });
        setTimeout(() => {
          supabase.removeChannel(targetChannel);
        }, 2000);
      }
    });
  }

  // Принять входящий звонок
  async function handleAcceptIncomingCall() {
    const current = sessionRef.current;
    if (!current || !me) return;

    stopRingtone();
    setSession({ ...current, status: 'connecting' });

    const localStream = await acquireLocalMedia(current.mode === 'video');
    localStreamRef.current = localStream;

    joinSignalingRoom(current, false, localStream);
  }

  // Завершить или отклонить звонок
  async function handleEndCall() {
    const current = sessionRef.current;
    const elapsed = durationRef.current;

    if (roomChannelRef.current) {
      try {
        roomChannelRef.current.send({
          type: 'broadcast',
          event: 'hangup',
          payload: { senderId: me?.id },
        });
      } catch {}
    }

    // Если звонок ещё на стадии вызова — уведомляем собеседника об отмене/отклонении
    if (current && current.status === 'ringing') {
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

    // Записываем системное сообщение о звонке в чат, если была инициация из чата
    if (current?.chatId && current.direction === 'outgoing') {
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
        payload: { senderId: me?.id, video: nextEnabled },
      });
    } else {
      // Если звонок начинался как аудио — динамически включаем камеру и добавляем трек
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
              payload: { senderId: me?.id, sdp: offer },
            });
          }
          setCameraEnabled(true);
          roomChannelRef.current?.send({
            type: 'broadcast',
            event: 'media-update',
            payload: { senderId: me?.id, video: true },
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

      // Возвращаем видео с камеры, если она была включена
      const camTrack = localStreamRef.current?.getVideoTracks()?.[0] || null;
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
      if (sender && camTrack) {
        await sender.replaceTrack(camTrack);
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
            payload: { senderId: me?.id, sdp: offer },
          });
        }
      }

      roomChannelRef.current?.send({
        type: 'broadcast',
        event: 'media-update',
        payload: { senderId: me?.id, video: true },
      });
    } catch {
      // пользователь отменил выбор экрана
    }
  }

  // Глобальная подписка на входящие звонки и локальные события старта звонка
  useEffect(() => {
    let personalCallChannel: any = null;

    (async () => {
      const profile = await getCurrentProfile();
      if (!profile) return;
      setMe(profile);

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
          };

          setSession(incoming);
          startRingtone(true);

          const prefs = getNotificationPrefs();
          if (prefs.enabled && prefs.incomingCalls !== false) {
            // Если это нативная .exe версия в фоне — будим окно и показываем системный Toast
            if (window.pixchatsDesktop?.notifyIncomingCall) {
              void window.pixchatsDesktop.notifyIncomingCall({
                callerName: incoming.peerName,
                mode: incoming.mode,
                chatId: incoming.chatId,
              });
            } else {
              void sendNativeOrWebNotification({
                title: incoming.mode === 'video' ? '📹 Входящий видеозвонок' : '📞 Входящий аудиозвонок',
                body: `${incoming.peerName} звонит вам в PixChats`,
                url: incoming.chatId ? `/chat/?id=${incoming.chatId}` : '/chats/',
                silent: !prefs.sound,
              });
            }
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

    window.addEventListener('pixchats:start_call', onStartCallEvent);
    return () => {
      window.removeEventListener('pixchats:start_call', onStartCallEvent);
      if (personalCallChannel) {
        getSupabaseClient().removeChannel(personalCallChannel);
      }
    };
  }, [me?.id]);

  if (!session) return null;

  // 1. Входящий вызов (ожидание ответа)
  if (session.direction === 'incoming' && session.status === 'ringing') {
    return (
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
            {session.mode === 'video' ? '📹 Входящий видеозвонок' : '📞 Входящий аудиозвонок'}
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
            {!session.peerAvatar && session.peerName.slice(0, 1).toUpperCase()}
          </div>

          <h3 style={{ margin: '0 0 6px', fontSize: 20 }}>{session.peerName}</h3>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
            Вызывает вас в PixChats…
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
              📞 Принять
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Свёрнутое плавающее мини-окно звонка (позволяет переписываться в чатах во время разговора)
  if (minimized) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 9999,
          width: 280,
          background: 'var(--surface-raised)',
          border: '1.5px solid var(--accent)',
          borderRadius: 14,
          padding: 12,
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <audio ref={remoteAudioRef} autoPlay playsInline />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div
            className={`avatar ${!session.peerAvatar ? 'avatar-fallback' : ''}`}
            style={{
              width: 38,
              height: 38,
              fontSize: 15,
              flexShrink: 0,
              backgroundImage: session.peerAvatar ? `url(${session.peerAvatar})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            {!session.peerAvatar && session.peerName.slice(0, 1).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {session.peerName}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--accent)' }}>
              {session.status === 'connected' ? formatDuration(durationSec) : 'Соединение…'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', padding: '6px 9px', fontSize: 12 }}
            onClick={() => setMinimized(false)}
            title="Развернуть окно звонка"
          >
            ⛶
          </button>
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', padding: '6px 9px', fontSize: 12, background: '#dc2626', color: '#fff' }}
            onClick={handleEndCall}
            title="Завершить звонок"
          >
            📵
          </button>
        </div>
      </div>
    );
  }

  // 3. Полноэкранное окно активного звонка (аудио / видео / демонстрация экрана)
  return (
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
      <audio ref={remoteAudioRef} autoPlay playsInline />

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
            🔒 Зашифрованный звонок PixChats (WebRTC)
          </span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            · {session.status === 'connected' ? formatDuration(durationSec) : session.status === 'ringing' ? 'Вызов…' : 'Соединение…'}
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

      {/* Центральная область (видео или аватар собеседника) */}
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
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {hasRemoteVideo ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
          />
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
              {!session.peerAvatar && session.peerName.slice(0, 1).toUpperCase()}
            </div>
            <h2 style={{ margin: '0 0 6px', fontSize: 22 }}>{session.peerName}</h2>
            <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
              {session.status === 'ringing'
                ? 'Ожидание ответа собеседника…'
                : session.status === 'connecting'
                  ? 'Установка защищённого аудио/видео канала…'
                  : `В разговоре · ${formatDuration(durationSec)}`}
            </div>
          </div>
        )}

        {/* Превью собственной камеры или демонстрации экрана (Picture-in-Picture) */}
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
          📵 Завершить звонок
        </button>
      </div>
    </div>
  );
}
