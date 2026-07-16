'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getSupabaseClient,
  getCurrentProfile,
  getMessages,
  sendMessage,
  subscribeToMessages,
} from '@pixchats/core';
import type { Message, Chat, Profile } from '@pixchats/core';

function ChatWindowInner() {
  const searchParams = useSearchParams();
  const chatId = searchParams.get('id') ?? '';
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [canWrite, setCanWrite] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chatId) {
      router.push('/chats');
      return;
    }
    let unsubscribe: (() => void) | undefined;

    (async () => {
      const profile = await getCurrentProfile();
      if (!profile) {
        router.push('/login');
        return;
      }
      setMe(profile);

      const supabase = getSupabaseClient();
      const { data: chatRow } = await supabase.from('chats').select('*').eq('id', chatId).single();
      setChat(chatRow);

      const { data: memberRow } = await supabase
        .from('chat_members')
        .select('member_role')
        .eq('chat_id', chatId)
        .eq('user_id', profile.id)
        .maybeSingle();
      setCanWrite(memberRow?.member_role !== 'subscriber');

      setMessages(await getMessages(chatId));

      unsubscribe = subscribeToMessages(chatId, (msg) => {
        setMessages((prev) => [...prev, msg]);
      });
    })();

    return () => unsubscribe?.();
  }, [chatId, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    await sendMessage(chatId, draft.trim());
    setDraft('');
  }

  if (!chat || !me) return <p style={{ padding: 24, color: 'var(--text-muted)' }}>Загрузка…</p>;

  return (
    <main className="chat-shell">
      <header className="chat-header">
        <Link href="/chats/" style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none' }}>
          ← Назад
        </Link>
        <h2>
          {chat.title ?? 'Личный чат'}
          {chat.is_verified && <span className="badge-check" style={{ marginLeft: 4 }}>✔</span>}
        </h2>
      </header>

      <div className="chat-messages">
        {messages.map((m) => (
          <div key={m.id} className={`bubble-row ${m.sender_id === me.id ? 'mine' : ''}`}>
            <span className="bubble">{m.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {canWrite ? (
        <form onSubmit={handleSend} className="chat-composer">
          <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Сообщение…" />
          <button type="submit" className="btn btn-primary" style={{ width: 'auto', padding: '10px 20px' }}>
            Отправить
          </button>
        </form>
      ) : (
        <p className="subscriber-notice">Вы подписчик канала — писать могут только владелец и администраторы</p>
      )}
    </main>
  );
}

/**
 * useSearchParams требует Suspense-границу при статическом экспорте (output: 'export') —
 * иначе сборка упадёт с предупреждением о деоптимизации в CSR bailout.
 */
export default function ChatWindowPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24, color: 'var(--text-muted)' }}>Загрузка…</p>}>
      <ChatWindowInner />
    </Suspense>
  );
}
