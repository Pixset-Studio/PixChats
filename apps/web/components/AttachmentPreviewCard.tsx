'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { TrashIcon } from './Icons';

interface AttachmentPreviewCardProps {
  file: File;
  captionPosition: 'above' | 'below';
  onCaptionPositionChange: (pos: 'above' | 'below') => void;
  onRemove: () => void;
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return '0 Б';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function getFileCategory(file: File): 'image' | 'video' | 'audio' | 'document' {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(name)) {
    return 'image';
  }
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(name)) {
    return 'video';
  }
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|opus|weba)$/i.test(name)) {
    return 'audio';
  }
  return 'document';
}

export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  if (parts.length > 1) {
    return parts.pop()!.toUpperCase().slice(0, 5);
  }
  return 'FILE';
}

export function AttachmentPreviewCard({
  file,
  captionPosition,
  onCaptionPositionChange,
  onRemove,
}: AttachmentPreviewCardProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [mediaDuration, setMediaDuration] = useState<string | null>(null);

  const category = useMemo(() => getFileCategory(file), [file]);
  const extension = useMemo(() => getFileExtension(file.name), [file.name]);
  const formattedSize = useMemo(() => formatBytes(file.size), [file.size]);

  useEffect(() => {
    let url: string | null = null;
    try {
      url = URL.createObjectURL(file);
      setObjectUrl(url);
    } catch {
      setObjectUrl(null);
    }

    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    if (img.naturalWidth && img.naturalHeight) {
      setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    }
  }

  function handleMediaLoadedMetadata(e: React.SyntheticEvent<HTMLVideoElement | HTMLAudioElement>) {
    const el = e.currentTarget;
    if (el.duration && Number.isFinite(el.duration)) {
      const min = Math.floor(el.duration / 60);
      const sec = Math.floor(el.duration % 60);
      setMediaDuration(`${min}:${String(sec).padStart(2, '0')}`);
    }
  }

  return (
    <>
      <div
        className="attachment-preview-card"
        style={{
          background: 'var(--surface-raised, rgba(24, 24, 27, 0.95))',
          border: '1.5px solid var(--accent, #ffd400)',
          borderRadius: 14,
          padding: '10px 14px',
          marginBottom: 8,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
          animation: 'fadeInUp 0.22s ease both',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent, #ffd400)' }}>
              {category === 'image' && '📷 Предпросмотр фото'}
              {category === 'video' && '🎥 Предпросмотр видео'}
              {category === 'audio' && '🎵 Предпросмотр аудио'}
              {category === 'document' && '📎 Предпросмотр файла'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({formattedSize})</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Подпись:</span>
            <button
              type="button"
              className="btn"
              style={{
                width: 'auto',
                padding: '3px 8px',
                fontSize: 11.5,
                background: captionPosition === 'above' ? 'var(--accent, #ffd400)' : 'transparent',
                color: captionPosition === 'above' ? '#09090b' : 'var(--text)',
                borderColor: captionPosition === 'above' ? 'var(--accent, #ffd400)' : 'var(--border)',
                fontWeight: captionPosition === 'above' ? 700 : 500,
              }}
              onClick={() => onCaptionPositionChange('above')}
              title="Разместить текст подписи над медиафайлом"
            >
              Сверху
            </button>
            <button
              type="button"
              className="btn"
              style={{
                width: 'auto',
                padding: '3px 8px',
                fontSize: 11.5,
                background: captionPosition === 'below' ? 'var(--accent, #ffd400)' : 'transparent',
                color: captionPosition === 'below' ? '#09090b' : 'var(--text)',
                borderColor: captionPosition === 'below' ? 'var(--accent, #ffd400)' : 'var(--border)',
                fontWeight: captionPosition === 'below' ? 700 : 500,
              }}
              onClick={() => onCaptionPositionChange('below')}
              title="Разместить текст подписи под медиафайлом"
            >
              Снизу
            </button>
            <button
              type="button"
              className="btn-ghost"
              style={{
                width: 'auto',
                padding: '4px 8px',
                fontSize: 14,
                color: '#ef4444',
                lineHeight: 1,
              }}
              onClick={onRemove}
              title="Удалить вложение"
            >
              <TrashIcon size={14} />
            </button>
          </div>
        </div>

        {/* Интерактивное тело предпросмотра */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {category === 'image' && objectUrl && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  position: 'relative',
                  width: 84,
                  height: 84,
                  borderRadius: 10,
                  overflow: 'hidden',
                  background: '#09090b',
                  border: '1px solid var(--border)',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
                onClick={() => setLightboxOpen(true)}
                title="Нажмите для увеличения"
              >
                <img
                  src={objectUrl}
                  alt={file.name}
                  onLoad={handleImageLoad}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <span
                  style={{
                    position: 'absolute',
                    bottom: 2,
                    right: 4,
                    fontSize: 10,
                    background: 'rgba(0,0,0,0.65)',
                    padding: '1px 4px',
                    borderRadius: 4,
                    color: '#fff',
                  }}
                >
                  🔍
                </span>
              </div>
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text)',
                    maxWidth: 240,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={file.name}
                >
                  {file.name}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {imageDimensions ? `${imageDimensions.width}×${imageDimensions.height} px · ` : ''}
                  {formattedSize}
                </div>
              </div>
            </div>
          )}

          {category === 'video' && objectUrl && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 360 }}>
              <video
                src={objectUrl}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={handleMediaLoadedMetadata}
                style={{
                  width: '100%',
                  maxHeight: 160,
                  borderRadius: 10,
                  background: '#000',
                  border: '1px solid var(--border)',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-muted)' }}>
                <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {file.name}
                </span>
                <span>{mediaDuration ? `${mediaDuration} · ` : ''}{formattedSize}</span>
              </div>
            </div>
          )}

          {category === 'audio' && objectUrl && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 360 }}>
              <audio
                src={objectUrl}
                controls
                preload="metadata"
                onLoadedMetadata={handleMediaLoadedMetadata}
                style={{ width: '100%', height: 38 }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-muted)' }}>
                <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {file.name}
                </span>
                <span>{mediaDuration ? `${mediaDuration} · ` : ''}{formattedSize}</span>
              </div>
            </div>
          )}

          {category === 'document' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, rgba(255,212,0,0.2) 0%, rgba(245,158,11,0.3) 100%)',
                  border: '1.5px solid var(--accent, #ffd400)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  color: 'var(--accent, #ffd400)',
                }}
              >
                <span style={{ fontSize: 16 }}>📄</span>
                <span style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase' }}>
                  {extension}
                </span>
              </div>
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text)',
                    maxWidth: 240,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={file.name}
                >
                  {file.name}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  Формат {extension} · {formattedSize}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Модалка полноэкранного зума фотографии при клике */}
      {lightboxOpen && objectUrl && (
        <div
          className="modal-overlay"
          style={{ zIndex: 99999, background: 'rgba(0,0,0,0.92)' }}
          onClick={() => setLightboxOpen(false)}
        >
          <div
            style={{
              position: 'relative',
              maxWidth: '92vw',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={objectUrl}
              alt={file.name}
              style={{
                maxWidth: '92vw',
                maxHeight: '82vh',
                objectFit: 'contain',
                borderRadius: 12,
                boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
              }}
            />
            <div
              style={{
                marginTop: 10,
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <span>{file.name} ({formattedSize})</span>
              <button
                type="button"
                className="btn"
                style={{ width: 'auto', padding: '4px 12px', fontSize: 12 }}
                onClick={() => setLightboxOpen(false)}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
