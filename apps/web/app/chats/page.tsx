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

export default function ChatsPage() {
  const router = useRouter();
  const isDesktop = useIsDesktop();
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
        localStorage.setItem('pixchats:theme', me.theme);
        document.documentElement.setAttribute('data-theme', me.theme);
      }
      setLoading(false);
    })();
  }, [router]);

  if (loading || !profile) return <p style={{ padding: 24, color: 'var(--text-muted)' }}>Загрузка…</p>;

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
          <span className="brand" style={{ fontSize: 18 }}>
            PixChats<span className="brand-dot" />
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
