'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCurrentProfile,
  hasActiveSession,
  updateProfile,
  uploadAvatar,
  setTheme as persistTheme,
  updatePrivacySettings,
  getLinkedIdentities,
  linkGoogle,
  linkVK,
  linkYandex,
  linkEmailPassword,
} from '@pixchats/core';
import type { Profile, LinkedIdentity } from '@pixchats/core';
import { BottomNav } from '../../components/BottomNav';
import { isBanned } from '../../lib/ban';
import { buildAppUrl } from '../../lib/url';

export default function SettingsPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [username, setUsername] = useState('');
  const [theme, setThemeState] = useState<'dark' | 'light'>('dark');
  const [whoCanMessage, setWhoCanMessage] = useState<'everyone' | 'friends_only' | 'nobody'>('everyone');
  const [showLastSeen, setShowLastSeen] = useState<'everyone' | 'friends_only' | 'nobody'>('everyone');
  const [whoCanAdd, setWhoCanAdd] = useState<'everyone' | 'friends_only' | 'nobody'>('everyone');
  const [linkedProviders, setLinkedProviders] = useState<string[]>([]);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkPassword, setLinkPassword] = useState('');

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
      setThemeState(me.theme);
      setWhoCanMessage(me.privacy_who_can_message);
      setShowLastSeen(me.privacy_show_last_seen);
      setWhoCanAdd(me.privacy_who_can_add_to_groups);
      try {
        setLinkedProviders((await getLinkedIdentities()).map((i) => i.provider));
      } catch {
        // не критично для остальной страницы
      }
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
      const url = await uploadAvatar(profile.id, e.target.files[0]);
      setProfile({ ...profile, avatar_url: url });
      setNotice('Аватар обновлён');
    } catch (err: any) {
      setError(err.message ?? 'Не удалось загрузить аватар');
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleThemeChange(newTheme: 'dark' | 'light') {
    if (!profile) return;
    setThemeState(newTheme);
    await persistTheme(profile.id, newTheme);
  }

  async function handleLinkProvider(provider: 'google' | 'vk' | 'yandex') {
    setError(null);
    try {
      const redirectTo = buildAppUrl('/settings/');
      if (provider === 'google') await linkGoogle(redirectTo);
      if (provider === 'vk') await linkVK(redirectTo);
      if (provider === 'yandex') await linkYandex(redirectTo);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось привязать — включите Manual Linking в настройках Supabase Auth');
    }
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
    <>
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

      <div className="section-title">Тема</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="btn-row" style={{ flexDirection: 'row' }}>
          <button
            className="btn"
            style={{ borderColor: theme === 'dark' ? 'var(--accent)' : undefined }}
            onClick={() => handleThemeChange('dark')}
          >
            🌙 Тёмная
          </button>
          <button
            className="btn"
            style={{ borderColor: theme === 'light' ? 'var(--accent)' : undefined }}
            onClick={() => handleThemeChange('light')}
          >
            ☀ Светлая
          </button>
        </div>
      </div>

      <div className="section-title">Способы входа</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
          Привяжите ещё один способ входа — пригодится, если забудете пароль или потеряете доступ к одному из аккаунтов.
        </p>
        <div className="btn-row" style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 }}>
          <button className="btn" onClick={() => handleLinkProvider('google')} disabled={linkedProviders.includes('google')}>
            {linkedProviders.includes('google') ? '✓ Google привязан' : 'Привязать Google'}
          </button>
          <button className="btn" onClick={() => handleLinkProvider('vk')} disabled={linkedProviders.includes('vk')}>
            {linkedProviders.includes('vk') ? '✓ VK привязан' : 'Привязать VK'}
          </button>
          <button className="btn" onClick={() => handleLinkProvider('yandex')} disabled={linkedProviders.includes('yandex')}>
            {linkedProviders.includes('yandex') ? '✓ Яндекс привязан' : 'Привязать Яндекс'}
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
    </>
  );
}
