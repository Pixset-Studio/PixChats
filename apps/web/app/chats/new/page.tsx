'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createChat } from '@pixchats/core';
import type { ChatType, ChatVisibility } from '@pixchats/core';

export default function NewChatPage() {
  const router = useRouter();
  const [type, setType] = useState<Extract<ChatType, 'group' | 'channel'>>('group');
  const [visibility, setVisibility] = useState<ChatVisibility>('private');
  const [title, setTitle] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      router.push(`/chats/${chat.id}`);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось создать');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 400, margin: '60px auto', fontFamily: 'sans-serif' }}>
      <h1>Новая группа или канал</h1>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label>Тип</label>
          <select value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="group">Группа</option>
            <option value="channel">Канал (писать могут только владелец/админы)</option>
          </select>
        </div>

        <div>
          <label>Видимость</label>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as any)}>
            <option value="private">Приватная (только по инвайту)</option>
            <option value="public">Публичная (видна в поиске, есть @username)</option>
          </select>
        </div>

        <div>
          <label>Название</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>

        {visibility === 'public' && (
          <div>
            <label>@username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))} required />
          </div>
        )}

        {error && <p style={{ color: 'crimson' }}>{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Создаём...' : 'Создать'}
        </button>
      </form>
    </main>
  );
}
