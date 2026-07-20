'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCurrentProfile,
  getChatMembers,
  getSupabaseClient,
  getMyChatRole,
  getFriends,
  addMemberToChat,
} from '@pixchats/core';
import type { Chat, Profile } from '@pixchats/core';
import { UserRow } from '../../components/UserRow';
import { isBanned } from '../../lib/ban';

function ChatMembersInner() {
  const searchParams = useSearchParams();
  const chatId = searchParams.get('id') ?? '';
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [friendsToAdd, setFriendsToAdd] = useState<Profile[]>([]);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reload(profile: Profile, chatRow: Chat) {
    const memberList = await getChatMembers(chatId);
    setMembers(memberList);

    const friends = await getFriends(profile.id);
    const memberIds = new Set(memberList.map((m) => m.id));
    setFriendsToAdd(friends.map((f) => f.friend_profile).filter((f) => !memberIds.has(f.id)));
  }

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
      if (isBanned(profile)) {
        router.push('/banned');
        return;
      }
      setMe(profile);

      const supabase = getSupabaseClient();
      const { data: chatRow } = await supabase.from('chats').select('*').eq('id', chatId).single();
      setChat(chatRow);

      const role = await getMyChatRole(chatId, profile.id);
      setCanManage(role === 'owner' || role === 'admin');

      if (chatRow) await reload(profile, chatRow);
    })();
  }, [chatId, router]);

  async function handleAddFriend(friendId: string) {
    if (!me || !chat) return;
    setError(null);
    try {
      await addMemberToChat(chatId, friendId, me.id, chat.type);
      setNotice('Добавлен(а)');
      await reload(me, chat);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось добавить');
    }
  }

  if (!chat) return <p style={{ padding: 24, color: 'var(--text-muted)' }}>Загрузка…</p>;

  return (
    <main className="container-wide">
      <Link href={`/chat-info/?id=${chatId}`} style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none' }}>
        ← Назад к профилю чата
      </Link>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20 }}>
        {chat.type === 'channel' ? 'Подписчики' : 'Участники'} ({members.length})
      </h1>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      {canManage && (
        <div style={{ marginBottom: 20 }}>
          {!showAddPanel ? (
            <button className="btn btn-primary" style={{ width: 'auto' }} onClick={() => setShowAddPanel(true)}>
              + Пригласить друга
            </button>
          ) : (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <strong>Кого добавить</strong>
                <button className="btn-ghost" style={{ width: 'auto' }} onClick={() => setShowAddPanel(false)}>
                  ✕
                </button>
              </div>
              {friendsToAdd.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                  Все ваши друзья уже здесь, либо список друзей пуст.
                </p>
              ) : (
                friendsToAdd.map((f) => (
                  <UserRow
                    key={f.id}
                    profile={f}
                    action={
                      <button className="btn" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => handleAddFriend(f.id)}>
                        Добавить
                      </button>
                    }
                  />
                ))
              )}
            </div>
          )}
        </div>
      )}

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
