'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatLastSeen } from '../../lib/lastSeen';
import { VerifiedBadge } from '../../components/VerifiedBadge';
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
  const [otherProfile, setOtherProfile] = useState<Profile | null>(null);
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

      if (chatRow?.type === 'direct') {
        const { data: memberRows } = await supabase
          .from('chat_members')
          .select('user_id')
          .eq('chat_id', chatId);
        const otherId = (memberRows ?? []).map((r) => r.user_id).find((id) => id !== profile.id);
        if (otherId) {
          const { data: otherRow } = await supabase.from('profiles').select('*').eq('id', otherId).single();
          setOtherProfile(otherRow);
        }
      }

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
        {chat.type === 'direct' && otherProfile ? (
          <Link href={`/user/?id=${otherProfile.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'inherit', textDecoration: 'none' }}>
            <div
              className="avatar"
              style={{
                width: 36,
                height: 36,
                fontSize: 14,
                backgroundImage: otherProfile.avatar_url ? `url(${otherProfile.avatar_url})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              {!otherProfile.avatar_url && otherProfile.display_name.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <h2 style={{ fontSize: 15 }}>
                {otherProfile.display_name}
                {otherProfile.is_verified && <VerifiedBadge size={14} />}
              </h2>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatLastSeen(otherProfile)}</div>
            </div>
          </Link>
        ) : (
          <Link href={`/chat-info/?id=${chat.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
            <h2>
              {chat.title ?? 'Чат'}
              {chat.is_verified && <VerifiedBadge size={14} />}
            </h2>
          </Link>
        )}
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
