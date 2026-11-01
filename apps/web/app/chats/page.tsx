'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentProfile, hasActiveSession, ensureKeyBundle } from '@pixchats/core';
import type { Profile } from '@pixchats/core';
import { BottomNav } from '../../components/BottomNav';
import { DesktopShell } from '../../components/DesktopShell';
import { ChatListPanel } from '../../components/ChatListPanel';
import { useIsDesktop } from '../../lib/useIsDesktop';
import { isBanned } from '../../lib/ban';
import { Loading } from '../../components/Loading';

import { useConnectionStatus } from '../../lib/useConnectionStatus';

export default function ChatsPage() {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const connStatus = useConnectionStatus();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

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
      await ensureKeyBundle(me);
      if (typeof window !== 'undefined') {
        const currentSaved = localStorage.getItem('pixchats:theme');
        if (!currentSaved || currentSaved === 'dark') {
          const initialTheme = me.theme && me.theme !== 'dark' ? me.theme : 'pixchats';
          localStorage.setItem('pixchats:theme', initialTheme);
          document.documentElement.setAttribute('data-theme', initialTheme);
        } else {
          document.documentElement.setAttribute('data-theme', currentSaved);
        }
      }
      setLoading(false);
    })();
  }, [router]);

  if (loading || !profile) return <Loading />;

  // На ПК список чатов уже показан слева в DesktopShell — здесь просто заглушка справа.
  if (isDesktop) {
    return (
      <DesktopShell>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
          Выберите чат слева, чтобы начать общение
        </div>
      </DesktopShell>
    );
  }

  return (
    <>
      <main className="container-wide with-bottom-nav">
        <header className="app-header">
          <span className="brand" style={{ fontSize: 20, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <img src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/logo/icon.png`} alt="" width={36} height={36} style={{ objectFit: 'contain' }} />
            <span>PixChats</span>
            {connStatus === 'offline' && (
              <span style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600, marginLeft: 4 }}>
                Ожидание сети…
              </span>
            )}
            {connStatus === 'connecting' && (
              <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, marginLeft: 4 }}>
                Соединение…
              </span>
            )}
          </span>
        </header>

        {profile.frozen && (
          <div className="frozen-banner">❄️ Ваш аккаунт заморожен — доступно только чтение сообщений</div>
        )}

        <ChatListPanel />
      </main>
      <BottomNav />
    </>
  );
}
