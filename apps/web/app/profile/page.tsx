'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentProfile, hasActiveSession, signOut } from '@pixchats/core';
import type { Profile } from '@pixchats/core';
import { NameWithBadges } from '../../components/NameBadges';
import { BottomNav } from '../../components/BottomNav';
import { isBanned } from '../../lib/ban';

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
            <NameWithBadges
              name={profile.display_name}
              role={profile.role}
              isVerified={profile.is_verified}
              isPixsetEmployee={profile.is_pixset_employee}
            />
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
