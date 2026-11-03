'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  closeGlobalAudioPlayer,
  cycleGlobalAudioSpeed,
  getGlobalAudioState,
  playGlobalAudioTrack,
  playNextGlobalAudioTrack,
  playPrevGlobalAudioTrack,
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
  const [showPlaylist, setShowPlaylist] = useState(false);

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
  const hasMultipleTracks = state.playlist && state.playlist.length > 1;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 64,
        right: 16,
        left: 16,
        maxWidth: 480,
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {hasMultipleTracks && (
          <button
            type="button"
            className="btn-ghost"
            style={{ width: 'auto', padding: '3px 6px', fontSize: 12 }}
            onClick={() => playPrevGlobalAudioTrack()}
            title="Предыдущий трек в чате"
          >
            ⏮
          </button>
        )}

        <button
          type="button"
          onClick={() => toggleGlobalAudioPlayPause()}
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'var(--accent)',
            color: '#000',
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

        {hasMultipleTracks && (
          <button
            type="button"
            className="btn-ghost"
            style={{ width: 'auto', padding: '3px 6px', fontSize: 12 }}
            onClick={() => playNextGlobalAudioTrack()}
            title="Следующий трек в чате"
          >
            ⏭
          </button>
        )}

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
            🎵 {state.track.title}
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

        {state.playlist && state.playlist.length > 0 && (
          <button
            type="button"
            className="btn"
            style={{
              width: 'auto',
              padding: '3px 8px',
              fontSize: 11,
              fontWeight: 700,
              borderRadius: 6,
              borderColor: showPlaylist ? 'var(--accent)' : undefined,
              color: showPlaylist ? 'var(--accent)' : undefined,
            }}
            onClick={() => setShowPlaylist((v) => !v)}
            title="Плейлист аудиозаписей чата"
          >
            🎶 {state.playlist.length}
          </button>
        )}

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

      {/* Раскрывающийся плейлист чата */}
      {showPlaylist && state.playlist.length > 0 && (
        <div
          style={{
            maxHeight: 160,
            overflowY: 'auto',
            borderTop: '1px solid var(--border)',
            paddingTop: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Плейлист чата ({state.playlist.length})
          </div>
          {state.playlist.map((item, idx) => {
            const isCurrent = item.id === state.track?.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => playGlobalAudioTrack(item, state.playlist)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '5px 8px',
                  borderRadius: 7,
                  border: isCurrent ? '1px solid var(--accent)' : '1px solid transparent',
                  background: isCurrent ? 'rgba(255, 212, 0, 0.14)' : 'rgba(255, 255, 255, 0.03)',
                  color: 'var(--text)',
                  fontSize: 12,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isCurrent ? 700 : 500 }}>
                  {idx + 1}. {item.title}
                </span>
                <span style={{ fontSize: 10.5, color: isCurrent ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }}>
                  {item.senderName}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
