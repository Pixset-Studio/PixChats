'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createChat, getCurrentProfile } from '@pixchats/core';
import type { ChatType, ChatVisibility } from '@pixchats/core';
import { isBanned } from '../../../lib/ban';

export default function NewChatPage() {
  const router = useRouter();
  const [type, setType] = useState<Extract<ChatType, 'group' | 'channel'>>('group');
  const [visibility, setVisibility] = useState<ChatVisibility>('private');
  const [title, setTitle] = useState('');
  const [username, setUsername] = useState('');
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
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 0 }}>Новая группа или канал</h1>

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Тип</label>
              <select className="input" value={type} onChange={(e) => setType(e.target.value as any)}>
                <option value="group">Группа</option>
                <option value="channel">Канал (писать могут только владелец/админы)</option>
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

            {error && <p className="error">{error}</p>}

            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Создаём…' : 'Создать'}
            </button>
          </form>
        </div>

        <p className="muted-link">
          <Link href="/chats/">← Назад к чатам</Link>
        </p>
      </div>
    </main>
  );
}
