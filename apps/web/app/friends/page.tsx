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
import { NameBadges } from '../../components/NameBadges';

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
    <main className="container-wide">
      <header className="app-header">
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: 0 }}>Друзья</h1>
        <Link href="/chats/" className="btn btn-ghost" style={{ width: 'auto' }}>
          ← К чатам
        </Link>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="section-title">Добавить в друзья</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="@username" />
        <button className="btn" style={{ width: 'auto' }} onClick={handleSearch}>
          Найти
        </button>
      </div>
      <ul className="list-plain" style={{ marginBottom: 24 }}>
        {results.map((user) => (
          <li key={user.id} className="list-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              @{user.username}
              <NameBadges role={user.role} isVerified={user.is_verified} />
            </span>
            <button className="btn" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => handleAdd(user.id)}>
              + Добавить
            </button>
          </li>
        ))}
      </ul>

      {incoming.length > 0 && (
        <>
          <div className="section-title">Входящие заявки</div>
          <ul className="list-plain" style={{ marginBottom: 24 }}>
            {incoming.map((req) => (
              <li key={req.id} className="list-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>@{req.friend_profile.username}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => handleAccept(req.id)}>
                    Принять
                  </button>
                  <button className="btn" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => handleRemove(req.id)}>
                    Отклонить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {outgoing.length > 0 && (
        <>
          <div className="section-title">Исходящие заявки</div>
          <ul className="list-plain" style={{ marginBottom: 24 }}>
            {outgoing.map((req) => (
              <li key={req.id} className="list-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>@{req.friend_profile.username} — ожидает ответа</span>
                <button className="btn" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => handleRemove(req.id)}>
                  Отменить
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="section-title">Мои друзья</div>
      {friends.length === 0 ? (
        <div className="empty-state">Пока никого нет — найдите друзей по @username выше.</div>
      ) : (
        <ul className="list-plain">
          {friends.map((f) => (
            <li key={f.id} className="list-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                @{f.friend_profile.username}
                <NameBadges role={f.friend_profile.role} isVerified={f.friend_profile.is_verified} />
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => handleMessage(f.friend_profile.id)}>
                  Написать
                </button>
                <button className="btn" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => handleRemove(f.id)}>
                  Удалить
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
