'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getSupabaseClient,
  getCurrentProfile,
  getMessages,
  sendMessage,
  subscribeToMessages,
} from '@pixchats/core';
import type { Message, Chat, Profile } from '@pixchats/core';

export async function generateStaticParams() {
  // Возвращаем пустой массив для static export
  // На клиенте параметры будут получены из useParams()
  return [];
}

export default function ChatWindowPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [canWrite, setCanWrite] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    (async () => {
      const profile = await getCurrentProfile();
      if (!profile) {
        router.push('/login');
        return;
      }
      setMe(profile);

      const supabase = getSupabaseClient();
      const { data: chatRow } = await supabase.from('chats').select('*').eq('id', params.id).single();
      setChat(chatRow);

      const { data: memberRow } = await supabase
        .from('chat_members')
        .select('member_role')
        .eq('chat_id', params.id)
        .eq('user_id', profile.id)
        .maybeSingle();
      setCanWrite(memberRow?.member_role !== 'subscriber');

      setMessages(await getMessages(params.id));

      unsubscribe = subscribeToMessages(params.id, (msg) => {
        setMessages((prev) => [...prev, msg]);
      });
    })();

    return () => unsubscribe?.();
  }, [params.id, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    await sendMessage(params.id, draft.trim());
    setDraft('');
  }

  if (!chat || !me) return <p style={{ padding: 24 }}>Загрузка...</p>;

  return (
    <main style={{ maxWidth: 600, margin: '0 auto', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ padding: 16, borderBottom: '1px solid #eee' }}>
        <a href="/chats">← Назад</a>
        <h2 style={{ margin: '4px 0' }}>
          {chat.title ?? 'Личный чат'}
          {chat.is_verified && <span style={{ color: '#2b8aef', marginLeft: 4 }}>✔️</span>}
        </h2>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              textAlign: m.sender_id === me.id ? 'right' : 'left',
              margin: '6px 0',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                padding: '6px 12px',
                borderRadius: 12,
                background: m.sender_id === me.id ? '#2b8aef' : '#eee',
                color: m.sender_id === me.id ? '#fff' : '#000',
                maxWidth: '70%',
              }}
            >
              {m.text}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {canWrite ? (
        <form onSubmit={handleSend} style={{ display: 'flex', gap: 8, padding: 16, borderTop: '1px solid #eee' }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Сообщение..."
            style={{ flex: 1 }}
          />
          <button type="submit">Отправить</button>
        </form>
      ) : (
        <p style={{ textAlign: 'center', color: '#888', padding: 16 }}>
          Вы подписчик канала — писать могут только владелец и администраторы
        </p>
      )}
    </main>
  );
}
