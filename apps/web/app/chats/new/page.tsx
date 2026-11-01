'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createChat, getCurrentProfile, updateChatInfo } from '@pixchats/core';
import type { ChatType, ChatVisibility } from '@pixchats/core';
import { isBanned } from '../../../lib/ban';
import { BackIcon } from '../../../components/Icons';
import {
  DEFAULT_TOPICS,
  encodeChatDescriptionWithConfig,
  type ChatTopicItem,
} from '../../../lib/channelConfig';

export default function NewChatPage() {
  const router = useRouter();
  const [type, setType] = useState<Extract<ChatType, 'group' | 'channel'>>('group');
  const [visibility, setVisibility] = useState<ChatVisibility>('private');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [username, setUsername] = useState('');

  // Пункт 8: Настройки создателя канала / группы (комментарии и режим с темами)
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [structureMode, setStructureMode] = useState<'standard' | 'topics'>('standard');
  const [topics, setTopics] = useState<ChatTopicItem[]>(DEFAULT_TOPICS);
  const [newTopicTitle, setNewTopicTitle] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const profile = await getCurrentProfile();
      if (!profile) {
        router.push('/login');
        return;
      }
      if (isBanned(profile)) {
        router.push('/banned');
      }
    })();
  }, [router]);

  function handleAddTopic() {
    const clean = newTopicTitle.trim();
    if (!clean) return;
    const id = `topic-${Date.now().toString(36)}`;
    setTopics((prev) => [...prev, { id, title: clean, icon: '📌' }]);
    setNewTopicTitle('');
  }

  function handleRemoveTopic(id: string) {
    if (topics.length <= 1) return;
    setTopics((prev) => prev.filter((t) => t.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const chat = await createChat({
        type,
        visibility,
        title,
        username: visibility === 'public' ? username : undefined,
      });

      const encodedDesc = encodeChatDescriptionWithConfig(description, {
        commentsEnabled: type === 'channel' ? commentsEnabled : true,
        structureMode,
        topics,
      });

      try {
        await updateChatInfo(chat.id, { description: encodedDesc });
      } catch {}

      router.push(`/chat/?id=${chat.id}`);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось создать');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-center">
      <div className="container-narrow">
        <div className="card">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 0 }}>
            Новая группа или канал
          </h1>

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Тип</label>
              <select className="input" value={type} onChange={(e) => setType(e.target.value as any)}>
                <option value="group">Группа (общение всех участников + голосовые комнаты)</option>
                <option value="channel">Канал (публикации от владельца/админов)</option>
              </select>
            </div>

            <div className="field">
              <label>Видимость</label>
              <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as any)}>
                <option value="private">Приватная (только по инвайту)</option>
                <option value="public">Публичная (видна в поиске, есть @username)</option>
              </select>
            </div>

            <div className="field">
              <label>Название</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>

            <div className="field">
              <label>Описание (необязательно)</label>
              <textarea
                className="input"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="О чём эта группа или канал…"
              />
            </div>

            {visibility === 'public' && (
              <div className="field">
                <label>Юзернейм</label>
                <div className="input-prefix">
                  <span>@</span>
                  <input
                    className="input"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
                    required
                  />
                </div>
              </div>
            )}

            {/* Пункт 8: Настройка формата (Обычный или С темами) и комментариев к постам канала */}
            <div className="field">
              <label>Формат {type === 'channel' ? 'канала' : 'группы'}</label>
              <select
                className="input"
                value={structureMode}
                onChange={(e) => setStructureMode(e.target.value as 'standard' | 'topics')}
              >
                <option value="standard">Обычный (единая лента сообщений)</option>
                <option value="topics">С темами / Топиками (разделение по вкладкам #Темы)</option>
              </select>
            </div>

            {structureMode === 'topics' && (
              <div
                className="field"
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                <label style={{ marginBottom: 8, display: 'block' }}>Темы (Топики)</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  {topics.map((t) => (
                    <span
                      key={t.id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 10px',
                        borderRadius: 999,
                        background: 'var(--surface-raised)',
                        border: '1px solid var(--accent)',
                        fontSize: 12,
                      }}
                    >
                      <span>
                        {t.icon} #{t.title}
                      </span>
                      {topics.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveTopic(t.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: 0,
                            fontSize: 12,
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    className="input"
                    style={{ flex: 1, height: 34, fontSize: 13 }}
                    placeholder="Название новой темы…"
                    value={newTopicTitle}
                    onChange={(e) => setNewTopicTitle(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn"
                    style={{ width: 'auto', padding: '4px 12px', fontSize: 12 }}
                    onClick={handleAddTopic}
                  >
                    + Добавить
                  </button>
                </div>
              </div>
            )}

            {type === 'channel' && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'var(--bg-secondary)',
                  border: `1px solid ${commentsEnabled ? 'var(--accent)' : 'var(--border)'}`,
                  marginBottom: 16,
                  cursor: 'pointer',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>💬 Комментарии к постам</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    Разрешить подписчикам комментировать публикации в канале
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={commentsEnabled}
                  onChange={(e) => setCommentsEnabled(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
                />
              </label>
            )}

            {error && <p className="error">{error}</p>}

            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Создаём…' : 'Создать'}
            </button>
          </form>
        </div>

        <p className="muted-link">
          <Link href="/chats/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <BackIcon size={16} />
            <span>Назад к чатам</span>
          </Link>
        </p>
      </div>
    </main>
  );
}
