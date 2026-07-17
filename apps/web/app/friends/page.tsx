'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCurrentProfile,
  hasActiveSession,
  searchUsers,
  sendFriendRequest,
  acceptFriendRequest,
  removeFriendship,
  getFriends,
  getIncomingRequests,
  getOutgoingRequests,
  createDirectChat,
} from '@pixchats/core';
import type { Profile, FriendWithProfile } from '@pixchats/core';
import { UserRow } from '../../components/UserRow';
import { BottomNav } from '../../components/BottomNav';

export default function FriendsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<FriendWithProfile[]>([]);
  const [incoming, setIncoming] = useState<FriendWithProfile[]>([]);
  const [outgoing, setOutgoing] = useState<FriendWithProfile[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function reload(userId: string) {
    setFriends(await getFriends(userId));
    setIncoming(await getIncomingRequests(userId));
    setOutgoing(await getOutgoingRequests(userId));
  }

  useEffect(() => {
    (async () => {
      const active = await hasActiveSession();
      if (!active) {
        router.push('/login');
        return;
      }
      const profile = await getCurrentProfile();
      if (!profile) {
        router.push('/complete-profile');
        return;
      }
      setMe(profile);
      await reload(profile.id);
    })();
  }, [router]);

  async function handleSearch() {
    if (!me || !query) return;
    setResults(await searchUsers(query, me.id));
  }

  async function handleAdd(userId: string) {
    if (!me) return;
    setError(null);
    try {
      await sendFriendRequest(me.id, userId);
      await reload(me.id);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось отправить заявку');
    }
  }

  async function handleAccept(friendshipId: string) {
    if (!me) return;
    await acceptFriendRequest(friendshipId);
    await reload(me.id);
  }

  async function handleRemove(friendshipId: string) {
    if (!me) return;
    await removeFriendship(friendshipId);
    await reload(me.id);
  }

  async function handleMessage(userId: string) {
    setError(null);
    try {
      const chat = await createDirectChat(userId);
      router.push(`/chat/?id=${chat.id}`);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось начать чат');
    }
  }

  if (!me) return null;

  return (
    <>
      <main className="container-wide with-bottom-nav">
        <header className="app-header">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: 0 }}>Друзья</h1>
        </header>

        {error && <p className="error">{error}</p>}

        <div className="section-title">Добавить в друзья</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="@username" />
          <button className="btn" style={{ width: 'auto' }} onClick={handleSearch}>
            Найти
          </button>
        </div>
        <div style={{ marginBottom: 16 }}>
          {results.map((user) => (
            <UserRow
              key={user.id}
              profile={user}
              action={
                <button className="btn" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => handleAdd(user.id)}>
                  + Добавить
                </button>
              }
            />
          ))}
        </div>

        {incoming.length > 0 && (
          <>
            <div className="section-title">Входящие заявки</div>
            <div style={{ marginBottom: 16 }}>
              {incoming.map((req) => (
                <UserRow
                  key={req.id}
                  profile={req.friend_profile}
                  action={
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-primary" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => handleAccept(req.id)}>
                        Принять
                      </button>
                      <button className="btn" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => handleRemove(req.id)}>
                        Отклонить
                      </button>
                    </div>
                  }
                />
              ))}
            </div>
          </>
        )}

        {outgoing.length > 0 && (
          <>
            <div className="section-title">Исходящие заявки</div>
            <div style={{ marginBottom: 16 }}>
              {outgoing.map((req) => (
                <UserRow
                  key={req.id}
                  profile={req.friend_profile}
                  action={
                    <button className="btn" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => handleRemove(req.id)}>
                      Отменить
                    </button>
                  }
                />
              ))}
            </div>
          </>
        )}

        <div className="section-title">Мои друзья</div>
        {friends.length === 0 ? (
          <div className="empty-state">Пока никого нет — найдите друзей по @username выше.</div>
        ) : (
          <div>
            {friends.map((f) => (
              <UserRow
                key={f.id}
                profile={f.friend_profile}
                action={
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => handleMessage(f.friend_profile.id)}>
                      Написать
                    </button>
                    <button className="btn" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => handleRemove(f.id)}>
                      Удалить
                    </button>
                  </div>
                }
              />
            ))}
          </div>
        )}
      </main>
      <BottomNav />
    </>
  );
}
