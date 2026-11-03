'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCurrentProfile,
  getCachedCurrentProfile,
  hasActiveSession,
  signOut,
  updateProfile,
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
import {
  getUserPremiumStatus,
  syncPremiumManifestFromCloud,
  getUserExtendedProfileSync,
  syncExtendedProfilesFromCloud,
  updateUserExtendedProfile,
  hydratePremiumAndExtendedFromProfileRow,
  uploadFavoriteMusicAudio,
  formatBirthdayHuman,
  PROFILE_BANNER_PRESETS,
  generatePixsetAvatarSvgDataUrl,
  type UserExtendedProfileMeta,
} from '../../lib/premiumAndFeatures';
import { compressImageToDataUrl } from '../../lib/fileStorage';
import {
  playGlobalAudioTrack,
  getGlobalAudioState,
  type GlobalAudioState,
} from '../../lib/audioPlayerStore';

export default function ProfilePage() {
  const router = useRouter();
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const musicFileInputRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<Profile | null>(() => getCachedCurrentProfile());
  const [showQrModal, setShowQrModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiStatus, setEmojiStatus] = useState<string | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  const [extMeta, setExtMeta] = useState<UserExtendedProfileMeta>({});

  // Модалка настройки обложки, любимой музыки и генератора аватара
  const [showCustomizeModal, setShowCustomizeModal] = useState(false);
  const [musicTitle, setMusicTitle] = useState('');
  const [musicArtist, setMusicArtist] = useState('');
  const [musicAudioUrl, setMusicAudioUrl] = useState('');
  const [musicFileName, setMusicFileName] = useState('');
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const [musicUploadError, setMusicUploadError] = useState<string | null>(null);
  const [birthDateDraft, setBirthDateDraft] = useState('');
  const [avatarSeed, setAvatarSeed] = useState('');
  const [avatarStyle, setAvatarStyle] = useState<'pixel' | '3d'>('pixel');
  const [avatarPaletteIdx, setAvatarPaletteIdx] = useState(0);
  const [savingCustom, setSavingCustom] = useState(false);
  const [globalAudio, setGlobalAudio] = useState<GlobalAudioState>(() => getGlobalAudioState());

  useEffect(() => {
    (async () => {
      const active = await hasActiveSession();
      if (!active) {
        router.push('/login/');
        return;
      }
      const me = await getCurrentProfile(true);
      if (!me) {
        router.push('/complete-profile/');
        return;
      }
      if (isBanned(me)) {
        router.push('/banned/');
        return;
      }
      hydratePremiumAndExtendedFromProfileRow(me);
      setProfile(me);
      setEmojiStatus(getUserEmojiStatus(me.id, me.username));
      setIsPremium(getUserPremiumStatus(me.id, me.username).active);
      setAvatarSeed(me.username || me.display_name || 'pixchats');

      const localMeta = getUserExtendedProfileSync(me.id);
      setExtMeta(localMeta);
      setMusicTitle(localMeta.musicStatus?.title || '');
      setMusicArtist(localMeta.musicStatus?.artist || '');
      setMusicAudioUrl(localMeta.musicStatus?.audioUrl || '');
      setMusicFileName(localMeta.musicStatus?.fileName || '');
      setBirthDateDraft(localMeta.birthDate || '');

      void syncPremiumManifestFromCloud(true).then(() => {
        setIsPremium(getUserPremiumStatus(me.id, me.username).active);
      });
      void syncExtendedProfilesFromCloud(false).then((all) => {
        const m = all[me.id] || getUserExtendedProfileSync(me.id);
        setExtMeta(m);
        setMusicTitle(m.musicStatus?.title || '');
        setMusicArtist(m.musicStatus?.artist || '');
        setMusicAudioUrl(m.musicStatus?.audioUrl || '');
        setMusicFileName(m.musicStatus?.fileName || '');
        setBirthDateDraft(m.birthDate || '');
      });
    })();

    const onAudioState = (e: Event) => {
      const detail = (e as CustomEvent<GlobalAudioState>).detail;
      if (detail) setGlobalAudio(detail);
    };
    const onPremiumUpdated = () => {
      const me = getCachedCurrentProfile();
      if (me) setIsPremium(getUserPremiumStatus(me.id, me.username).active);
    };
    window.addEventListener('pixchats:global_audio_state', onAudioState);
    window.addEventListener('pixchats:premium_updated', onPremiumUpdated);
    return () => {
      window.removeEventListener('pixchats:global_audio_state', onAudioState);
      window.removeEventListener('pixchats:premium_updated', onPremiumUpdated);
    };
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
    if (!profile || !isPremium) return;
    setEmojiStatus(nextEmoji);
    setShowEmojiPicker(false);
    await setUserEmojiStatus(profile.id, nextEmoji, profile.username);
  }

  async function handleBannerUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    try {
      const dataUrl = await compressImageToDataUrl(file, 1200, 0.84);
      const updated = await updateUserExtendedProfile(profile.id, { bannerUrl: dataUrl });
      setExtMeta(updated);
    } catch {}
    if (bannerInputRef.current) bannerInputRef.current.value = '';
  }

  async function handleMusicFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setUploadingMusic(true);
    setMusicUploadError(null);
    try {
      const { audioUrl, fileName } = await uploadFavoriteMusicAudio(profile.id, file);
      setMusicAudioUrl(audioUrl);
      setMusicFileName(fileName);
      if (!musicTitle.trim()) {
        const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
        if (baseName) setMusicTitle(baseName);
      }
    } catch (err: any) {
      setMusicUploadError(err?.message || 'Не удалось загрузить аудиофайл');
    } finally {
      setUploadingMusic(false);
      if (musicFileInputRef.current) musicFileInputRef.current.value = '';
    }
  }

  function handlePlayProfileMusic() {
    if (!profile || !extMeta.musicStatus?.audioUrl) return;
    playGlobalAudioTrack({
      id: `profile_music_${profile.id}`,
      src: extMeta.musicStatus.audioUrl,
      title: extMeta.musicStatus.title || 'Любимый трек',
      senderName: extMeta.musicStatus.artist || profile.display_name,
      chatId: '',
      chatTitle: `Профиль @${profile.username}`,
    });
  }

  async function handleSaveCustomize(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSavingCustom(true);
    try {
      const hasMusic = Boolean(musicTitle.trim() || musicArtist.trim() || musicAudioUrl.trim());
      const musicStatus = hasMusic
        ? {
            title: musicTitle.trim() || 'Любимый трек',
            artist: musicArtist.trim() || profile.display_name,
            audioUrl: musicAudioUrl.trim() || null,
            fileName: musicFileName.trim() || null,
            updatedAt: new Date().toISOString(),
          }
        : null;
      const updated = await updateUserExtendedProfile(profile.id, {
        musicStatus,
        birthDate: birthDateDraft.trim() || null,
      });
      setExtMeta(updated);
      setShowCustomizeModal(false);
    } finally {
      setSavingCustom(false);
    }
  }

  async function handleApplyGeneratedAvatar() {
    if (!profile) return;
    setSavingCustom(true);
    try {
      const svgDataUrl = generatePixsetAvatarSvgDataUrl({
        seed: avatarSeed || profile.username,
        bgIndex: avatarPaletteIdx,
        style: avatarStyle,
      });
      await updateProfile(profile.id, { avatarUrl: svgDataUrl });
      setProfile({ ...profile, avatar_url: svgDataUrl });
    } finally {
      setSavingCustom(false);
    }
  }

  const bannerStyle: React.CSSProperties = extMeta.bannerUrl
    ? extMeta.bannerUrl.startsWith('linear-gradient')
      ? { background: extMeta.bannerUrl }
      : {
          backgroundImage: `url(${extMeta.bannerUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }
    : {
        background: 'linear-gradient(135deg, rgba(255, 212, 0, 0.16) 0%, rgba(24, 24, 27, 0.9) 100%)',
      };

  return (
    <DesktopShell>
      <main className="container-wide with-bottom-nav">
        <div className="profile-hero" style={{ position: 'relative', overflow: 'hidden', paddingTop: 0 }}>
          {/* Кастомный баннер (обложка) профиля */}
          <div
            style={{
              height: 118,
              margin: '0 -20px -44px -20px',
              borderBottom: '1px solid var(--border)',
              position: 'relative',
              ...bannerStyle,
            }}
          >
            <button
              type="button"
              className="btn btn-compact"
              onClick={() => setShowCustomizeModal(true)}
              style={{
                position: 'absolute',
                top: 10,
                right: 12,
                background: 'rgba(9, 9, 11, 0.76)',
                color: '#fff',
                borderColor: 'rgba(255,255,255,0.22)',
                fontSize: 11.5,
                padding: '4px 10px',
              }}
            >
              🎨 Обложка и статус
            </button>
          </div>

          <div
            className={`avatar ${!profile.avatar_url ? 'avatar-fallback' : ''}`}
            style={{
              position: 'relative',
              zIndex: 2,
              border: '3px solid var(--surface)',
              backgroundImage: profile.avatar_url ? `url(${profile.avatar_url})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            {!profile.avatar_url && profile.display_name.slice(0, 1).toUpperCase()}
          </div>
          <h2 style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            <NameWithBadges
              name={profile.display_name}
              userId={profile.id}
              username={profile.username}
              emojiStatus={isPremium ? emojiStatus : null}
              role={profile.role}
              isVerified={profile.is_verified}
              isPixsetEmployee={profile.is_pixset_employee}
            />
            {isPremium && (
              <span className="premium-shimmer-badge" title="Активен PixChats Premium">
                ★ Premium
              </span>
            )}
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
          {extMeta.birthDate && (
            <div style={{ fontSize: 12.5, color: 'var(--accent)', fontWeight: 600, marginTop: 4 }}>
              🎂 День рождения: {formatBirthdayHuman(extMeta.birthDate)}
            </div>
          )}
          {profile.bio && (
            <p style={{ maxWidth: 420, margin: '10px auto 0', color: 'var(--text-muted)', fontSize: 14 }}>
              {profile.bio}
            </p>
          )}

          {/* Любимая музыка в профиле с кнопкой прослушивания */}
          {extMeta.musicStatus && (
            <div
              style={{
                marginTop: 10,
                display: 'inline-flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                borderRadius: 16,
                background: 'rgba(255, 212, 0, 0.12)',
                border: '1px solid rgba(255, 212, 0, 0.35)',
                fontSize: 12.5,
                maxWidth: '100%',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <span
                  onClick={() => setShowCustomizeModal(true)}
                  style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  title="Нажмите, чтобы изменить любимую музыку"
                >
                  <span>🎵</span>
                  <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{extMeta.musicStatus.title}</span>
                  <span style={{ color: 'var(--text-muted)' }}>— {extMeta.musicStatus.artist}</span>
                </span>
                {extMeta.musicStatus.audioUrl && (
                  <button
                    type="button"
                    onClick={handlePlayProfileMusic}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      background: 'var(--accent)',
                      color: '#000',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: 11.5,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {globalAudio.track?.id === `profile_music_${profile.id}` && globalAudio.playing
                      ? '⏸ Пауза'
                      : '▶️ Прослушать'}
                  </button>
                )}
              </div>
              {extMeta.musicStatus.audioUrl && (
                <audio
                  controls
                  preload="metadata"
                  src={extMeta.musicStatus.audioUrl}
                  style={{ height: 32, maxWidth: 280, width: '100%' }}
                />
              )}
            </div>
          )}

          {/* Быстрый выбор Эмодзи-статуса — ДОСТУПЕН ТОЛЬКО С PIXCHATS PREMIUM */}
          {isPremium && (
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
                  ✨ Эмодзи-статус Premium: {emojiStatus || 'не выбран'}
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
        </div>

        <div className="profile-actions-row">
          <Link href="/settings/" className="btn btn-primary btn-compact" style={{ textDecoration: 'none' }}>
            ✏️ Изменить профиль
          </Link>
          <button
            type="button"
            className="btn btn-compact"
            onClick={() => setShowCustomizeModal(true)}
          >
            🎨 Обложка / 🎵 Музыка / 🎂 ДР
          </button>
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

        {showCustomizeModal && (
          <div className="modal-overlay" onClick={() => setShowCustomizeModal(false)}>
            <div
              className="modal-card"
              style={{ maxWidth: 460, width: '94%', maxHeight: '90vh', overflowY: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>🎨 Оформление профиля</h3>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ width: 'auto', padding: '4px 8px' }}
                  onClick={() => setShowCustomizeModal(false)}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveCustomize} className="stack">
                {/* 1. Баннер профиля */}
                <div className="field">
                  <label>🖼️ Обложка (баннер) профиля</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    {PROFILE_BANNER_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={async () => {
                          const updated = await updateUserExtendedProfile(profile.id, { bannerUrl: preset.css });
                          setExtMeta(updated);
                        }}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 8,
                          background: preset.css,
                          color: '#fff',
                          border: extMeta.bannerUrl === preset.css ? '2px solid #ffd400' : '1px solid rgba(255,255,255,0.2)',
                          fontSize: 11.5,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      ref={bannerInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={handleBannerUpload}
                    />
                    <button
                      type="button"
                      className="btn btn-compact"
                      onClick={() => bannerInputRef.current?.click()}
                    >
                      📷 Загрузить своё фото на обложку
                    </button>
                    {extMeta.bannerUrl && (
                      <button
                        type="button"
                        className="btn btn-compact"
                        onClick={async () => {
                          const updated = await updateUserExtendedProfile(profile.id, { bannerUrl: null });
                          setExtMeta(updated);
                        }}
                      >
                        Сбросить
                      </button>
                    )}
                  </div>
                </div>

                {/* 2. День рождения */}
                <div className="field">
                  <label>🎂 День рождения (друзья получат уведомление в этот день)</label>
                  <input
                    type="date"
                    className="input"
                    value={birthDateDraft}
                    onChange={(e) => setBirthDateDraft(e.target.value)}
                  />
                </div>

                {/* 3. Любимая музыка с загрузкой аудиофайла */}
                <div className="field">
                  <label>🎵 Любимая музыка в профиле (другие пользователи смогут её прослушать)</label>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input
                      className="input"
                      placeholder="Название трека"
                      value={musicTitle}
                      onChange={(e) => setMusicTitle(e.target.value)}
                    />
                    <input
                      className="input"
                      placeholder="Исполнитель"
                      value={musicArtist}
                      onChange={(e) => setMusicArtist(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      ref={musicFileInputRef}
                      type="file"
                      accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
                      style={{ display: 'none' }}
                      onChange={handleMusicFileUpload}
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-compact"
                      disabled={uploadingMusic}
                      onClick={() => musicFileInputRef.current?.click()}
                    >
                      {uploadingMusic ? '⏳ Загружаем трек…' : '📤 Загрузить аудиофайл (MP3/WAV/OGG/M4A)'}
                    </button>
                    {musicAudioUrl && (
                      <button
                        type="button"
                        className="btn btn-compact"
                        onClick={() => {
                          setMusicAudioUrl('');
                          setMusicFileName('');
                        }}
                      >
                        ✕ Удалить аудиофайл
                      </button>
                    )}
                  </div>
                  <input
                    className="input"
                    style={{ marginTop: 8, fontSize: 12 }}
                    placeholder="Или вставьте прямую ссылку на аудиофайл (https://…)"
                    value={musicAudioUrl}
                    onChange={(e) => setMusicAudioUrl(e.target.value)}
                  />
                  {musicUploadError && (
                    <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{musicUploadError}</div>
                  )}
                  {musicAudioUrl && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 11.5, color: 'var(--accent)', marginBottom: 4 }}>
                        ✅ Аудиофайл прикреплён{musicFileName ? `: ${musicFileName}` : ''} — предпрослушивание:
                      </div>
                      <audio controls preload="metadata" src={musicAudioUrl} style={{ width: '100%', height: 34 }} />
                    </div>
                  )}
                </div>

                {/* 4. Генератор пиксель-арт / 3D аватарок */}
                <div
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    background: 'var(--surface-raised)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                    👾 Генератор уникальных аватарок Pixset Studio
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <img
                      src={generatePixsetAvatarSvgDataUrl({
                        seed: avatarSeed || profile.username,
                        bgIndex: avatarPaletteIdx,
                        style: avatarStyle,
                      })}
                      alt="Avatar preview"
                      style={{ width: 64, height: 64, borderRadius: 16, border: '1px solid var(--border)' }}
                    />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className={`btn btn-compact ${avatarStyle === 'pixel' ? 'btn-primary' : ''}`}
                          onClick={() => setAvatarStyle('pixel')}
                        >
                          Пиксель-арт
                        </button>
                        <button
                          type="button"
                          className={`btn btn-compact ${avatarStyle === '3d' ? 'btn-primary' : ''}`}
                          onClick={() => setAvatarStyle('3d')}
                        >
                          3D-сфера
                        </button>
                        <button
                          type="button"
                          className="btn btn-compact"
                          onClick={() => {
                            setAvatarSeed(`${profile.username}_${Math.random().toString(36).slice(2, 6)}`);
                            setAvatarPaletteIdx((i) => (i + 1) % 5);
                          }}
                        >
                          🎲 Случайный
                        </button>
                      </div>
                      <button
                        type="button"
                        className="btn btn-compact"
                        disabled={savingCustom}
                        onClick={handleApplyGeneratedAvatar}
                      >
                        ✓ Установить эту аватарку
                      </button>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-compact"
                    onClick={() => setShowCustomizeModal(false)}
                  >
                    Отмена
                  </button>
                  <button type="submit" className="btn btn-primary btn-compact" disabled={savingCustom}>
                    {savingCustom ? 'Сохраняем…' : 'Сохранить'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
      <BottomNav />
    </DesktopShell>
  );
}
