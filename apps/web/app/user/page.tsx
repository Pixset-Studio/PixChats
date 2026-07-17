'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentProfile, getSupabaseClient, createDirectChat, sendFriendRequest, areFriends } from '@pixchats/core';
import type { Profile } from '@pixchats/core';
import { NameBadges } from '../../components/NameBadges';
import { resolveLastSeenLabel } from '../../lib/lastSeen';

function UserProfileInner() {
  const searchParams = useSearchParams();
  const userId = searchParams.get('id') ?? '';
  const router = useRouter();

  const [me, setMe] = useState<Profile | null>(null);
  const [user, setUser] = useState<Profile | null>(null);
  const [isFriend, setIsFriend] = useState(false);
  const [lastSeenLabel, setLastSeenLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      router.push('/chats');
      return;
    }
    (async () => {
      const profile = await getCurrentProfile();
      if (!profile) {
        router.push('/login');
        return;
      }
      setMe(profile);

      const supabase = getSupabaseClient();
      const { data: userRow } = await supabase.from('profiles').select('*').eq('id', userId).single();
      setUser(userRow);

      if (userRow) {
        setIsFriend(await areFriends(profile.id, userRow.id));
        setLastSeenLabel(await resolveLastSeenLabel(userRow, profile.id));
      }
    })();
  }, [userId, router]);

  async function handleMessage() {
    if (!user) return;
    setError(null);
    try {
      const chat = await createDirectChat(user.id);
      router.push(`/chat/?id=${chat.id}`);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось начать чат');
    }
  }

  async function handleAddFriend() {
    if (!me || !user) return;
    setError(null);
    try {
      await sendFriendRequest(me.id, user.id);
      setNotice('Заявка отправлена');
    } catch (err: any) {
      setError(err.message ?? 'Не удалось отправить заявку');
    }
  }

  if (!user || !me) return <p style={{ padding: 24, color: 'var(--text-muted)' }}>Загрузка…</p>;

  const isSelf = user.id === me.id;

  return (
    <main className="container-wide">
      <Link href="/chats/" style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none' }}>
        ← Назад
      </Link>

      <div className="profile-hero">
        <div
          className="avatar"
          style={{
            backgroundImage: user.avatar_url ? `url(${user.avatar_url})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          {!user.avatar_url && user.display_name.slice(0, 1).toUpperCase()}
        </div>
        <h2>
          {user.display_name}
          <NameBadges role={user.role} isVerified={user.is_verified} />
        </h2>
        <div className="username">
          @{user.username} · {lastSeenLabel}
        </div>
        {user.bio && (
          <p style={{ maxWidth: 420, margin: '12px auto 0', color: 'var(--text-muted)', fontSize: 14 }}>{user.bio}</p>
        )}

        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}

        {!isSelf && (
          <div className="btn-row" style={{ maxWidth: 280, margin: '16px auto 0', flexDirection: 'row' }}>
            <button className="btn btn-primary" onClick={handleMessage}>
              Написать
            </button>
            {!isFriend && (
              <button className="btn" onClick={handleAddFriend}>
                + Добавить в друзья
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default function UserProfilePage() {
  return (
    <Suspense fallback={<p style={{ padding: 24, color: 'var(--text-muted)' }}>Загрузка…</p>}>
      <UserProfileInner />
    </Suspense>
  );
}
