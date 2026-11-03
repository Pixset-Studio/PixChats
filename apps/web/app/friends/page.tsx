'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getCurrentProfile,
  getCachedCurrentProfile,
  hasActiveSession,
  acceptFriendRequest,
  removeFriendship,
  getFriends,
  getIncomingRequests,
  getOutgoingRequests,
  createDirectChat,
  sendMessage,
  getSupabaseClient,
} from '@pixchats/core';
import type { Profile, FriendWithProfile } from '@pixchats/core';
import { UserRow } from '../../components/UserRow';
import { BottomNav } from '../../components/BottomNav';
import { DesktopShell } from '../../components/DesktopShell';
import { resolveLastSeenLabel } from '../../lib/lastSeen';
import { isBanned } from '../../lib/ban';
import { SearchIcon } from '../../components/Icons';
import {
  getExtendedProfile,
  syncExtendedProfilesFromCloud,
  isBirthdayToday,
  toggleCloseFriend,
  getCloseFriendIds,
} from '../../lib/premiumAndFeatures';

export default function FriendsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(() => getCachedCurrentProfile());
  const [friends, setFriends] = useState<FriendWithProfile[]>([]);
  const [incoming, setIncoming] = useState<FriendWithProfile[]>([]);
  const [outgoing, setOutgoing] = useState<FriendWithProfile[]>([]);
  const [query, setQuery] = useState('');
  const [lastSeenLabels, setLastSeenLabels] = useState<Record<string, string>>({});
  const [closeFriends, setCloseFriends] = useState<string[]>(() => getCloseFriendIds());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
    await syncExtendedProfilesFromCloud(false);
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
        router.push('/login/');
        return;
      }
      const profile = await getCurrentProfile();
      if (!profile) {
        router.push('/complete-profile/');
        return;
      }
      if (isBanned(profile)) {
        router.push('/banned/');
        return;
      }
      setMe(profile);
      await reload(profile.id);

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

  async function handleSendBirthdayGreeting(friendProfile: Profile) {
    setError(null);
    try {
      const chat = await createDirectChat(friendProfile.id);
      await sendMessage(
        chat.id,
        `🎂🎉 С Днём Рождения, ${friendProfile.display_name}! Желаю счастья, вдохновения и ярких побед вместе с PixChats! 🥳✨`
      );
      setNotice(`🎉 Поздравление отправлено для ${friendProfile.display_name}!`);
      setTimeout(() => router.push(`/chat/?id=${chat.id}`), 400);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось отправить поздравление');
    }
  }

  if (!me) return null;

  const q = query.trim().toLowerCase();
  const filteredFriends = q
    ? friends.filter(
        (f) =>
          f.friend_profile.display_name.toLowerCase().includes(q) ||
          f.friend_profile.username.toLowerCase().includes(q)
      )
    : friends;

  const birthdayFriends = friends.filter((f) => {
    const ext = getExtendedProfile(f.friend_profile.id, f.friend_profile.username);
    return isBirthdayToday(ext.birthDate);
  });

  return (
    <DesktopShell>
      <main className="container-wide with-bottom-nav">
        <header className="app-header">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: 0 }}>Друзья</h1>
        </header>

        {notice && <p className="notice">{notice}</p>}
        {error && <p className="error">{error}</p>}

        {/* Праздничный блок именинников среди друзей */}
        {birthdayFriends.length > 0 && (
          <div
            className="card"
            style={{
              marginBottom: 18,
              background: 'linear-gradient(135deg, rgba(255, 212, 0, 0.2), rgba(236, 72, 153, 0.14), var(--surface))',
              border: '2px solid var(--accent)',
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>
              🎂 Сегодня день рождения у ваших друзей ({birthdayFriends.length})!
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {birthdayFriends.map((bf) => (
                <div
                  key={`bday-${bf.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    flexWrap: 'wrap',
                    padding: '10px 12px',
                    borderRadius: 12,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14.5 }}>
                      🎂 {bf.friend_profile.display_name}{' '}
                      <span style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>
                        (@{bf.friend_profile.username})
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 2 }}>
                      Празднует день рождения сегодня! Отправьте открытку-поздравление:
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-compact"
                    style={{ fontWeight: 800 }}
                    onClick={() => handleSendBirthdayGreeting(bf.friend_profile)}
                  >
                    🎉 Отправить поздравление
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

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
          Чтобы добавить нового друга — найдите человека через поиск на странице «Чаты». Нажмите 💚, чтобы добавить друга в «Близкие друзья» для Историй.
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
            {filteredFriends.map((f) => {
              const isClose = closeFriends.includes(f.friend_profile.id);
              const ext = getExtendedProfile(f.friend_profile.id, f.friend_profile.username);
              const isBday = isBirthdayToday(ext.birthDate);
              return (
                <UserRow
                  key={f.id}
                  profile={f.friend_profile}
                  lastSeenLabel={
                    isBday
                      ? `🎂 День рождения сегодня! • ${lastSeenLabels[f.friend_profile.id] || ''}`
                      : lastSeenLabels[f.friend_profile.id]
                  }
                  action={
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {isBday && (
                        <button
                          type="button"
                          className="btn btn-primary btn-compact"
                          onClick={() => handleSendBirthdayGreeting(f.friend_profile)}
                          title="Поздравить с днём рождения в 1 клик"
                        >
                          🎉 Поздравить
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-compact"
                        style={{
                          borderColor: isClose ? '#22c55e' : 'var(--border)',
                          color: isClose ? '#22c55e' : 'var(--text-muted)',
                        }}
                        onClick={() => {
                          toggleCloseFriend(f.friend_profile.id);
                          setCloseFriends(getCloseFriendIds());
                        }}
                        title="Близкие друзья для Историй"
                      >
                        {isClose ? '💚 Близкий' : '🤍'}
                      </button>
                      <button className="btn btn-primary btn-compact" onClick={() => handleMessage(f.friend_profile.id)}>
                        Написать
                      </button>
                      <button className="btn btn-compact" onClick={() => handleRemove(f.id)}>
                        Удалить
                      </button>
                    </div>
                  }
                />
              );
            })}
          </div>
        )}
      </main>
      <BottomNav />
    </DesktopShell>
  );
}
