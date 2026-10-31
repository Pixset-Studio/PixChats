'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentProfile, hasActiveSession, signOut } from '@pixchats/core';
import type { Profile } from '@pixchats/core';
import { NameWithBadges } from '../../components/NameBadges';
import { BottomNav } from '../../components/BottomNav';
import { DesktopShell } from '../../components/DesktopShell';
import { isBanned } from '../../lib/ban';
import { clearChatListCache } from '../../lib/chatListCache';

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);

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
    })();
  }, [router]);

  if (!profile) return null;

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
              role={profile.role}
              isVerified={profile.is_verified}
              isPixsetEmployee={profile.is_pixset_employee}
            />
          </h2>
          <div className="username">@{profile.username}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            В PixChats с {new Date(profile.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })}
          </div>
        </div>

        <div className="btn-row" style={{ maxWidth: 420, margin: '0 auto', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link href="/settings" className="btn btn-primary" style={{ width: 'auto', flex: '1 1 160px' }}>
            Изменить профиль
          </Link>
          {(profile.role === 'admin' || profile.role === 'developer' || profile.role === 'moderator') && (
            <Link href="/admin" className="btn" style={{ width: 'auto', flex: '1 1 160px' }}>
              ⚙ Панель управления
            </Link>
          )}
          <button
            className="btn"
            style={{ width: 'auto', flex: '1 1 120px' }}
            onClick={async () => {
              clearChatListCache();
              await signOut();
              router.push('/login');
            }}
          >
            Выйти
          </button>
        </div>
      </main>
      <BottomNav />
    </DesktopShell>
  );
}
