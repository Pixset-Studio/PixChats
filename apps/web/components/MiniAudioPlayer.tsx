'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  closeGlobalAudioPlayer,
  cycleGlobalAudioSpeed,
  getGlobalAudioState,
  seekGlobalAudio,
  toggleGlobalAudioPlayPause,
  type GlobalAudioState,
} from '../lib/audioPlayerStore';

function formatSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function MiniAudioPlayer() {
  const router = useRouter();
  const [state, setState] = useState<GlobalAudioState>(() => getGlobalAudioState());

  useEffect(() => {
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<GlobalAudioState>).detail;
      if (detail) setState(detail);
    };
    window.addEventListener('pixchats:global_audio_state', onUpdate);
    return () => window.removeEventListener('pixchats:global_audio_state', onUpdate);
  }, []);

  if (!state.track) return null;

  const progress = state.duration > 0 ? Math.min(100, (state.currentTime / state.duration) * 100) : 0;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 64,
        right: 16,
        left: 16,
        maxWidth: 460,
        margin: '0 auto',
        zIndex: 9000,
        background: 'rgba(14, 14, 17, 0.96)',
        border: '1px solid rgba(255, 212, 0, 0.45)',
        borderRadius: 12,
        padding: '8px 12px',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <button
          type="button"
          onClick={() => toggleGlobalAudioPlayPause()}
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'var(--accent)',
            color: '#09090b',
            border: 'none',
            fontWeight: 800,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
          title={state.playing ? 'Пауза' : 'Воспроизвести'}
        >
          {state.playing ? '⏸' : '▶'}
        </button>

        <div
          style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
          onClick={() => {
            if (state.track?.chatId) {
              router.push(`/chat/?id=${state.track.chatId}&msg=${state.track.id}`);
            }
          }}
          title="Перейти к сообщению в чате"
        >
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {state.track.title}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {state.track.senderName} • {state.track.chatTitle} • {formatSec(state.currentTime)} / {formatSec(state.duration)}
          </div>
        </div>

        <button
          type="button"
          className="btn"
          style={{ width: 'auto', padding: '3px 8px', fontSize: 11, fontWeight: 700, borderRadius: 6 }}
          onClick={() => cycleGlobalAudioSpeed()}
          title="Скорость воспроизведения"
        >
          {state.playbackRate}x
        </button>

        <button
          type="button"
          className="btn-ghost"
          style={{ width: 'auto', padding: '3px 7px', fontSize: 13 }}
          onClick={() => closeGlobalAudioPlayer()}
          title="Закрыть мини-плеер"
        >
          ✕
        </button>
      </div>

      {/* Интерактивная полоса перемотки */}
      <div
        style={{
          width: '100%',
          height: 5,
          borderRadius: 999,
          background: 'rgba(255, 255, 255, 0.12)',
          cursor: 'pointer',
          overflow: 'hidden',
        }}
        onClick={(e) => {
          if (!state.duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          seekGlobalAudio(ratio * state.duration);
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: '100%',
            background: 'var(--accent)',
            transition: 'width 0.1s linear',
          }}
        />
      </div>
    </div>
  );
}
