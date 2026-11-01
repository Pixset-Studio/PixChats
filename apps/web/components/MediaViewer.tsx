'use client';

import React, { useState, useRef, useEffect } from 'react';

function formatPlayerTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const totalSec = Math.floor(seconds);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export interface CustomVideoPlayerProps {
  src: string;
  caption?: string;
  autoPlay?: boolean;
  onOpenFullscreen?: (src: string) => void;
}

const PLAYBACK_RATES = [0.5, 1, 1.25, 1.5, 2];

/**
 * Встроенный кастомный видеопроигрыватель PixChats (для сообщений в чате и полноэкранного режима)
 */
export function CustomVideoPlayer({
  src,
  autoPlay = false,
  onOpenFullscreen,
}: CustomVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [playing, setPlaying] = useState(Boolean(autoPlay));
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [hoverControls, setHoverControls] = useState(true);

  function togglePlay(e?: React.MouseEvent) {
    e?.stopPropagation();
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      void vid.play().catch(() => {});
      setPlaying(true);
    } else {
      vid.pause();
      setPlaying(false);
    }
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    e.stopPropagation();
    const vid = videoRef.current;
    const nextTime = Number(e.target.value);
    setCurrentTime(nextTime);
    if (vid && Number.isFinite(nextTime)) {
      vid.currentTime = nextTime;
    }
  }

  function toggleMute(e: React.MouseEvent) {
    e.stopPropagation();
    const vid = videoRef.current;
    const next = !muted;
    setMuted(next);
    if (vid) vid.muted = next;
  }

  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    e.stopPropagation();
    const val = Number(e.target.value);
    setVolume(val);
    setMuted(val === 0);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
    }
  }

  function cycleSpeed(e: React.MouseEvent) {
    e.stopPropagation();
    const idx = PLAYBACK_RATES.indexOf(rate);
    const nextRate = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
    setRate(nextRate);
    if (videoRef.current) {
      videoRef.current.playbackRate = nextRate;
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
    } catch {}
  }

  function handleFullscreen(e: React.MouseEvent) {
    e.stopPropagation();
    if (onOpenFullscreen) {
      if (videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause();
        setPlaying(false);
      }
      onOpenFullscreen(src);
      return;
    }
    const el = containerRef.current as any;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else if (typeof el.requestFullscreen === 'function') {
      void el.requestFullscreen().catch(() => {});
    }
  }

  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div
      ref={containerRef}
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={() => setHoverControls(true)}
      onMouseLeave={() => {
        if (playing) setHoverControls(false);
      }}
      style={{
        position: 'relative',
        maxWidth: 360,
        width: '100%',
        borderRadius: 14,
        overflow: 'hidden',
        background: '#050507',
        border: '1px solid var(--border)',
        userSelect: 'none',
      }}
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay}
        playsInline
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onEnded={() => setPlaying(false)}
        style={{
          display: 'block',
          width: '100%',
          maxHeight: 340,
          objectFit: 'contain',
          cursor: 'pointer',
          background: '#000',
        }}
      />

      {/* Центральная кнопка Play при паузе */}
      {!playing && (
        <button
          type="button"
          onClick={togglePlay}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 54,
            height: 54,
            borderRadius: '50%',
            background: 'rgba(255, 212, 0, 0.92)',
            color: '#09090b',
            border: '2px solid #fff',
            boxShadow: '0 8px 28px rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            fontWeight: 900,
            cursor: 'pointer',
            paddingLeft: 3,
          }}
          title="Воспроизвести видео"
        >
          ▶
        </button>
      )}

      {/* Нижняя кастомная панель управления */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '16px 10px 8px',
          background: 'linear-gradient(to top, rgba(0, 0, 0, 0.88), rgba(0, 0, 0, 0.35), transparent)',
          opacity: hoverControls || !playing ? 1 : 0,
          transition: 'opacity 0.2s ease',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {/* Таймлайн с прогрессом */}
        <input
          type="range"
          min={0}
          max={duration > 0 ? duration : 100}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          style={{
            width: '100%',
            height: 4,
            accentColor: '#ffd400',
            cursor: 'pointer',
            margin: 0,
            background: `linear-gradient(to right, #ffd400 ${pct}%, rgba(255,255,255,0.25) ${pct}%)`,
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              onClick={togglePlay}
              style={{
                background: 'none',
                border: 'none',
                color: '#ffd400',
                fontSize: 14,
                fontWeight: 800,
                cursor: 'pointer',
                padding: '2px 4px',
              }}
              title={playing ? 'Пауза' : 'Воспроизвести'}
            >
              {playing ? '⏸' : '▶'}
            </button>

            <span style={{ fontSize: 11, color: '#fff', fontFamily: 'var(--font-mono, monospace)' }}>
              {formatPlayerTime(currentTime)} / {formatPlayerTime(duration)}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <button
              type="button"
              onClick={toggleMute}
              style={{
                background: 'none',
                border: 'none',
                color: '#fff',
                fontSize: 13,
                cursor: 'pointer',
                padding: '2px 4px',
              }}
              title={muted ? 'Включить звук' : 'Выключить звук'}
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
              style={{ width: 46, height: 3, accentColor: '#ffd400', cursor: 'pointer' }}
              title="Громкость"
            />

            <button
              type="button"
              onClick={cycleSpeed}
              style={{
                background: 'rgba(255,255,255,0.14)',
                border: '1px solid rgba(255,255,255,0.22)',
                borderRadius: 5,
                color: '#ffd400',
                fontSize: 10.5,
                fontWeight: 700,
                padding: '2px 5px',
                cursor: 'pointer',
              }}
              title="Скорость воспроизведения"
            >
              {rate}x
            </button>

            <button
              type="button"
              onClick={togglePiP}
              style={{
                background: 'rgba(255,255,255,0.14)',
                border: '1px solid rgba(255,255,255,0.22)',
                borderRadius: 5,
                color: '#fff',
                fontSize: 11,
                padding: '2px 5px',
                cursor: 'pointer',
              }}
              title="Картинка в картинке (PiP)"
            >
              ⧉
            </button>

            <button
              type="button"
              onClick={handleFullscreen}
              style={{
                background: 'rgba(255,255,255,0.14)',
                border: '1px solid rgba(255,255,255,0.22)',
                borderRadius: 5,
                color: '#fff',
                fontSize: 11,
                padding: '2px 6px',
                cursor: 'pointer',
              }}
              title="Открыть на весь экран"
            >
              ⛶
            </button>
          </div>
        </div>
      </div>
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
  activeUrl: string | null;
  activeType?: 'image' | 'video';
  gallery?: MediaGalleryItem[];
  onClose: () => void;
  onSelectItem?: (item: MediaGalleryItem) => void;
}

/**
 * Полноэкранный кастомный медиа-проигрыватель PixChats для фото и видео:
 * - Зум колесом мыши / кнопками / двойным кликом, перетаскивание (pan)
 * - Поворот на 90° влево/вправо, зеркальное отражение
 * - Переключение между всеми фото и видео в чате (← / →)
 * - Полноэкранный кастомный видеоплеер с контролем скорости и PiP
 */
export function CustomMediaLightbox({
  activeUrl,
  activeType = 'image',
  gallery = [],
  onClose,
  onSelectItem,
}: CustomMediaLightboxProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setFlipH(false);
    setPan({ x: 0, y: 0 });
  }, [activeUrl]);

  useEffect(() => {
    if (!activeUrl) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goAdjacent(-1);
      if (e.key === 'ArrowRight') goAdjacent(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeUrl, gallery]);

  if (!activeUrl) return null;

  const currentIndex = gallery.findIndex((g) => g.url === activeUrl);
  const currentItem = currentIndex >= 0 ? gallery[currentIndex] : null;
  const resolvedType: 'image' | 'video' =
    currentItem?.type ||
    (activeUrl.startsWith('data:video/') || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(activeUrl)
      ? 'video'
      : activeType);

  function goAdjacent(delta: number) {
    if (gallery.length <= 1 || currentIndex < 0) return;
    const nextIdx = (currentIndex + delta + gallery.length) % gallery.length;
    onSelectItem?.(gallery[nextIdx]);
  }

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onWheel={(e) => {
        if (resolvedType !== 'image') return;
        const delta = e.deltaY < 0 ? 0.2 : -0.2;
        setZoom((z) => Math.min(4, Math.max(0.5, Number((z + delta).toFixed(2)))));
      }}
      style={{
        zIndex: 10000,
        background: 'rgba(5, 5, 8, 0.94)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 16,
        userSelect: 'none',
      }}
    >
      {/* Верхняя панель */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 1100,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
          {resolvedType === 'video' ? '🎬 Видеопроигрыватель PixChats' : '🖼️ Просмотр изображения'}
          {gallery.length > 1 && currentIndex >= 0
            ? ` · ${currentIndex + 1} из ${gallery.length}`
            : ''}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <a
            href={activeUrl}
            download={`pixchats-media-${Date.now()}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
            style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
          >
            ⬇ Скачать
          </a>
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
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
          position: 'relative',
          flex: 1,
          width: '100%',
          maxWidth: 1100,
          margin: '12px auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {gallery.length > 1 && (
          <button
            type="button"
            className="btn"
            onClick={() => goAdjacent(-1)}
            style={{
              position: 'absolute',
              left: 12,
              zIndex: 10,
              width: 42,
              height: 42,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.75)',
              color: '#fff',
              fontSize: 18,
              padding: 0,
            }}
            title="Предыдущее медиа"
          >
            ←
          </button>
        )}

        {resolvedType === 'video' ? (
          <div style={{ width: '100%', maxWidth: 860 }}>
            <CustomVideoPlayer src={activeUrl} autoPlay />
          </div>
        ) : (
          <div
            onDoubleClick={() => {
              setZoom((z) => (z > 1 ? 1 : 2));
              setPan({ x: 0, y: 0 });
            }}
            onPointerDown={(e) => {
              if (zoom <= 1) return;
              isDraggingRef.current = true;
              dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
            }}
            onPointerMove={(e) => {
              if (!isDraggingRef.current) return;
              setPan({
                x: e.clientX - dragStartRef.current.x,
                y: e.clientY - dragStartRef.current.y,
              });
            }}
            onPointerUp={() => {
              isDraggingRef.current = false;
            }}
            onPointerCancel={() => {
              isDraggingRef.current = false;
            }}
            style={{
              cursor: zoom > 1 ? 'grab' : 'zoom-in',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              maxWidth: '90vw',
              maxHeight: '76vh',
            }}
          >
            <img
              src={activeUrl}
              alt="Медиа"
              draggable={false}
              style={{
                maxWidth: '88vw',
                maxHeight: '74vh',
                borderRadius: 10,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg) scaleX(${
                  flipH ? -1 : 1
                })`,
                transition: isDraggingRef.current ? 'none' : 'transform 0.18s ease',
                boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
              }}
            />
          </div>
        )}

        {gallery.length > 1 && (
          <button
            type="button"
            className="btn"
            onClick={() => goAdjacent(1)}
            style={{
              position: 'absolute',
              right: 12,
              zIndex: 10,
              width: 42,
              height: 42,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.75)',
              color: '#fff',
              fontSize: 18,
              padding: 0,
            }}
            title="Следующее медиа"
          >
            →
          </button>
        )}
      </div>

      {/* Нижняя панель инструментов (для изображений) */}
      {resolvedType === 'image' && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
            onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
          >
            🔍 −
          </button>
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
            onClick={() => {
              setZoom(1);
              setRotation(0);
              setFlipH(false);
              setPan({ x: 0, y: 0 });
            }}
          >
            {Math.round(zoom * 100)}% (Сброс)
          </button>
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
            onClick={() => setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
          >
            🔍 +
          </button>
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
            onClick={() => setRotation((r) => (r - 90) % 360)}
            title="Повернуть влево на 90°"
          >
            ↺ 90°
          </button>
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
            onClick={() => setRotation((r) => (r + 90) % 360)}
            title="Повернуть вправо на 90°"
          >
            ↻ 90°
          </button>
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
            onClick={() => setFlipH((f) => !f)}
            title="Отразить по горизонтали"
          >
            ⇄ Отразить
          </button>
        </div>
      )}
    </div>
  );
}
