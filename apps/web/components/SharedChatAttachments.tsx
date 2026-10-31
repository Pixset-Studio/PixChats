'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { getMessages } from '@pixchats/core';
import type { Message } from '@pixchats/core';
import { extractUrlsFromText } from './FormattedMessageText';

export interface SharedChatAttachmentsProps {
  chatId: string | null;
}

type AttachmentTab = 'media' | 'files' | 'voice' | 'links';

export function SharedChatAttachments({ chatId }: SharedChatAttachmentsProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<AttachmentTab>('media');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!chatId) return;
    setLoading(true);
    getMessages(chatId, 200)
      .then((list) => {
        setMessages(list.filter((m) => !m.is_deleted));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [chatId]);

  const mediaItems = useMemo(
    () =>
      messages.filter(
        (m) =>
          (m.message_type === 'image' || m.message_type === 'video') &&
          Boolean(m.media_path)
      ),
    [messages]
  );

  const fileItems = useMemo(
    () => messages.filter((m) => m.message_type === 'file' && Boolean(m.media_path)),
    [messages]
  );

  const voiceItems = useMemo(
    () =>
      messages.filter(
        (m) =>
          (m.message_type === 'voice' || m.message_type === 'audio') &&
          Boolean(m.media_path)
      ),
    [messages]
  );

  const linkItems = useMemo(() => {
    const out: Array<{ id: string; url: string; sentAt: string; text: string }> = [];
    for (const m of messages) {
      const urls = extractUrlsFromText(m.text);
      for (const u of urls) {
        out.push({ id: `${m.id}-${u}`, url: u, sentAt: m.sent_at, text: m.text });
      }
    }
    return out;
  }, [messages]);

  if (!chatId) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <div className="section-title">Вложения и медиа чата</div>
      <div className="card" style={{ padding: 14 }}>
        <div className="folder-tabs" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className={`folder-tab ${tab === 'media' ? 'active' : ''}`}
            onClick={() => setTab('media')}
          >
            📷 Медиа ({mediaItems.length})
          </button>
          <button
            type="button"
            className={`folder-tab ${tab === 'files' ? 'active' : ''}`}
            onClick={() => setTab('files')}
          >
            📎 Файлы ({fileItems.length})
          </button>
          <button
            type="button"
            className={`folder-tab ${tab === 'voice' ? 'active' : ''}`}
            onClick={() => setTab('voice')}
          >
            🎤 Голосовые ({voiceItems.length})
          </button>
          <button
            type="button"
            className={`folder-tab ${tab === 'links' ? 'active' : ''}`}
            onClick={() => setTab('links')}
          >
            🔗 Ссылки ({linkItems.length})
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
            Загрузка вложений…
          </div>
        ) : (
          <>
            {tab === 'media' &&
              (mediaItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
                  В этом чате пока нет фотографий и видео
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(105px, 1fr))',
                    gap: 8,
                  }}
                >
                  {mediaItems.map((m) =>
                    m.message_type === 'video' ? (
                      <video
                        key={m.id}
                        src={m.media_path!}
                        controls
                        style={{
                          width: '100%',
                          height: 105,
                          objectFit: 'cover',
                          borderRadius: 8,
                          border: '1px solid var(--border)',
                        }}
                      />
                    ) : (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setLightboxUrl(m.media_path!)}
                        style={{
                          padding: 0,
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          overflow: 'hidden',
                          background: 'var(--bg)',
                          cursor: 'pointer',
                          height: 105,
                        }}
                      >
                        <img
                          src={m.media_path!}
                          alt={m.text}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      </button>
                    )
                  )}
                </div>
              ))}

            {tab === 'files' &&
              (fileItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
                  Отправленных файлов пока нет
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {fileItems.map((m) => (
                    <a
                      key={m.id}
                      href={m.media_path!}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)',
                        textDecoration: 'none',
                        fontSize: 13,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>📎 {m.text || 'Файл'}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {new Date(m.sent_at).toLocaleDateString('ru-RU')}
                      </span>
                    </a>
                  ))}
                </div>
              ))}

            {tab === 'voice' &&
              (voiceItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
                  Голосовых и аудиосообщений пока нет
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {voiceItems.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        padding: '8px 12px',
                        borderRadius: 8,
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <audio src={m.media_path!} controls style={{ flex: 1, height: 34 }} />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                        {new Date(m.sent_at).toLocaleTimeString('ru-RU', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              ))}

            {tab === 'links' &&
              (linkItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
                  Отправленных ссылок пока нет
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {linkItems.map((item) => (
                    <a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        textDecoration: 'none',
                      }}
                    >
                      <span
                        style={{
                          color: 'var(--accent)',
                          fontSize: 13,
                          fontWeight: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        🔗 {item.url}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {new Date(item.sentAt).toLocaleString('ru-RU')}
                      </span>
                    </a>
                  ))}
                </div>
              ))}
          </>
        )}
      </div>

      {lightboxUrl && (
        <div
          className="modal-overlay"
          onClick={() => setLightboxUrl(null)}
          style={{ zIndex: 9999, background: 'rgba(0,0,0,0.88)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              maxWidth: '92vw',
              maxHeight: '90vh',
            }}
          >
            <img
              src={lightboxUrl}
              alt="Просмотр"
              style={{
                maxWidth: '90vw',
                maxHeight: '78vh',
                borderRadius: 12,
                border: '1px solid var(--border)',
                objectFit: 'contain',
              }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <a
                href={lightboxUrl}
                download="pixchats-media"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
                style={{ width: 'auto' }}
              >
                ⬇ Открыть оригинал / Скачать
              </a>
              <button
                type="button"
                className="btn"
                style={{ width: 'auto' }}
                onClick={() => setLightboxUrl(null)}
              >
                ✕ Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
