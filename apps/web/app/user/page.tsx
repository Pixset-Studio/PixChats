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
  getLinkedPixsetNickname,
  getPixsetPublicProfileUrl,
} from '@pixchats/core';
import type { Profile, MuteState } from '@pixchats/core';
import { NameWithBadges } from '../../components/NameBadges';
import { resolveLastSeenLabel } from '../../lib/lastSeen';
import { isBanned } from '../../lib/ban';
import { buildAppUrl } from '../../lib/url';
import { MuteControl } from '../../components/MuteControl';
import { Loading } from '../../components/Loading';
import { DesktopShell } from '../../components/DesktopShell';
import { SharedChatAttachments } from '../../components/SharedChatAttachments';
import { QrCodeModal } from '../../components/QrCodeModal';
import { startPixChatsCall } from '../../components/CallManager';
import {
  isChatArchived,
  toggleArchiveChat,
  getCustomFolders,
  toggleChatInCustomFolder,
  type CustomChatFolder,
} from '../../lib/chatFolders';
import { isChatHidden, toggleHiddenChat } from '../../lib/appLock';

import { loadActiveStories, type StoryItem, STORY_GRADIENTS } from '../../lib/stories';

function UserProfileInner() {
  const searchParams = useSearchParams();
  const userId = searchParams.get('id') ?? '';
  const router = useRouter();

  const [me, setMe] = useState<Profile | null>(null);
  const [user, setUser] = useState<Profile | null>(null);
  const [userStories, setUserStories] = useState<StoryItem[]>([]);
  const [activeStoryIndex, setActiveStoryIndex] = useState<number | null>(null);
  const [userNotFound, setUserNotFound] = useState(false);
  const [isFriend, setIsFriend] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [existingChatId, setExistingChatId] = useState<string | null>(null);
  const [muteState, setMuteState] = useState<MuteState | null>(null);
  const [lastSeenLabel, setLastSeenLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [customFolders, setCustomFolders] = useState<CustomChatFolder[]>([]);
  const [showQrModal, setShowQrModal] = useState(false);

  useEffect(() => {
    setCustomFolders(getCustomFolders());
    if (!existingChatId) return;
    try {
      const list: string[] = JSON.parse(localStorage.getItem('pixchats:pinned_chats') || '[]');
      setIsPinned(list.includes(existingChatId));
      setIsArchived(isChatArchived(existingChatId));
      setIsHidden(isChatHidden(existingChatId));
    } catch {}
  }, [existingChatId]);

  async function ensureDirectChatId(): Promise<string | null> {
    if (existingChatId) return existingChatId;
    if (!user) return null;
    try {
      const newChat = await createDirectChat(user.id);
      setExistingChatId(newChat.id);
      return newChat.id;
    } catch (err: any) {
      setError(err.message ?? 'Не удалось найти чат');
      return null;
    }
  }

  async function handleTogglePin() {
    const targetChatId = await ensureDirectChatId();
    if (!targetChatId) return;

    try {
      const list: string[] = JSON.parse(localStorage.getItem('pixchats:pinned_chats') || '[]');
      const next = list.includes(targetChatId)
        ? list.filter((id) => id !== targetChatId)
        : [targetChatId, ...list];
      localStorage.setItem('pixchats:pinned_chats', JSON.stringify(next));
      setIsPinned(next.includes(targetChatId));
      window.dispatchEvent(new CustomEvent('pixchats:pinned_changed'));
      setNotice(next.includes(targetChatId) ? 'Чат закреплён 📌' : 'Чат откреплён');
      setTimeout(() => setNotice(null), 1500);
    } catch {}
  }

  async function handleToggleArchive() {
    const targetChatId = await ensureDirectChatId();
    if (!targetChatId) return;
    const nowArchived = toggleArchiveChat(targetChatId);
    setIsArchived(nowArchived);
    setNotice(nowArchived ? 'Чат перемещён в Архив 📦' : 'Чат возвращён из Архива');
    setTimeout(() => setNotice(null), 1500);
  }

  async function handleToggleHidden() {
    const targetChatId = await ensureDirectChatId();
    if (!targetChatId) return;
    const nowHidden = toggleHiddenChat(targetChatId);
    setIsHidden(nowHidden);
    setNotice(
      nowHidden
        ? '🔐 Чат скрыт под PIN-кодом (введите свой PIN в поиск чатов)'
        : '🔓 Чат возвращён в общий список'
    );
    setTimeout(() => setNotice(null), 2200);
  }

  async function handleToggleFolder(folderId: string) {
    const targetChatId = await ensureDirectChatId();
    if (!targetChatId) return;
    toggleChatInCustomFolder(folderId, targetChatId);
    setCustomFolders(getCustomFolders());
  }

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
      const { data: userRow } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
      if (!userRow) {
        setUserNotFound(true);
        return;
      }
      setUser(userRow);

      if (userRow) {
        setIsFriend(await areFriends(profile.id, userRow.id));
        setLastSeenLabel(await resolveLastSeenLabel(userRow, profile.id));
        setIsBlocked(await isUserBlockedByMe(profile.id, userRow.id));

        const stories = await loadActiveStories();
        const userActive = stories.filter((s) => s.userId === userRow.id || s.authorUserId === userRow.id);
        setUserStories(userActive);

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

  if (userNotFound) {
    return (
      <main className="page-center">
        <div className="container-narrow card" style={{ textAlign: 'center' }}>
          <h2 style={{ fontFamily: 'var(--font-display)' }}>Пользователь не найден</h2>
          <Link href="/chats" className="btn btn-primary" style={{ marginTop: 12 }}>
            К списку чатов
          </Link>
        </div>
      </main>
    );
  }

  if (!user || !me) return <Loading />;

  const isSelf = user.id === me.id;
  // Кнопка публичного профиля Pixset Studio показывается ТОЛЬКО если к аккаунту привязана система Pixset Studio
  const linkedPixsetNick = getLinkedPixsetNickname(user, isSelf);

  return (
    <main className="container-wide with-bottom-nav">
      <Link href="/chats/" style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none' }}>
        ← Назад
      </Link>

      <div className="profile-hero">
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <div
            className={`avatar ${!user.avatar_url ? 'avatar-fallback' : ''}`}
            style={{
              backgroundImage: user.avatar_url ? `url(${user.avatar_url})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              cursor: userStories.length > 0 ? 'pointer' : 'default',
              border: userStories.length > 0 ? '3.5px solid var(--accent)' : undefined,
              boxShadow: userStories.length > 0 ? '0 0 16px rgba(255, 212, 0, 0.45)' : undefined,
            }}
            onClick={() => {
              if (userStories.length > 0) setActiveStoryIndex(0);
            }}
            title={userStories.length > 0 ? 'Смотреть историю пользователя' : undefined}
          >
            {!user.avatar_url && user.display_name.slice(0, 1).toUpperCase()}
          </div>
        </div>

        {userStories.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-compact"
              style={{
                borderColor: 'var(--accent)',
                color: 'var(--accent)',
                fontSize: 12,
                fontWeight: 700,
              }}
              onClick={() => setActiveStoryIndex(0)}
            >
              📜 Смотреть историю ({userStories.length})
            </button>
          </div>
        )}
        <h2>
          <NameWithBadges
            name={user.display_name}
            userId={user.id}
            username={user.username}
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

        {linkedPixsetNick && (
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
            <a
              href={getPixsetPublicProfileUrl(linkedPixsetNick)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-compact"
              style={{
                textDecoration: 'none',
              }}
            >
              <span>⚡</span>
              <span>Профиль Pixset Studio</span>
            </a>
          </div>
        )}

        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}

        {!isSelf && (
          <div className="profile-actions-row" style={{ marginTop: 14 }}>
            <button className="btn btn-primary btn-compact" onClick={handleMessage} disabled={isBlocked}>
              💬 Написать
            </button>
            <button
              className="btn btn-compact"
              onClick={async () => {
                const cid = await ensureDirectChatId();
                startPixChatsCall({
                  targetUserId: user.id,
                  targetName: user.display_name,
                  targetAvatar: user.avatar_url,
                  chatId: cid ?? undefined,
                  mode: 'audio',
                });
              }}
              disabled={isBlocked}
            >
              📞 Позвонить
            </button>
            <button
              className="btn btn-compact"
              onClick={async () => {
                const cid = await ensureDirectChatId();
                startPixChatsCall({
                  targetUserId: user.id,
                  targetName: user.display_name,
                  targetAvatar: user.avatar_url,
                  chatId: cid ?? undefined,
                  mode: 'video',
                });
              }}
              disabled={isBlocked}
            >
              📹 Видеозвонок
            </button>
            {!isFriend && (
              <button className="btn btn-compact" onClick={handleAddFriend} disabled={isBlocked}>
                + В друзья
              </button>
            )}
            <button className="btn btn-compact" onClick={handleToggleBlock} style={{ color: isBlocked ? undefined : 'var(--danger)' }}>
              {isBlocked ? 'Разблокировать' : 'Заблокировать'}
            </button>
          </div>
        )}

        {!isSelf && (
          <div className="profile-actions-row" style={{ marginTop: 8 }}>
            <button className="btn btn-compact" onClick={() => setShowQrModal(true)}>
              📱 QR-код
            </button>
            <button className="btn btn-compact" onClick={handleTogglePin}>
              {isPinned ? '📌 Открепить' : '📍 Закрепить'}
            </button>
            <button className="btn btn-compact" onClick={handleToggleArchive}>
              {isArchived ? '📦 Из архива' : '📦 В архив'}
            </button>
            <button className="btn btn-compact" onClick={handleToggleHidden}>
              {isHidden ? '🔓 Показать' : '🔐 Скрыть'}
            </button>
            {existingChatId && <MuteControl muteState={muteState} onMute={handleMute} onUnmute={handleUnmute} />}
          </div>
        )}

        {!isSelf && customFolders.length > 0 && (
          <div style={{ maxWidth: 380, margin: '10px auto 0', display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            {customFolders.map((f) => {
              const inFolder = Boolean(existingChatId && f.chatIds.includes(existingChatId));
              return (
                <button
                  key={f.id}
                  type="button"
                  className="btn btn-compact"
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    borderColor: inFolder ? 'var(--accent)' : undefined,
                    color: inFolder ? 'var(--accent)' : undefined,
                  }}
                  onClick={() => handleToggleFolder(f.id)}
                >
                  📁 {f.name} {inFolder ? '✓' : '+'}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <SharedChatAttachments chatId={existingChatId} targetUserId={user.id} />

      {showQrModal && (
        <QrCodeModal
          title={user.display_name}
          subtitle={`@${user.username}`}
          avatarUrl={user.avatar_url}
          url={buildAppUrl(`/user/?id=${user.id}`)}
          badgeText="PixChats Профиль"
          onClose={() => setShowQrModal(false)}
        />
      )}

      {activeStoryIndex !== null && userStories[activeStoryIndex] && (
        <div
          className="modal-overlay story-viewer-overlay"
          style={{ zIndex: 9999, background: 'rgba(5, 5, 7, 0.96)' }}
          onClick={() => setActiveStoryIndex(null)}
        >
          <div
            className="story-viewer-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: userStories[activeStoryIndex].bgGradient || STORY_GRADIENTS[0].css,
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ position: 'relative', zIndex: 10, padding: 'calc(14px + env(safe-area-inset-top, 0px)) 16px 0' }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                {userStories.map((st, idx) => (
                  <div
                    key={st.id}
                    style={{
                      flex: 1,
                      height: 3,
                      borderRadius: 999,
                      background: 'rgba(255,255,255,0.26)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: idx < activeStoryIndex ? '100%' : idx === activeStoryIndex ? '100%' : '0%',
                        height: '100%',
                        background: '#ffd400',
                      }}
                    />
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    className={`avatar ${!user.avatar_url ? 'avatar-fallback' : ''}`}
                    style={{
                      width: 36,
                      height: 36,
                      fontSize: 14,
                      backgroundImage: user.avatar_url ? `url(${user.avatar_url})` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      border: '1.5px solid var(--accent)',
                    }}
                  >
                    {!user.avatar_url && user.display_name.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: '#fff' }}>{user.display_name}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.72)' }}>История 24 часа</div>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-ghost"
                  style={{ width: 'auto', padding: '4px 8px', color: '#fff', fontSize: 16 }}
                  onClick={() => setActiveStoryIndex(null)}
                >
                  ✕
                </button>
              </div>
            </div>

            {userStories[activeStoryIndex].mediaUrl && (
              <img
                src={userStories[activeStoryIndex].mediaUrl!}
                alt="История"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  background: '#000',
                  zIndex: 1,
                }}
              />
            )}

            {userStories[activeStoryIndex].text && (
              <div
                style={{
                  position: 'relative',
                  zIndex: 4,
                  margin: 'auto 20px 24px',
                  padding: '12px 16px',
                  borderRadius: 14,
                  background: 'rgba(0,0,0,0.68)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 18,
                  textAlign: 'center',
                }}
              >
                {userStories[activeStoryIndex].text}
              </div>
            )}

            <div
              style={{
                position: 'relative',
                zIndex: 10,
                padding: '10px 16px calc(14px + env(safe-area-inset-bottom, 0px))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', padding: '10px 14px' }}
                onClick={() => {
                  setActiveStoryIndex(null);
                  handleMessage();
                }}
              >
                💬 Написать сообщение
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function UserProfilePage() {
  return (
    <DesktopShell>
      <Suspense fallback={<Loading />}>
        <UserProfileInner />
      </Suspense>
    </DesktopShell>
  );
}
