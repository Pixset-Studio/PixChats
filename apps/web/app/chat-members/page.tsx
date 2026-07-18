'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentProfile, getChatMembers, getSupabaseClient } from '@pixchats/core';
import type { Chat, Profile } from '@pixchats/core';
import { UserRow } from '../../components/UserRow';

function ChatMembersInner() {
  const searchParams = useSearchParams();
  const chatId = searchParams.get('id') ?? '';
  const router = useRouter();
  const [chat, setChat] = useState<Chat | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);

  useEffect(() => {
    if (!chatId) {
      router.push('/chats');
      return;
    }
    (async () => {
      const profile = await getCurrentProfile();
      if (!profile) {
        router.push('/login');
        return;
      }
      const supabase = getSupabaseClient();
      const { data: chatRow } = await supabase.from('chats').select('*').eq('id', chatId).single();
      setChat(chatRow);
      setMembers(await getChatMembers(chatId));
    })();
  }, [chatId, router]);

  if (!chat) return <p style={{ padding: 24, color: 'var(--text-muted)' }}>Загрузка…</p>;

  return (
    <main className="container-wide">
      <Link href={`/chat-info/?id=${chatId}`} style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none' }}>
        ← Назад к профилю чата
      </Link>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20 }}>
        {chat.type === 'channel' ? 'Подписчики' : 'Участники'} ({members.length})
      </h1>

      {members.map((m) => (
        <Link key={m.id} href={`/user/?id=${m.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <UserRow profile={m} />
        </Link>
      ))}
    </main>
  );
}

export default function ChatMembersPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24, color: 'var(--text-muted)' }}>Загрузка…</p>}>
      <ChatMembersInner />
    </Suspense>
  );
}
