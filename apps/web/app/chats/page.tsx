'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentProfile, getCachedCurrentProfile, hasActiveSession, ensureKeyBundle } from '@pixchats/core';
import type { Profile } from '@pixchats/core';
import { BottomNav } from '../../components/BottomNav';
import { DesktopShell } from '../../components/DesktopShell';
import { ChatListPanel } from '../../components/ChatListPanel';
import { useIsDesktop } from '../../lib/useIsDesktop';
import { isBanned } from '../../lib/ban';
import { Loading } from '../../components/Loading';
import { getChatListCache } from '../../lib/chatListCache';

import { useConnectionStatus } from '../../lib/useConnectionStatus';
import { detectRuntimePlatform } from '../../lib/nativePlatform';
import { openDownloadAppModal } from '../../components/DownloadAppModal';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.2.0';

export default function ChatsPage() {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const connStatus = useConnectionStatus();
  const initialProfile = getCachedCurrentProfile() ?? getChatListCache()?.profile ?? null;
  const [profile, setProfile] = useState<Profile | null>(initialProfile);
  const [loading, setLoading] = useState(!initialProfile);
  const [isWebBrowser, setIsWebBrowser] = useState(false);

  useEffect(() => {
    setIsWebBrowser(detectRuntimePlatform() === 'web');
    (async () => {
      const active = await hasActiveSession();
      if (!active) {
        router.push('/login/');
        return;
      }
      const me = await getCurrentProfile();
      if (!me) {
        router.push('/complete-profile/');
        return;
      }
      if (isBanned(me)) {
        router.push('/banned/');
        return;
      }
      setProfile(me);
      setLoading(false);
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
    })();
  }, [router]);

  // На ПК список чатов уже показан слева в PersistentAppShell — здесь просто заглушка справа без мигания.
  if (isDesktop) {
    return (
      <DesktopShell>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
          Выберите чат слева, чтобы начать общение
        </div>
      </DesktopShell>
    );
  }

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
        <header className="app-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span className="brand" style={{ fontSize: 20, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <img src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/logo/icon.png`} alt="" width={34} height={34} style={{ objectFit: 'contain' }} />
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
              <span>PixChats</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: 'var(--text-muted)',
                  opacity: 0.36,
                  letterSpacing: '0.02em',
                  userSelect: 'none',
                }}
              >
                v{APP_VERSION}
              </span>
            </span>
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

          {isWebBrowser && (
            <button
              type="button"
              className="btn btn-compact"
              onClick={() => openDownloadAppModal()}
              style={{
                width: 'auto',
                padding: '5px 10px',
                fontSize: 11.5,
                fontWeight: 700,
                borderColor: 'rgba(255, 212, 0, 0.45)',
                color: 'var(--accent)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
              title="Скачать приложение PixChats (.apk / .exe)"
            >
              <span>📲</span>
              <span>Скачать</span>
            </button>
          )}
        </header>

        {profile.frozen && (
          <div
            className="frozen-banner"
            style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
          >
            <div>
              <div>❄️ Ваш аккаунт заморожен — доступно только чтение сообщений</div>
              {profile.frozen_reason && (
                <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>Причина: {profile.frozen_reason}</div>
              )}
              {profile.moderator_comment && (
                <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 2 }}>
                  💬 Комментарий модератора: {profile.moderator_comment}
                </div>
              )}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: 'auto', padding: '4px 10px', fontSize: 11.5 }}
              onClick={() => router.push('/appeals/')}
            >
              ⚖️ Обжаловать
            </button>
          </div>
        )}

        <ChatListPanel />
      </main>
      <BottomNav />
    </>
  );
}
