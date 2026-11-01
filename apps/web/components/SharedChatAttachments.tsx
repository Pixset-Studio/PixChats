'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { getMessages } from '@pixchats/core';
import type { Message } from '@pixchats/core';
import { getOfflineMessages } from '../lib/offlineMessagesStore';
import { CustomMediaLightbox, CustomVideoPlayer } from './MediaViewer';
import { loadActiveStories, getCachedStories, type StoryItem } from '../lib/stories';

interface SharedChatAttachmentsProps {
  chatId?: string | null;
  targetUserId?: string | null;
  channelId?: string | null;
  title?: string;
}

type TabType = 'stories' | 'media' | 'files' | 'voice' | 'links';

const URL_REGEX = /(https?:\/\/[^\s<>"']+)/gi;

function isImageAttachment(msg: Message): boolean {
  if (!msg.media_path) return false;
  if (msg.message_type === 'image') return true;
  if (msg.media_path.startsWith('data:image/')) return true;
  return /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(msg.media_path);
}

function isVideoAttachment(msg: Message): boolean {
  if (!msg.media_path) return false;
  if (msg.message_type === 'video' || msg.message_type === 'video_note') return true;
  if (msg.media_path.startsWith('data:video/')) return true;
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(msg.media_path);
}

function isVoiceAttachment(msg: Message): boolean {
  if (!msg.media_path) return false;
  if (msg.message_type === 'voice' || msg.message_type === 'audio') return true;
  if (msg.media_path.startsWith('data:audio/')) return true;
  return /\.(ogg|mp3|wav|m4a|opus)(\?|$)/i.test(msg.media_path);
}

function isStoryVideo(story: StoryItem): boolean {
  if (story.mediaType === 'video') return true;
  if (!story.mediaUrl) return false;
  return (
    story.mediaUrl.startsWith('data:video/') ||
    /\.(mp4|webm|mov|m4v)(\?|$)/i.test(story.mediaUrl)
  );
}

export function SharedChatAttachments({
  chatId,
  targetUserId,
  channelId,
  title = 'Вложения и медиа чата',
}: SharedChatAttachmentsProps) {
  const [messages, setMessages] = useState<Message[]>(() =>
    chatId ? getOfflineMessages(chatId) : []
  );
  const [stories, setStories] = useState<StoryItem[]>(() => getCachedStories());
  const [loading, setLoading] = useState<boolean>(() =>
    chatId ? getOfflineMessages(chatId).length === 0 : false
  );
  const [tab, setTab] = useState<TabType>('media');
  const [previewMedia, setPreviewMedia] = useState<{
    url: string;
    type: 'image' | 'video';
    title?: string;
  } | null>(null);
  const [activeStoryIdx, setActiveStoryIdx] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const refreshStories = () => {
      loadActiveStories()
        .then((loaded) => {
          if (mounted) setStories(loaded);
        })
        .catch(() => {});
    };
    refreshStories();
    const onUpdated = () => refreshStories();
    window.addEventListener('pixchats:stories_updated', onUpdated);
    return () => {
      mounted = false;
      window.removeEventListener('pixchats:stories_updated', onUpdated);
    };
  }, [targetUserId, channelId, chatId]);

  useEffect(() => {
    let mounted = true;
    if (!chatId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    const cached = getOfflineMessages(chatId);
    if (cached.length > 0) {
      setMessages(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    getMessages(chatId)
      .then((fresh) => {
        if (mounted) {
          setMessages(fresh);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [chatId]);

  // Filter active stories belonging to targetUserId or channelId
  const relevantStories = useMemo(() => {
    const channelOwnerKey = channelId ? `channel:${channelId}` : null;
    return stories.filter((s) => {
      if (channelOwnerKey && (s.userId === channelOwnerKey || s.channelId === channelId)) {
        return true;
      }
      if (targetUserId && (s.userId === targetUserId || s.authorUserId === targetUserId)) {
        return !s.isChannelStory;
      }
      return false;
    });
  }, [stories, targetUserId, channelId]);

  const { mediaItems, fileItems, voiceItems, linkItems } = useMemo(() => {
    const media: Message[] = [];
    const files: Message[] = [];
    const voice: Message[] = [];
    const links: Array<{ id: string; url: string; text: string; createdAt: string }> = [];

    const sortedDesc = [...messages].sort(
      (a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()
    );

    for (const m of sortedDesc) {
      if (m.media_path) {
        if (isImageAttachment(m) || isVideoAttachment(m)) {
          media.push(m);
        } else if (isVoiceAttachment(m)) {
          voice.push(m);
        } else {
          files.push(m);
        }
      }

      const bodyText = m.text || m.caption || '';
      if (bodyText && !bodyText.startsWith('📊 POLL:')) {
        const found = bodyText.match(URL_REGEX);
        if (found && found.length > 0) {
          for (const url of found) {
            links.push({
              id: `${m.id}-${url}`,
              url,
              text: bodyText,
              createdAt: m.sent_at,
            });
          }
        }
      }
    }

    return {
      mediaItems: media,
      fileItems: files,
      voiceItems: voice,
      linkItems: links,
    };
  }, [messages]);

  const totalCount =
    relevantStories.length +
    mediaItems.length +
    fileItems.length +
    voiceItems.length +
    linkItems.length;

  const activeStory =
    activeStoryIdx !== null && relevantStories[activeStoryIdx]
      ? relevantStories[activeStoryIdx]
      : null;

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
          gap: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15 }}>📂 {title}</h3>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Всего: {totalCount}</span>
      </div>

      {/* Активные истории в самом начале блока «Вложения и медиа чата» (если есть) */}
      {relevantStories.length > 0 && (
        <div
          style={{
            marginBottom: 14,
            padding: 12,
            borderRadius: 14,
            background: 'linear-gradient(135deg, rgba(255, 212, 0, 0.08), rgba(236, 72, 153, 0.08))',
            border: '1px solid rgba(255, 212, 0, 0.32)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)' }}>
              ✨ Активные истории ({relevantStories.length})
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Нажмите для просмотра
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 10,
              overflowX: 'auto',
              paddingBottom: 4,
            }}
          >
            {relevantStories.map((st, idx) => {
              const isVid = isStoryVideo(st);
              return (
                <div
                  key={st.id}
                  onClick={() => setActiveStoryIdx(idx)}
                  style={{
                    width: 96,
                    height: 138,
                    borderRadius: 12,
                    overflow: 'hidden',
                    position: 'relative',
                    flexShrink: 0,
                    cursor: 'pointer',
                    background: st.bgGradient || '#18181b',
                    border: '2px solid var(--accent)',
                    boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {st.mediaUrl && isVid ? (
                    <video
                      src={st.mediaUrl}
                      muted
                      playsInline
                      preload="metadata"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        filter: st.filterCss && st.filterCss !== 'none' ? st.filterCss : undefined,
                      }}
                    />
                  ) : st.mediaUrl ? (
                    <img
                      src={st.mediaUrl}
                      alt={st.text || 'История'}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        filter: st.filterCss && st.filterCss !== 'none' ? st.filterCss : undefined,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        padding: 8,
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#fff',
                        textAlign: 'center',
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 4,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {st.text || st.overlayText || '✨ История'}
                    </div>
                  )}

                  <div
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      background: 'rgba(0,0,0,0.68)',
                      color: '#ffd400',
                      borderRadius: 6,
                      padding: '2px 5px',
                      fontSize: 10,
                      fontWeight: 800,
                    }}
                  >
                    {isVid ? '🎬' : '✨'}
                  </div>

                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      padding: '4px 6px',
                      background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)',
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    👁️ {st.viewers?.length || 1}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Переключатель вкладок */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            relevantStories.length > 0 ? 'repeat(5, 1fr)' : 'repeat(4, 1fr)',
          gap: 6,
          marginBottom: 12,
        }}
      >
        {relevantStories.length > 0 && (
          <button
            type="button"
            className={`btn btn-compact ${tab === 'stories' ? 'btn-primary' : ''}`}
            style={{ padding: '7px 6px', fontSize: 12 }}
            onClick={() => setTab('stories')}
          >
            ✨ Истории ({relevantStories.length})
          </button>
        )}
        <button
          type="button"
          className={`btn btn-compact ${tab === 'media' ? 'btn-primary' : ''}`}
          style={{ padding: '7px 6px', fontSize: 12 }}
          onClick={() => setTab('media')}
        >
          🖼️ Медиа ({mediaItems.length})
        </button>
        <button
          type="button"
          className={`btn btn-compact ${tab === 'files' ? 'btn-primary' : ''}`}
          style={{ padding: '7px 6px', fontSize: 12 }}
          onClick={() => setTab('files')}
        >
          📎 Файлы ({fileItems.length})
        </button>
        <button
          type="button"
          className={`btn btn-compact ${tab === 'voice' ? 'btn-primary' : ''}`}
          style={{ padding: '7px 6px', fontSize: 12 }}
          onClick={() => setTab('voice')}
        >
          🎤 Аудио ({voiceItems.length})
        </button>
        <button
          type="button"
          className={`btn btn-compact ${tab === 'links' ? 'btn-primary' : ''}`}
          style={{ padding: '7px 6px', fontSize: 12 }}
          onClick={() => setTab('links')}
        >
          🔗 Ссылки ({linkItems.length})
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
          Загрузка вложений…
        </div>
      ) : (
        <>
          {tab === 'stories' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                gap: 10,
              }}
            >
              {relevantStories.map((st, idx) => (
                <div
                  key={st.id}
                  onClick={() => setActiveStoryIdx(idx)}
                  style={{
                    aspectRatio: '9 / 14',
                    borderRadius: 12,
                    overflow: 'hidden',
                    background: st.bgGradient,
                    border: '1px solid var(--accent)',
                    position: 'relative',
                    cursor: 'pointer',
                  }}
                >
                  {st.mediaUrl && isStoryVideo(st) ? (
                    <video
                      src={st.mediaUrl}
                      muted
                      playsInline
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : st.mediaUrl ? (
                    <img
                      src={st.mediaUrl}
                      alt="История"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div
                      style={{
                        padding: 10,
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: 12,
                        textAlign: 'center',
                      }}
                    >
                      {st.text}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'media' && (
            <>
              {mediaItems.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
                  В этом чате пока нет фотографий и видео.
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
                    gap: 8,
                    maxHeight: 300,
                    overflowY: 'auto',
                  }}
                >
                  {mediaItems.map((item) => {
                    const isVid = isVideoAttachment(item);
                    return (
                      <div
                        key={item.id}
                        style={{
                          position: 'relative',
                          aspectRatio: '1 / 1',
                          borderRadius: 10,
                          overflow: 'hidden',
                          border: '1px solid var(--border)',
                          background: 'var(--surface-raised)',
                          cursor: 'pointer',
                        }}
                         onClick={() =>
                          setPreviewMedia({
                            url: item.media_path!,
                            type: isVid ? 'video' : 'image',
                            title: item.caption || item.text || (isVid ? 'Видео' : 'Фотография'),
                          })
                        }
                      >
                        {isVid ? (
                          <>
                            <video
                              src={item.media_path!}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              muted
                              playsInline
                              preload="metadata"
                            />
                            <span
                              style={{
                                position: 'absolute',
                                inset: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'rgba(0,0,0,0.28)',
                              }}
                            >
                              <span
                                style={{
                                  width: 34,
                                  height: 34,
                                  borderRadius: '50%',
                                  background: 'rgba(255, 212, 0, 0.92)',
                                  color: '#09090b',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontWeight: 900,
                                  fontSize: 14,
                                }}
                              >
                                ▶
                              </span>
                            </span>
                          </>
                        ) : (
                          <img
                            src={item.media_path!}
                            alt={item.caption || item.text || 'Фото'}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            loading="lazy"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {tab === 'files' && (
            <>
              {fileItems.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
                  Документов и файлов пока нет.
                </div>
              ) : (
                <div className="stack" style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {fileItems.map((item) => (
                    <a
                      key={item.id}
                      href={item.media_path!}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        padding: '8px 10px',
                        borderRadius: 10,
                        background: 'var(--surface-raised)',
                        border: '1px solid var(--border)',
                        textDecoration: 'none',
                        color: 'var(--text)',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 13,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          📎 {item.caption || item.text || 'Файл'}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {new Date(item.sent_at).toLocaleString('ru-RU')}
                        </div>
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--accent)', flexShrink: 0 }}>
                        Скачать ↗
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'voice' && (
            <>
              {voiceItems.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
                  Голосовых и аудиосообщений пока нет.
                </div>
              ) : (
                <div className="stack" style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {voiceItems.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 10,
                        background: 'var(--surface-raised)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          marginBottom: 4,
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>🎤 {item.caption || 'Голосовое сообщение'}</span>
                        <span>{new Date(item.sent_at).toLocaleString('ru-RU')}</span>
                      </div>
                      <audio
                        controls
                        src={item.media_path!}
                        style={{ width: '100%', height: 34 }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'links' && (
            <>
              {linkItems.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
                  Ссылок в сообщениях пока нет.
                </div>
              ) : (
                <div className="stack" style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {linkItems.map((link) => (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'block',
                        padding: '8px 10px',
                        borderRadius: 10,
                        background: 'var(--surface-raised)',
                        border: '1px solid var(--border)',
                        textDecoration: 'none',
                        color: 'var(--text)',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--accent)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        🔗 {link.url}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          marginTop: 2,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {new Date(link.createdAt).toLocaleString('ru-RU')}
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Полноэкранный просмотрщик выбранной истории прямо из профиля/чата */}
      {activeStory && activeStoryIdx !== null && (
        <div
          className="modal-overlay"
          onClick={() => setActiveStoryIdx(null)}
          style={{ background: 'rgba(0,0,0,0.9)', zIndex: 1300 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 420,
              height: '84vh',
              maxHeight: 720,
              borderRadius: 22,
              overflow: 'hidden',
              position: 'relative',
              background: activeStory.bgGradient || '#111',
              border: '1px solid rgba(255,255,255,0.18)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            {/* Верхняя шапка истории */}
            <div
              style={{
                position: 'relative',
                zIndex: 10,
                padding: '12px 14px',
                background: 'linear-gradient(to bottom, rgba(0,0,0,0.78), transparent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>
                  {activeStory.userName}{' '}
                  <span style={{ fontSize: 12, color: '#ffd400', fontWeight: 600 }}>
                    ({activeStoryIdx + 1}/{relevantStories.length})
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>
                  {new Date(activeStory.createdAt).toLocaleString('ru-RU')} · 👁️{' '}
                  {activeStory.viewers?.length || 1}
                </div>
              </div>
              <button
                type="button"
                className="btn-ghost"
                style={{ width: 'auto', color: '#fff', fontSize: 18, padding: '4px 10px' }}
                onClick={() => setActiveStoryIdx(null)}
              >
                ✕
              </button>
            </div>

            {/* Контент истории */}
            <div
              style={{
                flex: 1,
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              {activeStory.mediaUrl && isStoryVideo(activeStory) ? (
                <CustomVideoPlayer
                  src={activeStory.mediaUrl}
                  autoPlay
                  maxHeight={540}
                  filterCss={activeStory.filterCss}
                />
              ) : activeStory.mediaUrl ? (
                <img
                  src={activeStory.mediaUrl}
                  alt="История"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    filter:
                      activeStory.filterCss && activeStory.filterCss !== 'none'
                        ? activeStory.filterCss
                        : undefined,
                  }}
                />
              ) : null}

              {activeStory.text && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 16,
                    left: 16,
                    right: 16,
                    padding: '10px 14px',
                    borderRadius: 12,
                    background: 'rgba(0,0,0,0.68)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 14,
                    textAlign: 'center',
                  }}
                >
                  {activeStory.text}
                </div>
              )}
            </div>

            {/* Переключение историй */}
            {relevantStories.length > 1 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'rgba(0,0,0,0.75)',
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  className="btn btn-compact"
                  disabled={activeStoryIdx <= 0}
                  onClick={() => setActiveStoryIdx((i) => Math.max(0, (i ?? 0) - 1))}
                  style={{ width: 'auto' }}
                >
                  ← Предыдущая
                </button>
                <button
                  type="button"
                  className="btn btn-compact btn-primary"
                  disabled={activeStoryIdx >= relevantStories.length - 1}
                  onClick={() =>
                    setActiveStoryIdx((i) => Math.min(relevantStories.length - 1, (i ?? 0) + 1))
                  }
                  style={{ width: 'auto' }}
                >
                  Следующая →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {previewMedia && (
        <CustomMediaLightbox
          url={previewMedia.url}
          type={previewMedia.type}
          title={previewMedia.title}
          onClose={() => setPreviewMedia(null)}
        />
      )}
    </div>
  );
}
