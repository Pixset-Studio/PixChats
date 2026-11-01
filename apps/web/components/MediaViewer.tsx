'use client';

import React, { useEffect, useRef, useState } from 'react';

function formatMediaTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export interface CustomVideoPlayerProps {
  src: string;
  poster?: string;
  title?: string;
  circular?: boolean;
  maxWidth?: number | string;
  maxHeight?: number | string;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  filterCss?: string;
  onExpandFullscreen?: () => void;
  onOpenFullscreen?: (videoUrl: string) => void;
}

export function CustomVideoPlayer({
  src,
  poster,
  title,
  circular = false,
  maxWidth = 340,
  maxHeight = 320,
  autoPlay = false,
  muted: initialMuted = false,
  loop = false,
  filterCss,
  onExpandFullscreen,
  onOpenFullscreen,
}: CustomVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fixingInfinityDurationRef = useRef(false);

  const [playing, setPlaying] = useState(Boolean(autoPlay));
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedPct, setBufferedPct] = useState(0);
  const [muted, setMuted] = useState(Boolean(initialMuted));
  const [volume, setVolume] = useState(1);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [showControls, setShowControls] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [skipFeedback, setSkipFeedback] = useState<'back' | 'forward' | null>(null);

  useEffect(() => {
    setLoadError(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  function togglePlay(e?: React.MouseEvent) {
    e?.stopPropagation();
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused || vid.ended) {
      vid.play()
        .then(() => setPlaying(true))
        .catch(() => {
          // Retry muted if browser autoplay policy blocked unmuted play
          vid.muted = true;
          setMuted(true);
          vid.play().then(() => setPlaying(true)).catch(() => {});
        });
    } else {
      vid.pause();
      setPlaying(false);
    }
  }

  function skipSeconds(delta: number, e?: React.MouseEvent) {
    e?.stopPropagation();
    const vid = videoRef.current;
    if (!vid) return;
    const maxDur = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : duration || 3600;
    const next = Math.max(0, Math.min(maxDur, (vid.currentTime || 0) + delta));
    vid.currentTime = next;
    setCurrentTime(next);
    setSkipFeedback(delta < 0 ? 'back' : 'forward');
    setTimeout(() => setSkipFeedback(null), 550);
  }

  function toggleMute(e: React.MouseEvent) {
    e.stopPropagation();
    const vid = videoRef.current;
    if (!vid) return;
    const next = !muted;
    vid.muted = next;
    setMuted(next);
  }

  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    e.stopPropagation();
    const vid = videoRef.current;
    const val = Number(e.target.value);
    setVolume(val);
    if (vid) {
      vid.volume = val;
      vid.muted = val === 0;
    }
    setMuted(val === 0);
  }

  function cycleSpeed(e: React.MouseEvent) {
    e.stopPropagation();
    const speeds = [1, 1.25, 1.5, 2, 0.75];
    const next = speeds[(speeds.indexOf(playbackRate) + 1) % speeds.length];
    setPlaybackRate(next);
    if (videoRef.current) {
      videoRef.current.playbackRate = next;
    }
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    e.stopPropagation();
    const vid = videoRef.current;
    const nextTime = Number(e.target.value);
    setCurrentTime(nextTime);
    if (vid && !fixingInfinityDurationRef.current) {
      vid.currentTime = nextTime;
    }
  }

  async function togglePiP(e: React.MouseEvent) {
    e.stopPropagation();
    const vid = videoRef.current as any;
    if (!vid) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (typeof vid.requestPictureInPicture === 'function') {
        await vid.requestPictureInPicture();
      }
    } catch {
      // ignore
    }
  }

  function handleFullscreen(e: React.MouseEvent) {
    e.stopPropagation();
    if (onExpandFullscreen) {
      onExpandFullscreen();
      return;
    }
    const container = containerRef.current as any;
    const vid = videoRef.current as any;
    try {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else if (container && typeof container.requestFullscreen === 'function') {
        void container.requestFullscreen();
      } else if (vid && typeof vid.requestFullscreen === 'function') {
        void vid.requestFullscreen();
      } else if (vid && typeof vid.webkitEnterFullscreen === 'function') {
        vid.webkitEnterFullscreen();
      }
    } catch {
      // ignore
    }
  }

  function handleLoadedMetadata(e: React.SyntheticEvent<HTMLVideoElement>) {
    const vid = e.currentTarget;
    if (vid.duration === Infinity || Number.isNaN(vid.duration)) {
      // Fix WebM blobs recorded via MediaRecorder that report Infinity duration initially
      fixingInfinityDurationRef.current = true;
      vid.currentTime = 1e101;
      const onSeeked = () => {
        vid.removeEventListener('timeupdate', onSeeked);
        fixingInfinityDurationRef.current = false;
        if (Number.isFinite(vid.duration) && vid.duration > 0) {
          setDuration(vid.duration);
        }
        vid.currentTime = 0;
        setCurrentTime(0);
      };
      vid.addEventListener('timeupdate', onSeeked);
    } else if (Number.isFinite(vid.duration) && vid.duration > 0) {
      setDuration(vid.duration);
    }
  }

  function handleTimeUpdate(e: React.SyntheticEvent<HTMLVideoElement>) {
    if (fixingInfinityDurationRef.current) return;
    const vid = e.currentTarget;
    const cur = vid.currentTime || 0;
    setCurrentTime(cur);

    if (Number.isFinite(vid.duration) && vid.duration > 0) {
      setDuration(vid.duration);
    } else if (cur > duration) {
      setDuration(cur + 1);
    }

    try {
      if (vid.buffered && vid.buffered.length > 0 && duration > 0) {
        const end = vid.buffered.end(vid.buffered.length - 1);
        setBufferedPct(Math.min(100, Math.round((end / duration) * 100)));
      }
    } catch {
      // ignore
    }
  }

  if (circular) {
    const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
    return (
      <div
        style={{
          position: 'relative',
          width: 228,
          height: 228,
          borderRadius: '50%',
          overflow: 'hidden',
          border: '3px solid var(--accent)',
          boxShadow: '0 8px 28px rgba(255, 212, 0, 0.24)',
          background: '#000',
          cursor: 'pointer',
          marginTop: 6,
        }}
        onClick={togglePlay}
      >
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          playsInline
          preload="metadata"
          loop={loop}
          muted={muted}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: filterCss && filterCss !== 'none' ? filterCss : undefined,
          }}
        />
        {!playing && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.32)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'rgba(255, 212, 0, 0.92)',
                color: '#09090b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                fontWeight: 900,
                boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
              }}
            >
              ▶
            </span>
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.68)',
            color: '#fff',
            fontSize: 10.5,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 999,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>{formatMediaTime(currentTime)}</span>
          <span style={{ opacity: 0.6 }}>{Math.round(pct)}%</span>
        </div>
      </div>
    );
  }

  const effectiveDuration = Math.max(duration, currentTime, 0.1);
  const playedPct = Math.min(100, (currentTime / effectiveDuration) * 100);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'k') {
          e.preventDefault();
          togglePlay();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          skipSeconds(-5);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          skipSeconds(5);
        } else if (e.key === 'm' || e.key === 'M') {
          e.preventDefault();
          if (videoRef.current) {
            videoRef.current.muted = !muted;
            setMuted(!muted);
          }
        }
      }}
      style={{
        position: 'relative',
        maxWidth,
        width: '100%',
        borderRadius: 14,
        overflow: 'hidden',
        background: '#050507',
        border: '1px solid rgba(255,255,255,0.14)',
        marginTop: 6,
        userSelect: 'none',
        outline: 'none',
      }}
      onMouseEnter={() => setShowControls(true)}
      onClick={(e) => e.stopPropagation()}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        playsInline
        preload="metadata"
        autoPlay={autoPlay}
        loop={loop}
        muted={muted}
        onClick={togglePlay}
        onDoubleClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          if (clickX < rect.width * 0.4) {
            skipSeconds(-10, e);
          } else if (clickX > rect.width * 0.6) {
            skipSeconds(10, e);
          } else {
            handleFullscreen(e);
          }
        }}
        onPlay={() => {
          setPlaying(true);
          setBuffering(false);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onError={() => setLoadError(true)}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        style={{
          display: 'block',
          width: '100%',
          maxHeight,
          objectFit: 'contain',
          cursor: 'pointer',
          background: '#000',
          filter: filterCss && filterCss !== 'none' ? filterCss : undefined,
        }}
      />

      {/* Индикатор буферизации */}
      {buffering && playing && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            background: 'rgba(0,0,0,0.25)',
          }}
        >
          <div
            style={{
              padding: '8px 14px',
              borderRadius: 999,
              background: 'rgba(0,0,0,0.78)',
              color: '#ffd400',
              fontSize: 12,
              fontWeight: 700,
              border: '1px solid rgba(255,212,0,0.35)',
            }}
          >
            ⏳ Загрузка видео…
          </div>
        </div>
      )}

      {/* Индикатор перемотки -10с / +10с */}
      {skipFeedback && (
        <div
          style={{
            position: 'absolute',
            top: '45%',
            left: skipFeedback === 'back' ? '20%' : '80%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(0,0,0,0.75)',
            color: '#ffd400',
            padding: '8px 14px',
            borderRadius: 999,
            fontWeight: 800,
            fontSize: 13,
            pointerEvents: 'none',
          }}
        >
          {skipFeedback === 'back' ? '⏪ -10 сек' : '⏩ +10 сек'}
        </div>
      )}

      {/* Ошибка воспроизведения */}
      {loadError && (
        <div
          style={{
            padding: 16,
            textAlign: 'center',
            background: 'rgba(24,24,27,0.95)',
            color: '#e4e4e7',
            fontSize: 12,
          }}
        >
          <div style={{ marginBottom: 8 }}>⚠️ Не удалось воспроизвести видео встроенным кодеком.</div>
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="btn btn-compact btn-primary"
            style={{ display: 'inline-block', width: 'auto', textDecoration: 'none' }}
          >
            📥 Открыть / Скачать видео
          </a>
        </div>
      )}

      {/* Центральная кнопка Play при паузе */}
      {!playing && !loadError && (
        <div
          onClick={togglePlay}
          style={{
            position: 'absolute',
            inset: 0,
            bottom: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.24)',
            cursor: 'pointer',
          }}
        >
          <span
            style={{
              width: 54,
              height: 54,
              borderRadius: '50%',
              background: 'rgba(255, 212, 0, 0.94)',
              color: '#09090b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              fontWeight: 900,
              boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
            }}
          >
            ▶
          </span>
        </div>
      )}

      {/* Панель управления плеером */}
      {showControls && !loadError && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'linear-gradient(to top, rgba(0,0,0,0.94), rgba(0,0,0,0.62))',
            padding: '8px 10px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {/* Прогресс-бар с полосой буфера */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 14 }}>
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                height: 5,
                borderRadius: 999,
                background: 'rgba(255,255,255,0.18)',
                overflow: 'hidden',
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  width: `${bufferedPct}%`,
                  height: '100%',
                  background: 'rgba(255,255,255,0.32)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: `${playedPct}%`,
                  height: '100%',
                  background: '#ffd400',
                }}
              />
            </div>
            <input
              type="range"
              min={0}
              max={effectiveDuration}
              step={0.05}
              value={Math.min(currentTime, effectiveDuration)}
              onChange={handleSeek}
              style={{
                position: 'relative',
                width: '100%',
                accentColor: '#ffd400',
                height: 14,
                cursor: 'pointer',
                margin: 0,
                opacity: 0.9,
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 6,
              color: '#fff',
              fontSize: 11.5,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <button
                type="button"
                onClick={togglePlay}
                style={{
                  background: 'rgba(255,255,255,0.14)',
                  border: 'none',
                  borderRadius: 6,
                  color: '#ffd400',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 900,
                  padding: '3px 8px',
                }}
                title={playing ? 'Пауза (Space)' : 'Воспроизвести (Space)'}
              >
                {playing ? '⏸' : '▶'}
              </button>

              <button
                type="button"
                onClick={(e) => skipSeconds(-10, e)}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 6,
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: '2px 5px',
                }}
                title="Назад на 10 секунд"
              >
                -10с
              </button>

              <button
                type="button"
                onClick={(e) => skipSeconds(10, e)}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 6,
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: '2px 5px',
                }}
                title="Вперёд на 10 секунд"
              >
                +10с
              </button>

              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.9)', marginLeft: 2 }}>
                {formatMediaTime(currentTime)} / {formatMediaTime(duration)}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <button
                type="button"
                onClick={toggleMute}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 13,
                  padding: '2px 4px',
                }}
                title={muted ? 'Включить звук (M)' : 'Выключить звук (M)'}
              >
                {muted || volume === 0 ? '🔇' : '🔊'}
              </button>

              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={handleVolumeChange}
                style={{ width: 48, accentColor: '#ffd400', cursor: 'pointer' }}
                title="Громкость"
              />

              <button
                type="button"
                onClick={cycleSpeed}
                style={{
                  background: 'rgba(255,255,255,0.14)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 6,
                  color: '#fff',
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: '2px 6px',
                  cursor: 'pointer',
                }}
                title="Скорость воспроизведения"
              >
                {playbackRate}x
              </button>

              <button
                type="button"
                onClick={togglePiP}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '2px 4px',
                }}
                title="Картинка в картинке (PiP)"
              >
                ⧉
              </button>

              <button
                type="button"
                onClick={handleFullscreen}
                style={{
                  background: 'rgba(255, 212, 0, 0.2)',
                  border: '1px solid rgba(255, 212, 0, 0.45)',
                  borderRadius: 6,
                  color: '#ffd400',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 800,
                  padding: '2px 6px',
                }}
                title="На весь экран"
              >
                ⛶
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export interface MediaGalleryItem {
  id: string;
  url: string;
  type: 'image' | 'video';
  caption?: string;
}

export interface CustomMediaLightboxProps {
  url?: string;
  type?: 'image' | 'video';
  activeUrl?: string;
  activeType?: 'image' | 'video';
  title?: string;
  gallery?: MediaGalleryItem[];
  onSelectItem?: (item: MediaGalleryItem) => void;
  onClose: () => void;
}

export function CustomMediaLightbox({
  url,
  type,
  activeUrl,
  activeType,
  title,
  gallery = [],
  onSelectItem,
  onClose,
}: CustomMediaLightboxProps) {
  const resolvedUrl = activeUrl || url || '';
  const resolvedType = activeType || type || 'image';

  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const currentIndex = gallery.findIndex((g) => g.url === resolvedUrl);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < gallery.length - 1;

  useEffect(() => {
    setZoom(1);
    setRotation(0);
  }, [resolvedUrl]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{
        background: 'rgba(0, 0, 0, 0.92)',
        zIndex: 1200,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 16,
      }}
    >
      {/* Верхняя панель управления лайтбоксом */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 980,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '8px 14px',
          borderRadius: 12,
          background: 'rgba(24, 24, 27, 0.88)',
          border: '1px solid rgba(255,255,255,0.14)',
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: '#fff',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {resolvedType === 'video' ? '🎬 ' : '🖼️ '}
          {title || (resolvedType === 'video' ? 'Видеопроигрыватель PixChats' : 'Просмотр фото')}
          {gallery.length > 1 && currentIndex >= 0 && (
            <span style={{ marginLeft: 8, color: 'var(--accent)', fontSize: 12 }}>
              ({currentIndex + 1} / {gallery.length})
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {resolvedType === 'image' && (
            <>
              <button
                type="button"
                className="btn btn-compact"
                style={{ width: 'auto', padding: '5px 10px', fontSize: 12 }}
                onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                title="Уменьшить"
              >
                🔍−
              </button>
              <button
                type="button"
                className="btn btn-compact"
                style={{ width: 'auto', padding: '5px 10px', fontSize: 12 }}
                onClick={() => {
                  setZoom(1);
                  setRotation(0);
                }}
                title="Сбросить масштаб"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                className="btn btn-compact"
                style={{ width: 'auto', padding: '5px 10px', fontSize: 12 }}
                onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                title="Увеличить"
              >
                🔍+
              </button>
              <button
                type="button"
                className="btn btn-compact"
                style={{ width: 'auto', padding: '5px 10px', fontSize: 12 }}
                onClick={() => setRotation((r) => (r + 90) % 360)}
                title="Повернуть на 90°"
              >
                ↻ 90°
              </button>
            </>
          )}

          <a
            href={resolvedUrl}
            download={title || 'pixchats-media'}
            target="_blank"
            rel="noreferrer"
            className="btn btn-compact"
            style={{
              width: 'auto',
              padding: '5px 10px',
              fontSize: 12,
              textDecoration: 'none',
              color: 'var(--accent)',
            }}
          >
            ⬇ Скачать
          </a>

          <button
            type="button"
            className="btn btn-compact"
            style={{ width: 'auto', padding: '5px 10px', fontSize: 13 }}
            onClick={onClose}
          >
            ✕ Закрыть
          </button>
        </div>
      </div>

      {/* Центральная область просмотра */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          width: '100%',
          maxWidth: 980,
          margin: '12px auto',
          position: 'relative',
        }}
      >
        {hasPrev && onSelectItem && (
          <button
            type="button"
            className="btn btn-compact"
            onClick={() => onSelectItem(gallery[currentIndex - 1])}
            style={{
              position: 'absolute',
              left: 8,
              zIndex: 20,
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.7)',
            }}
            title="Предыдущее медиа"
          >
            ←
          </button>
        )}

        {resolvedType === 'video' ? (
          <CustomVideoPlayer
            src={resolvedUrl}
            title={title}
            maxWidth={920}
            maxHeight="76vh"
            autoPlay
          />
        ) : (
          <img
            src={resolvedUrl}
            alt={title || 'Изображение'}
            onDoubleClick={() => setZoom((z) => (z === 1 ? 2 : 1))}
            style={{
              maxWidth: '94vw',
              maxHeight: '78vh',
              objectFit: 'contain',
              borderRadius: 12,
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
              transition: 'transform 0.18s ease',
              boxShadow: '0 20px 60px rgba(0,0,0,0.65)',
              cursor: zoom > 1 ? 'zoom-out' : 'zoom-in',
            }}
          />
        )}

        {hasNext && onSelectItem && (
          <button
            type="button"
            className="btn btn-compact"
            onClick={() => onSelectItem(gallery[currentIndex + 1])}
            style={{
              position: 'absolute',
              right: 8,
              zIndex: 20,
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.7)',
            }}
            title="Следующее медиа"
          >
            →
          </button>
        )}
      </div>

      <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
        {resolvedType === 'image'
          ? 'Двойной клик для 2x увеличения · Нажмите на фон или Esc, чтобы закрыть'
          : 'Двойной клик слева/справа: -10с / +10с · Пробел: пауза · Стрелки: перемотка'}
      </div>
    </div>
  );
}
