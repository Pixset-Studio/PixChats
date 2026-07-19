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
} from '@pixchats/core';
import type { Profile } from '@pixchats/core';
import { BottomNav } from '../../components/BottomNav';
import { isBanned } from '../../lib/ban';

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

  async function handleSavePrivacy() {
    if (!profile) return;
    setError(null);
    try {
      await updatePrivacySettings(profile.id, {
        privacy_who_can_message: whoCanMessage,
        privacy_show_last_seen: showLastSeen,
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

        <button className="btn btn-primary" style={{ width: 'auto' }} onClick={handleSavePrivacy}>
          Сохранить приватность
        </button>
      </div>
    </main>
    <BottomNav />
    </>
  );
}
