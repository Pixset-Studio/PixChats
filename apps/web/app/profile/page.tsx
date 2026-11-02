'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCurrentProfile,
  getCachedCurrentProfile,
  hasActiveSession,
  signOut,
  getLinkedPixsetNickname,
  getPixsetPublicProfileUrl,
  getOrCreateSavedMessagesChat,
} from '@pixchats/core';
import type { Profile } from '@pixchats/core';
import { NameWithBadges } from '../../components/NameBadges';
import { BottomNav } from '../../components/BottomNav';
import { DesktopShell } from '../../components/DesktopShell';
import { isBanned } from '../../lib/ban';
import { buildAppUrl } from '../../lib/url';
import { clearChatListCache } from '../../lib/chatListCache';
import { QrCodeModal } from '../../components/QrCodeModal';
import { EmojiPicker } from '../../components/EmojiPicker';
import { SharedChatAttachments } from '../../components/SharedChatAttachments';
import {
  getUserEmojiStatus,
  setUserEmojiStatus,
  EMOJI_STATUS_PRESETS,
} from '../../lib/emojiStatus';

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(() => getCachedCurrentProfile());
  const [showQrModal, setShowQrModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiStatus, setEmojiStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const active = await hasActiveSession();
      if (!active) {
        router.push('/login/');
        return;
      }
      const me = await getCurrentProfile();
      if (!me) {
        router.push('/complete-profile/');
        return;
      }
      if (isBanned(me)) {
        router.push('/banned/');
        return;
      }
      setProfile(me);
      setEmojiStatus(getUserEmojiStatus(me.id, me.username));
    })();
  }, [router]);

  if (!profile) return null;

  const linkedPixsetNick = getLinkedPixsetNickname(profile, true);
  const profileShareUrl = buildAppUrl(`/user/?id=${profile.id}`);

  async function handleOpenSavedMessages() {
    if (!profile) return;
    try {
      const savedChat = await getOrCreateSavedMessagesChat(profile.id);
      router.push(`/chat/?id=${savedChat.id}`);
    } catch {}
  }

  async function handleSelectEmojiStatus(nextEmoji: string | null) {
    if (!profile) return;
    setEmojiStatus(nextEmoji);
    setShowEmojiPicker(false);
    await setUserEmojiStatus(profile.id, nextEmoji, profile.username);
  }

  return (
    <DesktopShell>
      <main className="container-wide with-bottom-nav">
        <div className="profile-hero">
          <div
            className={`avatar ${!profile.avatar_url ? 'avatar-fallback' : ''}`}
            style={{
              backgroundImage: profile.avatar_url ? `url(${profile.avatar_url})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            {!profile.avatar_url && profile.display_name.slice(0, 1).toUpperCase()}
          </div>
          <h2>
            <NameWithBadges
              name={profile.display_name}
              userId={profile.id}
              username={profile.username}
              emojiStatus={emojiStatus}
              role={profile.role}
              isVerified={profile.is_verified}
              isPixsetEmployee={profile.is_pixset_employee}
            />
          </h2>
          <div className="username">@{profile.username}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            В PixChats с{' '}
            {new Date(profile.created_at).toLocaleDateString('ru-RU', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })}
          </div>
          {profile.bio && (
            <p style={{ maxWidth: 420, margin: '10px auto 0', color: 'var(--text-muted)', fontSize: 14 }}>
              {profile.bio}
            </p>
          )}

          {/* Быстрый выбор Эмодзи-статуса (отображается справа рядом с ником) */}
          <div
            style={{
              marginTop: 14,
              padding: '10px 14px',
              borderRadius: 14,
              background: 'var(--surface-raised)',
              border: '1px solid var(--border)',
              maxWidth: 480,
              marginInline: 'auto',
              position: 'relative',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                ✨ Эмодзи-статус рядом с ником: {emojiStatus || 'не выбран'}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-compact"
                  style={{ width: 'auto', padding: '3px 8px', fontSize: 11 }}
                  onClick={() => setShowEmojiPicker((v) => !v)}
                >
                  😀 Все эмодзи / 🏳️ Флаги
                </button>
                {emojiStatus && (
                  <button
                    type="button"
                    className="btn btn-compact"
                    style={{ width: 'auto', padding: '3px 8px', fontSize: 11 }}
                    onClick={() => void handleSelectEmojiStatus(null)}
                  >
                    ✕ Сбросить
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              {EMOJI_STATUS_PRESETS.slice(0, 12).map((item) => (
                <button
                  key={item.emoji}
                  type="button"
                  title={item.label}
                  onClick={() => void handleSelectEmojiStatus(item.emoji)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    border:
                      emojiStatus === item.emoji
                        ? '2px solid var(--accent)'
                        : '1px solid var(--border)',
                    background:
                      emojiStatus === item.emoji
                        ? 'rgba(255, 212, 0, 0.16)'
                        : 'var(--bg)',
                    fontSize: 16,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {item.emoji}
                </button>
              ))}
            </div>

            {showEmojiPicker && (
              <div
                style={{
                  marginTop: 10,
                  display: 'flex',
                  justifyContent: 'center',
                }}
              >
                <EmojiPicker
                  title="Выберите эмодзи-статус или флаг"
                  onSelect={(emoji) => void handleSelectEmojiStatus(emoji)}
                  onClose={() => setShowEmojiPicker(false)}
                />
              </div>
            )}
          </div>

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
        </div>

        <div className="profile-actions-row">
          <Link href="/settings/" className="btn btn-primary btn-compact" style={{ textDecoration: 'none' }}>
            ✏️ Изменить профиль
          </Link>
          <button
            type="button"
            className="btn btn-compact"
            onClick={() => setShowQrModal(true)}
          >
            📱 QR-код профиля
          </button>
          <button
            type="button"
            className="btn btn-compact"
            onClick={handleOpenSavedMessages}
          >
            ⭐ Избранное
          </button>
          <Link href="/appeals/" className="btn btn-compact" style={{ textDecoration: 'none' }}>
            ⚖️ Апелляции
          </Link>
          {(profile.role === 'admin' || profile.role === 'developer' || profile.role === 'moderator') && (
            <Link href="/admin/" className="btn btn-compact" style={{ textDecoration: 'none' }}>
              🛡️ Панель администратора
            </Link>
          )}
          <button
            className="btn btn-compact"
            onClick={async () => {
              clearChatListCache();
              await signOut();
              router.push('/login');
            }}
          >
            Выйти
          </button>
        </div>

        <SharedChatAttachments
          targetUserId={profile.id}
          title="Мои активные истории и медиа"
        />

        {showQrModal && (
          <QrCodeModal
            title={profile.display_name}
            subtitle={`@${profile.username}`}
            avatarUrl={profile.avatar_url}
            url={profileShareUrl}
            badgeText="PixChats Профиль"
            onClose={() => setShowQrModal(false)}
          />
        )}
      </main>
      <BottomNav />
    </DesktopShell>
  );
}
