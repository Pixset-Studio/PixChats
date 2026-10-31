'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getCurrentProfile,
  hasActiveSession,
  acceptFriendRequest,
  removeFriendship,
  getFriends,
  getIncomingRequests,
  getOutgoingRequests,
  createDirectChat,
  getSupabaseClient,
} from '@pixchats/core';
import type { Profile, FriendWithProfile } from '@pixchats/core';
import { UserRow } from '../../components/UserRow';
import { BottomNav } from '../../components/BottomNav';
import { resolveLastSeenLabel } from '../../lib/lastSeen';
import { isBanned } from '../../lib/ban';
import { SearchIcon } from '../../components/Icons';

export default function FriendsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<FriendWithProfile[]>([]);
  const [incoming, setIncoming] = useState<FriendWithProfile[]>([]);
  const [outgoing, setOutgoing] = useState<FriendWithProfile[]>([]);
  const [query, setQuery] = useState('');
  const [lastSeenLabels, setLastSeenLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function loadLastSeenLabels(viewerId: string, profiles: Profile[]) {
    const entries = await Promise.all(
      profiles.map(async (p) => [p.id, await resolveLastSeenLabel(p, viewerId)] as const)
    );
    setLastSeenLabels((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
  }

  async function reload(userId: string) {
    const f = await getFriends(userId);
    const inc = await getIncomingRequests(userId);
    const out = await getOutgoingRequests(userId);
    setFriends(f);
    setIncoming(inc);
    setOutgoing(out);
    await loadLastSeenLabels(userId, [
      ...f.map((x) => x.friend_profile),
      ...inc.map((x) => x.friend_profile),
      ...out.map((x) => x.friend_profile),
    ]);
  }

  useEffect(() => {
    let channel: any;
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
      if (isBanned(profile)) {
        router.push('/banned');
        return;
      }
      setMe(profile);
      await reload(profile.id);

      // Realtime subscription: обновление списка друзей и заявок без перезагрузки страницы
      const supabase = getSupabaseClient();
      channel = supabase
        .channel(`realtime-friends-${profile.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'friendships' },
          () => {
            reload(profile.id);
          }
        )
        .subscribe();
    })();

    return () => {
      if (channel) {
        const supabase = getSupabaseClient();
        supabase.removeChannel(channel);
      }
    };
  }, [router]);

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

  // Поиск теперь только по уже добавленным друзьям — искать новых людей можно через поиск на странице чатов.
  const q = query.trim().toLowerCase();
  const filteredFriends = q
    ? friends.filter(
        (f) =>
          f.friend_profile.display_name.toLowerCase().includes(q) ||
          f.friend_profile.username.toLowerCase().includes(q)
      )
    : friends;

  return (
    <>
      <main className="container-wide with-bottom-nav">
        <header className="app-header">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: 0 }}>Друзья</h1>
        </header>

        {error && <p className="error">{error}</p>}

        <div style={{ position: 'relative', marginBottom: 16 }}>
          <SearchIcon
            size={16}
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}
          />
          <input
            className="input"
            style={{ width: '100%', paddingLeft: 36 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск среди друзей…"
          />
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -12, marginBottom: 16 }}>
          Чтобы добавить нового друга — найдите человека через поиск на странице «Чаты».
        </p>

        {incoming.length > 0 && (
          <>
            <div className="section-title">Входящие заявки</div>
            <div style={{ marginBottom: 16 }}>
              {incoming.map((req) => (
                <UserRow
                  key={req.id}
                  profile={req.friend_profile}
                  lastSeenLabel={lastSeenLabels[req.friend_profile.id]}
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
                  lastSeenLabel={lastSeenLabels[req.friend_profile.id]}
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
        {filteredFriends.length === 0 ? (
          <div className="empty-state">
            {friends.length === 0 ? 'Пока никого нет — найдите друзей через поиск на странице «Чаты».' : 'Никого не найдено.'}
          </div>
        ) : (
          <div>
            {filteredFriends.map((f) => (
              <UserRow
                key={f.id}
                profile={f.friend_profile}
                lastSeenLabel={lastSeenLabels[f.friend_profile.id]}
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
