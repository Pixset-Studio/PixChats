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
import { fileToBase64Image } from '../../lib/imageUtils';

export default function SettingsPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    })();
  }, [router]);

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
            className="avatar"
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

      <div className="section-title">Push-уведомления</div>
      <div className="card" style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Системные уведомления браузера</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
            Статус:{' '}
            <strong style={{ color: 'var(--accent)' }}>
              {typeof window !== 'undefined' && 'Notification' in window
                ? Notification.permission === 'granted'
                  ? '✓ Разрешены'
                  : Notification.permission === 'denied'
                    ? '✕ Заблокированы в настройках браузера'
                    : 'Ожидает подтверждения'
                : 'Не поддерживается'}
            </strong>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: 'auto' }}
          onClick={async () => {
            if (typeof window === 'undefined' || !('Notification' in window)) return;
            try {
              const res = await Notification.requestPermission();
              if (res === 'granted') {
                setNotice('Push-уведомления успешно включены!');
                new Notification('PixChats', {
                  body: 'Системные Push-уведомления активны!',
                  icon: `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/logo/icon.png`,
                });
              } else {
                setError('Доступ к уведомлениям не предоставлен браузером');
              }
            } catch {
              setError('Не удалось запросить доступ к уведомлениям');
            }
          }}
        >
          🔔 Запросить доступ к уведомлениям
        </button>
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
    </main>
    <BottomNav />
    </DesktopShell>
  );
}
