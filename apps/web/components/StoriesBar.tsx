'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabaseClient, uploadMessageFile } from '@pixchats/core';
import type { Profile } from '@pixchats/core';
import {
  STORY_GRADIENTS,
  deleteStoryById,
  getCachedStories,
  getViewedStoryIds,
  loadActiveStories,
  publishNewStory,
  recordStoryView,
  saveCachedStories,
  toggleStoryReaction,
  type StoryItem,
} from '../lib/stories';
import { VerifiedBadge } from './VerifiedBadge';

const STORY_REACTIONS = ['❤️', '🔥', '⚡', '👏', '😂', '😍'];

interface GroupedUserStories {
  userId: string;
  userName: string;
  userUsername: string;
  userAvatar: string | null;
  isVerified?: boolean;
  items: StoryItem[];
  hasUnread: boolean;
}

function formatRemainingHours(expiresAt: string): string {
  const diffMs = Math.max(0, new Date(expiresAt).getTime() - Date.now());
  const hours = Math.ceil(diffMs / (1000 * 60 * 60));
  return `${hours} ч.`;
}

function formatRelativeTime(createdAt: string): string {
  const diffMin = Math.max(1, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
  if (diffMin < 60) return `${diffMin} мин. назад`;
  return `${Math.floor(diffMin / 60)} ч. назад`;
}

export function StoriesBar({ profile }: { profile: Profile }) {
  const [stories, setStories] = useState<StoryItem[]>(() => getCachedStories());
  const [viewedIds, setViewedIds] = useState<Set<string>>(() => getViewedStoryIds());

  // Модалка публикации новой истории
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [storyText, setStoryText] = useState('');
  const [storyGradient, setStoryGradient] = useState(STORY_GRADIENTS[0].css);
  const [storyPrivacy, setStoryPrivacy] = useState<'all' | 'friends'>('all');
  const [storyMediaUrl, setStoryMediaUrl] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Просмотрщик историй
  const [activeGroupUserId, setActiveGroupUserId] = useState<string | null>(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);

  useEffect(() => {
    let mounted = true;
    loadActiveStories().then((list) => {
      if (mounted) {
        setStories(list);
        setViewedIds(getViewedStoryIds());
      }
    });

    const supabase = getSupabaseClient();
    const channel = supabase
      .channel('pixchats-stories-global')
      .on('broadcast', { event: 'stories-sync' }, ({ payload }: any) => {
        if (Array.isArray(payload?.stories)) {
          saveCachedStories(payload.stories);
          setStories(getCachedStories());
        }
      })
      .subscribe();

    const onLocalSync = () => {
      setStories(getCachedStories());
      setViewedIds(getViewedStoryIds());
    };
    window.addEventListener('pixchats:stories_updated', onLocalSync);

    return () => {
      mounted = false;
      window.removeEventListener('pixchats:stories_updated', onLocalSync);
      supabase.removeChannel(channel);
    };
  }, []);

  // Группируем истории по пользователям (сначала свои, затем другие)
  const groupedMap = new Map<string, GroupedUserStories>();
  for (const item of stories) {
    const existing = groupedMap.get(item.userId);
    const isUnread = !viewedIds.has(item.id) && item.userId !== profile.id;
    if (!existing) {
      groupedMap.set(item.userId, {
        userId: item.userId,
        userName: item.userName,
        userUsername: item.userUsername,
        userAvatar: item.userAvatar,
        isVerified: item.isVerified,
        items: [item],
        hasUnread: isUnread,
      });
    } else {
      existing.items.push(item);
      if (isUnread) existing.hasUnread = true;
    }
  }

  // Сортируем истории каждого автора по времени (от старых к новым для последовательного просмотра)
  for (const g of groupedMap.values()) {
    g.items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  const myGroup = groupedMap.get(profile.id) || null;
  const otherGroups = Array.from(groupedMap.values()).filter((g) => g.userId !== profile.id);

  const activeGroup = activeGroupUserId ? groupedMap.get(activeGroupUserId) || null : null;
  const currentStory = activeGroup ? activeGroup.items[activeStoryIndex] || activeGroup.items[0] : null;

  useEffect(() => {
    if (!currentStory) return;
    recordStoryView(currentStory.id, profile.id).then((updated) => {
      setStories(updated);
      setViewedIds(getViewedStoryIds());
    });

    const timer = setTimeout(() => {
      if (!activeGroup) return;
      if (activeStoryIndex + 1 < activeGroup.items.length) {
        setActiveStoryIndex((i) => i + 1);
      } else {
        setActiveGroupUserId(null);
        setActiveStoryIndex(0);
      }
    }, 7000);

    return () => clearTimeout(timer);
  }, [currentStory?.id, activeGroupUserId, activeStoryIndex]);

  async function handleSelectPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingMedia(true);
    try {
      const uploaded = await uploadMessageFile(`stories-${profile.id}`, file);
      setStoryMediaUrl(uploaded.url);
    } catch {
      // Fallback DataURL
      const reader = new FileReader();
      reader.onload = () => setStoryMediaUrl(String(reader.result));
      reader.readAsDataURL(file);
    } finally {
      setUploadingMedia(false);
    }
  }

  async function handlePublishStory(e: React.FormEvent) {
    e.preventDefault();
    if (!storyText.trim() && !storyMediaUrl) return;
    setPublishing(true);
    try {
      await publishNewStory({
        userId: profile.id,
        userName: profile.display_name,
        userUsername: profile.username,
        userAvatar: profile.avatar_url,
        isVerified: profile.is_verified,
        mediaUrl: storyMediaUrl,
        bgGradient: storyGradient,
        text: storyText,
        privacy: storyPrivacy,
      });
      setStoryText('');
      setStoryMediaUrl(null);
      setShowCreateModal(false);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          overflowX: 'auto',
          padding: '4px 2px 10px',
          marginBottom: 8,
           borderBottom: '1px solid var(--border)',
          scrollbarWidth: 'none',
        }}
      >
        {/* Кнопка добавления / просмотра своей истории */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            cursor: 'pointer',
            flexShrink: 0,
            width: 62,
          }}
          onClick={() => {
            if (myGroup && myGroup.items.length > 0) {
              setActiveGroupUserId(profile.id);
              setActiveStoryIndex(0);
            } else {
              setShowCreateModal(true);
            }
          }}
        >
          <div style={{ position: 'relative', width: 52, height: 52 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                padding: 2,
                background: myGroup
                  ? 'linear-gradient(135deg, #FFD400 0%, #FF8800 100%)'
                  : 'rgba(255, 255, 255, 0.16)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                className={`avatar ${!profile.avatar_url ? 'avatar-fallback' : ''}`}
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: '50%',
                  border: '2px solid var(--bg)',
                  backgroundImage: profile.avatar_url ? `url(${profile.avatar_url})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  fontSize: 16,
                }}
              >
                {!profile.avatar_url && profile.display_name.slice(0, 1).toUpperCase()}
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowCreateModal(true);
              }}
              title="Опубликовать новую историю на 24 часа"
              style={{
                position: 'absolute',
                right: -2,
                bottom: -2,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: 'var(--accent)',
                color: '#09090b',
                border: '2px solid var(--bg)',
                fontWeight: 800,
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
              }}
            >
              +
            </button>
          </div>
          <span
            style={{
              fontSize: 11,
              color: myGroup ? 'var(--accent)' : 'var(--text-muted)',
              fontWeight: myGroup ? 600 : 500,
              maxWidth: 60,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {myGroup ? 'Моя история' : 'История'}
          </span>
        </div>

        {/* Истории других пользователей */}
        {otherGroups.map((group) => (
          <div
            key={group.userId}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
              flexShrink: 0,
              width: 62,
            }}
            onClick={() => {
              setActiveGroupUserId(group.userId);
              setActiveStoryIndex(0);
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                padding: 2,
                background: group.hasUnread
                  ? 'linear-gradient(135deg, #FFD400 0%, #FF6B00 100%)'
                  : 'rgba(255, 255, 255, 0.22)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                className={`avatar ${!group.userAvatar ? 'avatar-fallback' : ''}`}
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: '50%',
                  border: '2px solid var(--bg)',
                  backgroundImage: group.userAvatar ? `url(${group.userAvatar})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  fontSize: 16,
                }}
              >
                {!group.userAvatar && group.userName.slice(0, 1).toUpperCase()}
              </div>
            </div>
            <span
              style={{
                fontSize: 11,
                color: group.hasUnread ? 'var(--text)' : 'var(--text-muted)',
                fontWeight: group.hasUnread ? 600 : 400,
                maxWidth: 60,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {group.userName}
            </span>
          </div>
        ))}
      </div>

      {/* Модальное окно создания новой истории на 24 часа */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)} style={{ zIndex: 9999 }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, width: '94%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 17 }}>📸 Новая история (на 24 часа)</h3>
              <button
                type="button"
                className="btn-ghost"
                style={{ width: 'auto', padding: '4px 8px' }}
                onClick={() => setShowCreateModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handlePublishStory}>
              {/* Превью карточки истории */}
              <div
                style={{
                  width: '100%',
                  height: 220,
                  borderRadius: 14,
                  background: storyMediaUrl ? `#000 url(${storyMediaUrl}) center/cover no-repeat` : storyGradient,
                  border: '1px solid rgba(255, 212, 0, 0.35)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 18,
                  textAlign: 'center',
                  position: 'relative',
                  overflow: 'hidden',
                  marginBottom: 12,
                }}
              >
                {storyMediaUrl && (
                  <button
                    type="button"
                    className="btn"
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      width: 'auto',
                      padding: '4px 8px',
                      fontSize: 11,
                      background: 'rgba(0,0,0,0.75)',
                    }}
                    onClick={() => setStoryMediaUrl(null)}
                  >
                    ✕ Убрать фото
                  </button>
                )}
                <div
                  style={{
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 17,
                    textShadow: '0 2px 10px rgba(0,0,0,0.85)',
                    background: storyMediaUrl && storyText ? 'rgba(0,0,0,0.55)' : 'transparent',
                    padding: storyMediaUrl && storyText ? '6px 12px' : 0,
                    borderRadius: 8,
                    maxWidth: '92%',
                    wordBreak: 'break-word',
                  }}
                >
                  {storyText || (storyMediaUrl ? '' : 'Введите текст вашей истории или прикрепите фото…')}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleSelectPhoto}
                />
                <button
                  type="button"
                  className="btn btn-compact"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingMedia}
                >
                  {uploadingMedia ? '⏳ Загрузка…' : '📷 Прикрепить фото'}
                </button>

                {STORY_GRADIENTS.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    title={g.label}
                    onClick={() => setStoryGradient(g.css)}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: g.css,
                      border: storyGradient === g.css ? '2px solid var(--accent)' : '1px solid var(--border)',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  />
                ))}
              </div>

              <div className="field" style={{ marginBottom: 10 }}>
                <label>Текст или подпись к истории</label>
                <textarea
                  className="input"
                  rows={2}
                  maxLength={240}
                  value={storyText}
                  onChange={(e) => setStoryText(e.target.value)}
                  placeholder="Что нового сегодня?"
                />
              </div>

              <div className="field" style={{ marginBottom: 14 }}>
                <label>Кто может видеть историю</label>
                <select
                  className="input"
                  value={storyPrivacy}
                  onChange={(e) => setStoryPrivacy(e.target.value as 'all' | 'friends')}
                >
                  <option value="all">🌍 Все пользователи</option>
                  <option value="friends">👥 Только друзья</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn" style={{ width: 'auto' }} onClick={() => setShowCreateModal(false)}>
                  Отмена
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: 'auto', fontWeight: 700 }}
                  disabled={publishing || (!storyText.trim() && !storyMediaUrl)}
                >
                  {publishing ? 'Публикуем…' : '⚡ Опубликовать на 24ч'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Полноэкранный просмотрщик историй */}
      {activeGroup && currentStory && (
        <div
          className="modal-overlay"
          onClick={() => {
            setActiveGroupUserId(null);
            setActiveStoryIndex(0);
          }}
          style={{ zIndex: 9999, background: 'rgba(0, 0, 0, 0.92)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '94%',
              maxWidth: 400,
              height: '82vh',
              maxHeight: 640,
              borderRadius: 18,
              background: currentStory.mediaUrl
                ? `#000 url(${currentStory.mediaUrl}) center/contain no-repeat`
                : currentStory.bgGradient,
              border: '1.5px solid rgba(255, 212, 0, 0.4)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: 16,
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 24px 64px rgba(0,0,0,0.9)',
            }}
          >
            {/* Верхняя часть: полоски прогресса + автор */}
            <div style={{ zIndex: 2 }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                {activeGroup.items.map((st, idx) => (
                  <div
                    key={st.id}
                    onClick={() => setActiveStoryIndex(idx)}
                    style={{
                      flex: 1,
                      height: 3.5,
                      borderRadius: 999,
                      background:
                        idx <= activeStoryIndex ? 'var(--accent)' : 'rgba(255, 255, 255, 0.25)',
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  background: 'rgba(0, 0, 0, 0.5)',
                  padding: '8px 10px',
                  borderRadius: 12,
                  backdropFilter: 'blur(8px)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    className={`avatar ${!activeGroup.userAvatar ? 'avatar-fallback' : ''}`}
                    style={{
                      width: 34,
                      height: 34,
                      fontSize: 14,
                      backgroundImage: activeGroup.userAvatar ? `url(${activeGroup.userAvatar})` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  >
                    {!activeGroup.userAvatar && activeGroup.userName.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>{activeGroup.userName}</span>
                      {activeGroup.isVerified && <VerifiedBadge size={13} />}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>
                      {formatRelativeTime(currentStory.createdAt)} • ⏳ ещё {formatRemainingHours(currentStory.expiresAt)}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {currentStory.userId === profile.id && (
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ width: 'auto', padding: '4px 8px', fontSize: 13, color: '#ff6b6b' }}
                      title="Удалить эту историю"
                      onClick={async () => {
                        const updated = await deleteStoryById(currentStory.id);
                        setStories(updated);
                        if (activeGroup.items.length <= 1) {
                          setActiveGroupUserId(null);
                        } else {
                          setActiveStoryIndex(0);
                        }
                      }}
                    >
                      🗑️
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ width: 'auto', padding: '4px 8px', fontSize: 15, color: '#fff' }}
                    onClick={() => {
                      setActiveGroupUserId(null);
                      setActiveStoryIndex(0);
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>

            {/* Центральный текст истории + переключение влево/вправо */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: '12px 16px',
                cursor: 'pointer',
              }}
              onClick={() => {
                if (activeStoryIndex + 1 < activeGroup.items.length) {
                  setActiveStoryIndex((i) => i + 1);
                } else {
                  setActiveGroupUserId(null);
                  setActiveStoryIndex(0);
                }
              }}
            >
              {currentStory.text && (
                <div
                  style={{
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 19,
                    lineHeight: 1.45,
                    textShadow: '0 2px 12px rgba(0,0,0,0.9)',
                    background: currentStory.mediaUrl ? 'rgba(0, 0, 0, 0.62)' : 'transparent',
                    padding: currentStory.mediaUrl ? '10px 14px' : 0,
                    borderRadius: 12,
                    maxWidth: '95%',
                    wordBreak: 'break-word',
                  }}
                >
                  {currentStory.text}
                </div>
              )}
            </div>

            {/* Нижняя панель: реакции и просмотры */}
            <div
              style={{
                zIndex: 2,
                background: 'rgba(0, 0, 0, 0.6)',
                padding: '10px 12px',
                borderRadius: 12,
                backdropFilter: 'blur(8px)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5, color: 'rgba(255,255,255,0.8)' }}>
                <span>👁️ Просмотров: {currentStory.viewers?.length || 1}</span>
                <span>{currentStory.privacy === 'friends' ? '👥 Только друзья' : '🌍 Публичная история'}</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: 6 }}>
                {STORY_REACTIONS.map((emoji) => {
                  const count = currentStory.reactions?.[emoji]?.length || 0;
                  const reacted = currentStory.reactions?.[emoji]?.includes(profile.id);
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={async () => {
                        const updated = await toggleStoryReaction(currentStory.id, emoji, profile.id);
                        setStories(updated);
                      }}
                      style={{
                        background: reacted ? 'rgba(255, 212, 0, 0.25)' : 'rgba(255, 255, 255, 0.1)',
                        border: reacted ? '1px solid var(--accent)' : '1px solid transparent',
                        borderRadius: 999,
                        padding: '5px 10px',
                        fontSize: 15,
                        color: '#fff',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <span>{emoji}</span>
                      {count > 0 && <span style={{ fontSize: 11, fontWeight: 700 }}>{count}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
