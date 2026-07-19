'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCurrentProfile,
  getSupabaseClient,
  createDirectChat,
  sendFriendRequest,
  areFriends,
  blockUser,
  unblockUser,
  isUserBlockedByMe,
  getExistingDirectChatId,
  getMuteStates,
  muteChat,
  unmuteChat,
} from '@pixchats/core';
import type { Profile, MuteState } from '@pixchats/core';
import { NameWithBadges } from '../../components/NameBadges';
import { resolveLastSeenLabel } from '../../lib/lastSeen';
import { isBanned } from '../../lib/ban';
import { MuteControl } from '../../components/MuteControl';

function UserProfileInner() {
  const searchParams = useSearchParams();
  const userId = searchParams.get('id') ?? '';
  const router = useRouter();

  const [me, setMe] = useState<Profile | null>(null);
  const [user, setUser] = useState<Profile | null>(null);
  const [isFriend, setIsFriend] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [existingChatId, setExistingChatId] = useState<string | null>(null);
  const [muteState, setMuteState] = useState<MuteState | null>(null);
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
      if (isBanned(profile)) {
        router.push('/banned');
        return;
      }
      setMe(profile);

      const supabase = getSupabaseClient();
      const { data: userRow } = await supabase.from('profiles').select('*').eq('id', userId).single();
      setUser(userRow);

      if (userRow) {
        setIsFriend(await areFriends(profile.id, userRow.id));
        setLastSeenLabel(await resolveLastSeenLabel(userRow, profile.id));
        setIsBlocked(await isUserBlockedByMe(profile.id, userRow.id));

        const chatId = await getExistingDirectChatId(profile.id, userRow.id);
        setExistingChatId(chatId);
        if (chatId) {
          const mutes = await getMuteStates([chatId], profile.id);
          setMuteState(mutes[chatId] ?? { muted: false, mutedForever: false, mutedUntil: null });
        }
      }
    })();
  }, [userId, router]);

  async function handleMute(hours?: number) {
    if (!me || !existingChatId) return;
    await muteChat(me.id, existingChatId, hours);
    const mutes = await getMuteStates([existingChatId], me.id);
    setMuteState(mutes[existingChatId] ?? null);
  }

  async function handleUnmute() {
    if (!me || !existingChatId) return;
    await unmuteChat(me.id, existingChatId);
    setMuteState({ muted: false, mutedForever: false, mutedUntil: null });
  }

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

  async function handleToggleBlock() {
    if (!me || !user) return;
    setError(null);
    try {
      if (isBlocked) {
        await unblockUser(me.id, user.id);
        setIsBlocked(false);
        setNotice('Разблокирован(а)');
      } else {
        await blockUser(me.id, user.id);
        setIsBlocked(true);
        setNotice('Заблокирован(а)');
      }
    } catch (err: any) {
      setError(err.message ?? 'Не удалось изменить блокировку');
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
          <NameWithBadges
            name={user.display_name}
            role={user.role}
            isVerified={user.is_verified}
            isPixsetEmployee={user.is_pixset_employee}
            isFrozen={user.frozen}
          />
        </h2>
        <div className="username">
          @{user.username} · {lastSeenLabel}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          В PixChats с {new Date(user.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })}
        </div>
        {user.bio && (
          <p style={{ maxWidth: 420, margin: '12px auto 0', color: 'var(--text-muted)', fontSize: 14 }}>{user.bio}</p>
        )}

        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}

        {!isSelf && (
          <div className="btn-row" style={{ maxWidth: 280, margin: '16px auto 0', flexDirection: 'row' }}>
            <button className="btn btn-primary" onClick={handleMessage} disabled={isBlocked}>
              Написать
            </button>
            {!isFriend && (
              <button className="btn" onClick={handleAddFriend} disabled={isBlocked}>
                + Добавить в друзья
              </button>
            )}
            <button className="btn" onClick={handleToggleBlock} style={{ color: isBlocked ? undefined : 'var(--danger)' }}>
              {isBlocked ? 'Разблокировать' : 'Заблокировать'}
            </button>
          </div>
        )}

        {!isSelf && existingChatId && (
          <div className="btn-row" style={{ maxWidth: 280, margin: '8px auto 0', flexDirection: 'row', flexWrap: 'wrap' }}>
            <MuteControl muteState={muteState} onMute={handleMute} onUnmute={handleUnmute} />
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
