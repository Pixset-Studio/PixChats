'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCurrentProfile,
  hasActiveSession,
  updateProfile,
  setTheme as persistTheme,
  updatePrivacySettings,
  getLinkedIdentities,
  linkGoogle,
  linkEmailPassword,
  getSavedPixsetStudioAccount,
  signInWithPixsetStudioAccount,
  unlinkPixsetStudioAccount,
} from '@pixchats/core';
import type { Profile, LinkedIdentity, PixsetStudioAccount, AppTheme } from '@pixchats/core';
import { BottomNav } from '../../components/BottomNav';
import { DesktopShell } from '../../components/DesktopShell';
import { isBanned } from '../../lib/ban';
import { buildAppUrl } from '../../lib/url';
import { PIXSET_THEMES, applyTheme, getCurrentTheme } from '../../components/ThemeManager';
import { triggerManualUpdateCheck } from '../../components/UpdateNotifier';
import { fileToBase64Image } from '../../lib/imageUtils';
import {
  getNotificationPrefs,
  updateNotificationPref,
  type NotificationPreferences,
  DEFAULT_NOTIFICATION_PREFS,
} from '../../lib/notificationPrefs';
import { ensureNotificationPermissionEverywhere, requestPermissionNow } from '../../lib/nativePlatform';
import {
  WALLPAPER_PRESETS,
  getChatAppearance,
  saveChatAppearance,
  DEFAULT_CHAT_APPEARANCE,
  type ChatAppearanceSettings,
  type WallpaperPresetId,
} from '../../lib/chatAppearance';
import {
  getAppLockConfig,
  saveAppLockConfig,
  lockSessionNow,
  DEFAULT_APP_LOCK,
  type AppLockConfig,
} from '../../lib/appLock';
import { get2FAConfig, save2FAConfig, type TwoFactorConfig } from '../../lib/twoFactorAuth';
import { getAutoTranslatePref, setAutoTranslatePref } from '../../lib/translator';
import { isScreenshotGuardEnabled, setScreenshotGuardEnabled } from '../../lib/screenshotGuard';

export default function SettingsPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [username, setUsername] = useState('');
  const [theme, setThemeState] = useState<AppTheme>(() => getCurrentTheme());
  const [whoCanMessage, setWhoCanMessage] = useState<'everyone' | 'friends_only' | 'nobody'>('everyone');
  const [showLastSeen, setShowLastSeen] = useState<'everyone' | 'friends_only' | 'nobody'>('everyone');
  const [whoCanAdd, setWhoCanAdd] = useState<'everyone' | 'friends_only' | 'nobody'>('everyone');
  const [linkedProviders, setLinkedProviders] = useState<string[]>([]);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkPassword, setLinkPassword] = useState('');

  // Pixset Studio account integration
  const [pixsetAccount, setPixsetAccount] = useState<PixsetStudioAccount | null>(null);
  const [showPixsetForm, setShowPixsetForm] = useState(false);
  const [pixsetLogin, setPixsetLogin] = useState('');
  const [pixsetPassword, setPixsetPassword] = useState('');
  const [pixsetLoading, setPixsetLoading] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFS);
  const [desktopAutoStart, setDesktopAutoStart] = useState(true);
  const [appearance, setAppearance] = useState<ChatAppearanceSettings>(DEFAULT_CHAT_APPEARANCE);
  const [appLock, setAppLock] = useState<AppLockConfig>(DEFAULT_APP_LOCK);
  const [pinDraft, setPinDraft] = useState('');
  const [twoFactor, setTwoFactor] = useState<TwoFactorConfig>(get2FAConfig());
  const [twoFactorPassDraft, setTwoFactorPassDraft] = useState('');
  const [twoFactorHintDraft, setTwoFactorHintDraft] = useState('');
  const [autoTranslate, setAutoTranslate] = useState(getAutoTranslatePref());
  const [screenshotGuard, setScreenshotGuard] = useState(isScreenshotGuardEnabled());

  useEffect(() => {
    (async () => {
      const active = await hasActiveSession();
      if (!active) {
        router.push('/login');
        return;
      }
      const me = await getCurrentProfile();
      if (!me) {
        router.push('/complete-profile');
        return;
      }
      if (isBanned(me)) {
        router.push('/banned');
        return;
      }
      setProfile(me);
      setDisplayName(me.display_name);
      setUsername(me.username);
      setBio(me.bio ?? '');
      // Не перезаписываем кастомную тему из устаревшего поля базы
      setThemeState(getCurrentTheme());
      setWhoCanMessage(me.privacy_who_can_message);
      setShowLastSeen(me.privacy_show_last_seen);
      setWhoCanAdd(me.privacy_who_can_add_to_groups);
      try {
        setLinkedProviders((await getLinkedIdentities()).map((i) => i.provider));
      } catch {
        // не критично для остальной страницы
      }
      setPixsetAccount(getSavedPixsetStudioAccount());
      setNotifPrefs(getNotificationPrefs());
      setAppearance(getChatAppearance());
      const lockCfg = getAppLockConfig();
      setAppLock(lockCfg);
      setPinDraft(lockCfg.pinCode || '');
      ensureNotificationPermissionEverywhere();

      try {
        if (typeof window !== 'undefined') {
          if (window.pixchatsDesktop?.getAutoStartEnabled) {
            const enabled = await window.pixchatsDesktop.getAutoStartEnabled();
            setDesktopAutoStart(enabled);
          } else {
            const saved = localStorage.getItem('pixchats:desktop_autostart');
            setDesktopAutoStart(saved === null ? true : saved === '1');
          }
        }
      } catch {}
    })();
  }, [router]);

  function handleToggleNotifPref(key: keyof NotificationPreferences, value: boolean) {
    const next = updateNotificationPref(key, value);
    setNotifPrefs(next);
    if (value) {
      void requestPermissionNow();
    }
  }

  async function handleToggleDesktopAutoStart(enabled: boolean) {
    setDesktopAutoStart(enabled);
    try {
      localStorage.setItem('pixchats:desktop_autostart', enabled ? '1' : '0');
      if (typeof window !== 'undefined' && window.pixchatsDesktop?.setAutoStartEnabled) {
        await window.pixchatsDesktop.setAutoStartEnabled(enabled);
      }
      setNotice(
        enabled
          ? 'Автозапуск и фоновый режим (.exe) включены'
          : 'Автозапуск при старте ПК отключён'
      );
      setTimeout(() => setNotice(null), 1800);
    } catch {}
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setError(null);
    try {
      await updateProfile(profile.id, { displayName, username, bio });
      setNotice('Профиль обновлён');
    } catch (err: any) {
      setError(err.message ?? 'Не удалось сохранить');
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!profile || !e.target.files?.[0]) return;
    setAvatarUploading(true);
    setError(null);
    try {
      // Сжимаем аватар и сохраняем напрямую в base64 без расхода хранилища Supabase
      const base64Data = await fileToBase64Image(e.target.files[0], 256, 0.85);
      await updateProfile(profile.id, { avatarUrl: base64Data });
      setProfile({ ...profile, avatar_url: base64Data });
      setNotice('Аватар обновлён');
    } catch (err: any) {
      setError(err.message ?? 'Не удалось загрузить аватар');
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleThemeChange(newTheme: AppTheme) {
    setThemeState(newTheme);
    applyTheme(newTheme);
    if (profile) {
      persistTheme(profile.id, newTheme).catch(() => {});
    }
    setNotice('Тема обновлена');
    setTimeout(() => setNotice(null), 1500);
  }

  function handleUpdateAppearance(patch: Partial<ChatAppearanceSettings>) {
    const next = saveChatAppearance(patch);
    setAppearance(next);
    setNotice('Внешний вид чата обновлён');
    setTimeout(() => setNotice(null), 1400);
  }

  async function handleCustomWallpaperUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToBase64Image(file, 960, 0.82, { cropSquare: false });
      handleUpdateAppearance({ wallpaper: 'custom', customWallpaperDataUrl: dataUrl });
    } catch {
      setError('Не удалось загрузить фоновое изображение');
    }
  }

  function handleSaveAppLock(e: React.FormEvent) {
    e.preventDefault();
    const cleanPin = pinDraft.trim();
    if (appLock.enabled && cleanPin.length < 4) {
      setError('PIN-код должен содержать минимум 4 символа');
      return;
    }
    setError(null);
    const saved = saveAppLockConfig({
      enabled: appLock.enabled && cleanPin.length >= 4,
      pinCode: cleanPin,
      autoLockMinutes: appLock.autoLockMinutes,
    });
    setAppLock(saved);
    setNotice(
      saved.enabled
        ? '🔐 Защита входа PIN-кодом активирована'
        : '🔓 Защита входа PIN-кодом отключена'
    );
    setTimeout(() => setNotice(null), 1800);
  }

  async function handleLinkProvider(provider: 'google') {
    setError(null);
    try {
      const redirectTo = buildAppUrl('/settings/');
      if (provider === 'google') await linkGoogle(redirectTo);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось привязать Google аккаунт');
    }
  }

  async function handleLinkPixsetStudio(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPixsetLoading(true);
    try {
      const acc = await signInWithPixsetStudioAccount(pixsetLogin, pixsetPassword);
      setPixsetAccount(acc);
      setShowPixsetForm(false);
      setPixsetLogin('');
      setPixsetPassword('');
      setNotice(`Учётная запись Pixset Studio (@${acc.nickname}) успешно привязана!`);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось привязать аккаунт Pixset Studio');
    } finally {
      setPixsetLoading(false);
    }
  }

  function handleUnlinkPixset() {
    unlinkPixsetStudioAccount();
    setPixsetAccount(null);
    setNotice('Учётная запись Pixset Studio отвязана');
  }

  async function handleLinkEmailPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await linkEmailPassword(linkEmail, linkPassword);
      setNotice('Email и пароль привязаны — теперь можно входить и так');
      setLinkedProviders((prev) => [...prev, 'email']);
      setLinkEmail('');
      setLinkPassword('');
    } catch (err: any) {
      setError(err.message ?? 'Не удалось привязать email/пароль');
    }
  }

  async function handleSavePrivacy() {
    if (!profile) return;
    setError(null);
    try {
      await updatePrivacySettings(profile.id, {
        privacy_who_can_message: whoCanMessage,
        privacy_show_last_seen: showLastSeen,
        privacy_who_can_add_to_groups: whoCanAdd,
      });
      setNotice('Настройки приватности сохранены');
    } catch (err: any) {
      setError(err.message ?? 'Не удалось сохранить');
    }
  }

  if (!profile) return null;

  return (
    <DesktopShell>
    <main className="container-wide with-bottom-nav">
      <header className="app-header">
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: 0 }}>Настройки</h1>
        <Link href="/chats/" className="btn btn-ghost" style={{ width: 'auto' }}>
          ← К чатам
        </Link>
      </header>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <div className="section-title">Профиль</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div
            className={`avatar ${!profile.avatar_url ? 'avatar-fallback' : ''}`}
            style={{
              width: 64,
              height: 64,
              fontSize: 24,
              backgroundImage: profile.avatar_url ? `url(${profile.avatar_url})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            {!profile.avatar_url && profile.display_name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <button
              type="button"
              className="btn"
              style={{ width: 'auto' }}
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarUploading}
            >
              {avatarUploading ? 'Загружаем…' : 'Сменить аватар'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleAvatarChange}
            />
          </div>
        </div>

        <form onSubmit={handleSaveProfile}>
          <div className="field">
            <label>Юзернейм</label>
            <div className="input-prefix">
              <span>@</span>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))} />
            </div>
          </div>
          <div className="field">
            <label>Отображаемое имя</label>
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="field">
            <label>О себе</label>
            <textarea
              className="input"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              placeholder="Пара слов о себе…"
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>
            Сохранить
          </button>
        </form>
      </div>

      <div className="section-title">Тема оформления</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 16 }}>
          Выберите цветовую тему интерфейса. Включает фирменную тёмно-жёлтую тему PixChats и стили с официального сайта Pixset Studio:
        </p>
        <div className="theme-picker-grid">
          {PIXSET_THEMES.map((item) => {
            const isSelected = theme === item.id || (theme === 'dark' && item.id === 'pixchats') || (theme === 'byte_blaster' && item.id === 'byteblaster');
            return (
              <button
                key={item.id}
                type="button"
                className={`theme-card ${isSelected ? 'active' : ''}`}
                onClick={() => handleThemeChange(item.id as AppTheme)}
              >
                <div className="theme-preview-dots">
                  <span className="dot-primary" style={{ background: item.accent }} />
                  <span className="dot-bg" style={{ background: item.bg }} />
                  <span className="dot-card" style={{ background: item.surface }} />
                </div>
                <div className="theme-card-name">
                  {item.name}
                  {isSelected && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>✓</span>}
                </div>
                <div className="theme-card-desc">{item.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="section-title">Внешний вид чатов и обои</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>
          Настройте фоновые обои в диалогах, размер шрифта и скругление углов пузырей сообщений:
        </p>

        <div className="theme-picker-grid" style={{ marginBottom: 16 }}>
          {WALLPAPER_PRESETS.map((wp) => {
            const active = appearance.wallpaper === wp.id;
            return (
              <button
                key={wp.id}
                type="button"
                className={`theme-card ${active ? 'active' : ''}`}
                onClick={() => handleUpdateAppearance({ wallpaper: wp.id as WallpaperPresetId })}
              >
                <div
                  style={{
                    height: 36,
                    borderRadius: 8,
                    marginBottom: 8,
                    border: '1px solid var(--border)',
                    background: wp.previewCss,
                    backgroundSize: wp.id === 'starfield' ? '18px 18px' : 'cover',
                  }}
                />
                <div className="theme-card-name">
                  {wp.name}
                  {active && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>✓</span>}
                </div>
                <div className="theme-card-desc">{wp.desc}</div>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <button
            type="button"
            className={`btn ${appearance.wallpaper === 'custom' ? 'btn-primary' : ''}`}
            style={{ width: 'auto' }}
            onClick={() => wallpaperInputRef.current?.click()}
          >
            🖼️ Загрузить свои обои чата (Base64)
          </button>
          <input
            ref={wallpaperInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleCustomWallpaperUpload}
          />
          {appearance.wallpaper === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span>Затемнение фона: {appearance.wallpaperDimming}%</span>
              <input
                type="range"
                min={0}
                max={85}
                value={appearance.wallpaperDimming}
                onChange={(e) => handleUpdateAppearance({ wallpaperDimming: Number(e.target.value) })}
              />
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Размер текста сообщений</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {([13, 14, 16] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  className="btn"
                  style={{
                    flex: 1,
                    borderColor: appearance.fontSize === sz ? 'var(--accent)' : undefined,
                    color: appearance.fontSize === sz ? 'var(--accent)' : undefined,
                  }}
                  onClick={() => handleUpdateAppearance({ fontSize: sz })}
                >
                  {sz === 13 ? 'Компакт (13)' : sz === 14 ? 'Стандарт (14)' : 'Крупный (16)'}
                </button>
              ))}
            </div>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label>Углы пузырей сообщений</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {([8, 14, 20] as const).map((rad) => (
                <button
                  key={rad}
                  type="button"
                  className="btn"
                  style={{
                    flex: 1,
                    borderColor: appearance.bubbleRadius === rad ? 'var(--accent)' : undefined,
                    color: appearance.bubbleRadius === rad ? 'var(--accent)' : undefined,
                  }}
                  onClick={() => handleUpdateAppearance({ bubbleRadius: rad })}
                >
                  {rad === 8 ? 'Строгие' : rad === 14 ? 'Стандарт' : 'Мягкие'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="section-title">Защита входа PIN-кодом (App Lock) и Скрытые чаты</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>
          Установите секретный PIN-код для входа в приложение и автоблокировки экрана. Также этот PIN-код открывает ваши скрытые чаты, если ввести его в строку поиска чатов.
        </p>

        <form onSubmit={handleSaveAppLock}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--bg-secondary)',
              border: `1px solid ${appLock.enabled ? 'var(--accent)' : 'var(--border)'}`,
              marginBottom: 14,
              cursor: 'pointer',
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>🔐 Включить блокировку приложения по PIN-коду</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Запрашивать PIN-код при запуске и после бездействия
              </div>
            </div>
            <input
              type="checkbox"
              checked={appLock.enabled}
              onChange={(e) => setAppLock((prev) => ({ ...prev, enabled: e.target.checked }))}
              style={{ width: 20, height: 20, accentColor: 'var(--accent)' }}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 14 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Секретный PIN-код (4–8 символов)</label>
              <input
                type="password"
                className="input"
                maxLength={8}
                placeholder="Например: 2580"
                value={pinDraft}
                onChange={(e) => setPinDraft(e.target.value)}
              />
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <label>Автоблокировка при бездействии</label>
              <select
                className="input"
                value={appLock.autoLockMinutes}
                onChange={(e) =>
                  setAppLock((prev) => ({
                    ...prev,
                    autoLockMinutes: Number(e.target.value) as 0 | 1 | 5 | 15,
                  }))
                }
              >
                <option value={1}>Через 1 минуту</option>
                <option value={5}>Через 5 минут</option>
                <option value={15}>Через 15 минут</option>
                <option value={0}>Только при перезапуске или по кнопке 🔒</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>
              Сохранить настройки PIN
            </button>
            {appLock.enabled && appLock.pinCode && (
              <button
                type="button"
                className="btn"
                style={{ width: 'auto' }}
                onClick={() => lockSessionNow()}
              >
                🔒 Заблокировать экран сейчас
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="section-title">Уведомления</div>
      <div className="card" style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          Настройте, какие именно уведомления вы хотите получать (разрешение запрашивается автоматически на всех устройствах):
        </p>

        {[
          {
            key: 'enabled' as const,
            title: 'Все уведомления',
            desc: 'Главный переключатель всех системных и внутриприложенческих уведомлений',
          },
          {
            key: 'directMessages' as const,
            title: 'Личные сообщения',
            desc: 'Новые входящие сообщения в личных диалогах',
          },
          {
            key: 'incomingCalls' as const,
            title: 'Входящие звонки',
            desc: 'Звуковой вызов и всплывающее окно при входящем аудио- или видеозвонке',
          },
          {
            key: 'groupMessages' as const,
            title: 'Группы и каналы',
            desc: 'Новые сообщения в групповых чатах и каналах',
          },
          {
            key: 'mentions' as const,
            title: 'Упоминания (@username)',
            desc: 'Уведомлять, когда вас отмечают через @ даже если уведомления групп выключены',
          },
          {
            key: 'friendRequests' as const,
            title: 'Заявки в друзья',
            desc: 'Новые запросы в друзья и уведомления о принятых заявках',
          },
          {
            key: 'chatInvites' as const,
            title: 'Приглашения в чаты',
            desc: 'Когда вас добавляют в новую группу или канал',
          },
          {
            key: 'accountEvents' as const,
            title: 'Статус аккаунта и бейджи',
            desc: 'Изменение роли, получение галочки верификации или бейджа Pixset Studio',
          },
          {
            key: 'sound' as const,
            title: 'Звуковой сигнал',
            desc: 'Проигрывать мелодию при поступлении нового уведомления',
          },
        ].map((item) => {
          const isMaster = item.key === 'enabled';
          const isDisabled = !isMaster && !notifPrefs.enabled;
          const checked = Boolean(notifPrefs[item.key]);

          return (
            <label
              key={item.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                padding: '10px 12px',
                borderRadius: 10,
                background: isMaster ? 'var(--surface-raised)' : 'var(--bg-secondary)',
                border: `1px solid ${checked && !isDisabled ? 'var(--border-accent, var(--border))' : 'var(--border)'}`,
                opacity: isDisabled ? 0.5 : 1,
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{item.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{item.desc}</div>
              </div>
              <input
                type="checkbox"
                checked={checked}
                disabled={isDisabled}
                onChange={(e) => handleToggleNotifPref(item.key, e.target.checked)}
                style={{
                  width: 20,
                  height: 20,
                  accentColor: 'var(--accent)',
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                  flexShrink: 0,
                }}
              />
            </label>
          );
        })}

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: '12px',
            borderRadius: 10,
            background: 'var(--surface-raised)',
            border: `1px solid ${desktopAutoStart ? 'var(--accent)' : 'var(--border)'}`,
            cursor: 'pointer',
            marginTop: 4,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
              🖥️ Автозапуск при старте ПК и фоновый режим (.exe)
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              В версии для Windows (.exe) программа автоматически запускается вместе с компьютером, работает в системном трее в фоне и непрерывно ждёт новых сообщений, звонков и уведомлений.
            </div>
          </div>
          <input
            type="checkbox"
            checked={desktopAutoStart}
            onChange={(e) => handleToggleDesktopAutoStart(e.target.checked)}
            style={{
              width: 20,
              height: 20,
              accentColor: 'var(--accent)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          />
        </label>
      </div>

      <div className="section-title">Учётная запись Pixset Studio</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
          Интеграция с единым порталом Pixset Studio (pixset-studio.github.io). Привязка аккаунта подтверждает статус разработчика/сотрудника и синхронизирует профиль.
        </p>

        {pixsetAccount ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                className="avatar"
                style={{
                  width: 44,
                  height: 44,
                  backgroundImage: pixsetAccount.avatar_url ? `url(${pixsetAccount.avatar_url})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                {!pixsetAccount.avatar_url && pixsetAccount.nickname.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  @{pixsetAccount.nickname}
                  {pixsetAccount.is_admin && (
                    <span style={{ fontSize: 11, background: 'var(--accent)', color: '#000', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
                      Сотрудник Pixset
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {pixsetAccount.email || 'Аккаунт студии подключён'}
                </div>
              </div>
            </div>

            <button className="btn" style={{ width: 'auto', color: 'var(--danger)' }} onClick={handleUnlinkPixset}>
              Отвязать
            </button>
          </div>
        ) : (
          <div>
            {!showPixsetForm ? (
              <button
                className="btn btn-primary"
                style={{ width: 'auto' }}
                onClick={() => setShowPixsetForm(true)}
              >
                ⚡ Привязать аккаунт Pixset Studio
              </button>
            ) : (
              <form onSubmit={handleLinkPixsetStudio} style={{ marginTop: 12 }}>
                <div className="field">
                  <label>Никнейм или Email Pixset Studio</label>
                  <input
                    className="input"
                    value={pixsetLogin}
                    onChange={(e) => setPixsetLogin(e.target.value)}
                    placeholder="никнейм или email"
                    required
                  />
                </div>
                <div className="field">
                  <label>Пароль</label>
                  <input
                    className="input"
                    type="password"
                    value={pixsetPassword}
                    onChange={(e) => setPixsetPassword(e.target.value)}
                    required
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={pixsetLoading}>
                    {pixsetLoading ? 'Проверяем…' : 'Подтвердить привязку'}
                  </button>
                  <button type="button" className="btn" style={{ width: 'auto' }} onClick={() => setShowPixsetForm(false)}>
                    Отмена
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      <div className="section-title">Способы входа</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
          Привяжите дополнительный способ входа — пригодится, если забудете пароль или потеряете доступ к одному из аккаунтов.
        </p>
        <div className="btn-row" style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 }}>
          <button className="btn" onClick={() => handleLinkProvider('google')} disabled={linkedProviders.includes('google')}>
            {linkedProviders.includes('google') ? '✓ Google привязан' : 'Привязать Google'}
          </button>
        </div>

        {!linkedProviders.includes('email') && (
          <form onSubmit={handleLinkEmailPassword}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Привязать вход по email и паролю:</p>
            <div className="field">
              <label>Email</label>
              <input className="input" type="email" value={linkEmail} onChange={(e) => setLinkEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label>Пароль</label>
              <input
                className="input"
                type="password"
                value={linkPassword}
                onChange={(e) => setLinkPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <button type="submit" className="btn" style={{ width: 'auto' }}>
              Привязать email
            </button>
          </form>
        )}
      </div>

      <div className="section-title">Приватность</div>
      <div className="card">
        <div className="field">
          <label>Кто может писать мне первым</label>
          <select
            className="input"
            value={whoCanMessage}
            onChange={(e) => setWhoCanMessage(e.target.value as any)}
          >
            <option value="everyone">Все</option>
            <option value="friends_only">Только друзья</option>
            <option value="nobody">Никто (даже друзья)</option>
          </select>
        </div>

        <div className="field">
          <label>Кто видит моё время последнего захода</label>
          <select
            className="input"
            value={showLastSeen}
            onChange={(e) => setShowLastSeen(e.target.value as any)}
          >
            <option value="everyone">Всем</option>
            <option value="friends_only">Друзьям</option>
            <option value="nobody">Некому</option>
          </select>
        </div>

        <div className="field">
          <label>Кто может добавлять меня в группы и каналы</label>
          <select
            className="input"
            value={whoCanAdd}
            onChange={(e) => setWhoCanAdd(e.target.value as any)}
          >
            <option value="everyone">Все</option>
            <option value="friends_only">Только друзья</option>
            <option value="nobody">Никто</option>
          </select>
        </div>

        <button className="btn btn-primary" style={{ width: 'auto' }} onClick={handleSavePrivacy}>
          Сохранить приватность
        </button>
      </div>

      <div className="section-title">🔐 Двухфакторная аутентификация (2FA / Облачный пароль)</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
          Защитите свой аккаунт дополнительным облачным паролем при входе с новых устройств.
        </p>

        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, cursor: 'pointer' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Включить облачный пароль (2FA)</span>
          <input
            type="checkbox"
            checked={twoFactor.enabled}
            onChange={(e) => {
              const enabled = e.target.checked;
              const next = { ...twoFactor, enabled };
              setTwoFactor(next);
              save2FAConfig(next);
              setNotice(enabled ? 'Двухфакторная защита включена 🔐' : 'Двухфакторная защита отключена');
              setTimeout(() => setNotice(null), 1500);
            }}
            style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
          />
        </label>

        {twoFactor.enabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="field">
              <label>Облачный пароль 2FA</label>
              <input
                type="password"
                className="input"
                value={twoFactorPassDraft}
                onChange={(e) => setTwoFactorPassDraft(e.target.value)}
                placeholder="Введите 2FA пароль…"
              />
            </div>
            <div className="field">
              <label>Подсказка к паролю</label>
              <input
                type="text"
                className="input"
                value={twoFactorHintDraft}
                onChange={(e) => setTwoFactorHintDraft(e.target.value)}
                placeholder="Подсказка (не обязательна)…"
              />
            </div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: 'auto' }}
              onClick={() => {
                if (!twoFactorPassDraft.trim()) {
                  setError('Пароль 2FA не может быть пустым');
                  setTimeout(() => setError(null), 2000);
                  return;
                }
                const next: TwoFactorConfig = {
                  enabled: true,
                  passwordHash: twoFactorPassDraft.trim(),
                  hint: twoFactorHintDraft.trim(),
                  recoveryCode: `REC-${Date.now().toString(36).toUpperCase()}`,
                  updatedAt: new Date().toISOString(),
                };
                setTwoFactor(next);
                save2FAConfig(next);
                setTwoFactorPassDraft('');
                setNotice('Облачный 2FA пароль успешно сохранён!');
                setTimeout(() => setNotice(null), 1800);
              }}
            >
              Сохранить облачный пароль
            </button>
          </div>
        )}
      </div>

      <div className="section-title">🌐 Автопереводчик сообщений</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Автоматический перевод входящих сообщений</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Показывать кнопку и плашку автоперевода для сообщений
            </div>
          </div>
          <input
            type="checkbox"
            checked={autoTranslate}
            onChange={(e) => {
              const enabled = e.target.checked;
              setAutoTranslate(enabled);
              setAutoTranslatePref(enabled);
              setNotice(enabled ? 'Автопереводчик включён 🌐' : 'Автопереводчик отключён');
              setTimeout(() => setNotice(null), 1500);
            }}
            style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
          />
        </label>
      </div>
      <div className="section-title">🛡️ Защита от скриншотов и сохранения</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Защита контента и сохранений</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Запрещает выделение текста, сохранение фото/видео по правому клику и перетаскивание файлов из чатов
            </div>
          </div>
          <input
            type="checkbox"
            checked={screenshotGuard}
            onChange={(e) => {
              const enabled = e.target.checked;
              setScreenshotGuard(enabled);
              setScreenshotGuardEnabled(enabled);
              setNotice(enabled ? 'Защита от скриншотов и сохранения включена 🛡️' : 'Защита от скриншотов отключена');
              setTimeout(() => setNotice(null), 1500);
            }}
            style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
          />
        </label>
      </div>

      <div className="section-title">🔄 Обновления и справка</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 12 }}>
          Нативные клиенты Windows (.exe) и Android (.apk) автоматически проверяют выход новой версии в релизе <strong>«Lastest Version»</strong> и предлагают обновиться.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary btn-compact"
            onClick={() => {
              triggerManualUpdateCheck();
              setNotice('Запущена проверка обновлений Lastest Version…');
              setTimeout(() => setNotice(null), 2000);
            }}
          >
            🔄 Проверить обновления
          </button>
          <Link href="/faq" className="btn btn-compact" style={{ textDecoration: 'none' }}>
            ❓ Вопросы и ответы (FAQ)
          </Link>
        </div>
      </div>
    </main>
    <BottomNav />
    </DesktopShell>
  );
}
