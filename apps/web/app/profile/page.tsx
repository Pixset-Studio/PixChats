'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentProfile, hasActiveSession, signOut } from '@pixchats/core';
import type { Profile } from '@pixchats/core';
import { NameBadges } from '../../components/NameBadges';
import { BottomNav } from '../../components/BottomNav';

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
      setProfile(me);
    })();
  }, [router]);

  if (!profile) return null;

  return (
    <>
      <main className="container-wide with-bottom-nav">
        <div className="profile-hero">
          <div
            className="avatar"
            style={{
              backgroundImage: profile.avatar_url ? `url(${profile.avatar_url})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            {!profile.avatar_url && profile.display_name.slice(0, 1).toUpperCase()}
          </div>
          <h2>
            {profile.display_name}
            <NameBadges role={profile.role} isVerified={profile.is_verified} />
          </h2>
          <div className="username">@{profile.username}</div>
        </div>

        <div className="btn-row" style={{ maxWidth: 320, margin: '0 auto' }}>
          <Link href="/settings" className="btn btn-primary">
            Изменить профиль
          </Link>
          {(profile.role === 'admin' || profile.role === 'developer' || profile.role === 'moderator') && (
            <Link href="/admin" className="btn">
              ⚙ Панель управления
            </Link>
          )}
          <button
            className="btn"
            onClick={async () => {
              await signOut();
              router.push('/login');
            }}
          >
            Выйти
          </button>
        </div>
      </main>
      <BottomNav />
    </>
  );
}
