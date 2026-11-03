'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getCachedCurrentProfile, getCurrentProfile } from '@pixchats/core';
import { useConnectionStatus } from '../lib/useConnectionStatus';
import { ChatsIcon, FriendsIcon, SettingsIcon, ProfileIcon, AdminPanelIcon, AiAssistantIcon } from './Icons';
import { detectRuntimePlatform } from '../lib/nativePlatform';
import { openDownloadAppModal } from './DownloadAppModal';
import { getUserPremiumStatus, syncPremiumManifestFromCloud } from '../lib/premiumAndFeatures';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.2.0';

export function IconRail() {
  const pathname = usePathname();
  const connStatus = useConnectionStatus();
  const [isWebBrowser, setIsWebBrowser] = useState(false);
  const [isPremium, setIsPremium] = useState(() => {
    const cached = getCachedCurrentProfile();
    return cached ? getUserPremiumStatus(cached.id, cached.username).active : false;
  });
  const [isStaff, setIsStaff] = useState(() => {
    const cached = getCachedCurrentProfile();
    return Boolean(
      cached && (cached.role === 'admin' || cached.role === 'moderator' || cached.role === 'developer')
    );
  });
  const [isDeveloper, setIsDeveloper] = useState(() => {
    const cached = getCachedCurrentProfile();
    return Boolean(cached && cached.role === 'developer');
  });

  useEffect(() => {
    setIsWebBrowser(detectRuntimePlatform() === 'web');

    const checkRoleAndPremium = (p: any) => {
      if (!p) return;
      setIsStaff(p.role === 'admin' || p.role === 'moderator' || p.role === 'developer');
      setIsDeveloper(p.role === 'developer');
      setIsPremium(getUserPremiumStatus(p.id, p.username).active);
    };

    const cached = getCachedCurrentProfile();
    if (cached) {
      checkRoleAndPremium(cached);
    } else {
      void getCurrentProfile().then(checkRoleAndPremium).catch(() => {});
    }

    void syncPremiumManifestFromCloud(false).then(() => {
      const me = getCachedCurrentProfile();
      if (me) setIsPremium(getUserPremiumStatus(me.id, me.username).active);
    });

    const onProfileUpdated = (e: Event) => {
      const custom = e as CustomEvent;
      if (custom.detail) checkRoleAndPremium(custom.detail);
    };
    const onPremiumUpdated = () => {
      const me = getCachedCurrentProfile();
      if (me) setIsPremium(getUserPremiumStatus(me.id, me.username).active);
    };
    window.addEventListener('pixchats:profile_updated', onProfileUpdated);
    window.addEventListener('pixchats:premium_updated', onPremiumUpdated);
    return () => {
      window.removeEventListener('pixchats:profile_updated', onProfileUpdated);
      window.removeEventListener('pixchats:premium_updated', onPremiumUpdated);
    };
  }, []);

  const items = [
    { href: '/chats/', icon: <ChatsIcon size={18} />, title: 'Чаты' },
    { href: '/friends/', icon: <FriendsIcon size={18} />, title: 'Друзья' },
    { href: '/settings/', icon: <SettingsIcon size={18} />, title: 'Настройки' },
    { href: '/profile/', icon: <ProfileIcon size={18} />, title: 'Профиль' },
    ...(isStaff
      ? [{ href: '/admin/', icon: <AdminPanelIcon size={18} />, title: 'Панель администратора' }]
      : []),
    ...(isDeveloper
      ? [{ href: '/ai-assistant/', icon: <AiAssistantIcon size={18} />, title: 'AI ассистент' }]
      : []),
  ];

  return (
    <nav className="icon-rail" aria-label="Основная навигация">
      <Link href="/chats/" className="icon-rail-logo-wrap" title="PixChats">
        <img
          src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/logo/icon.png`}
          alt="PixChats Logo"
          style={{ width: 38, height: 38, objectFit: 'contain' }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="icon-rail-brand" style={{ fontSize: 18 }}>PixChats</span>
            {isPremium && (
              <span className="premium-shimmer-badge" title="У вас активен статус PixChats Premium">
                ★ Premium
              </span>
            )}
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 500,
                color: 'var(--text-muted)',
                opacity: 0.36,
                letterSpacing: '0.02em',
                userSelect: 'none',
              }}
              title={`Текущая версия v${APP_VERSION}`}
            >
              v{APP_VERSION}
            </span>
          </div>
          {connStatus === 'offline' && (
            <span style={{ fontSize: 10, color: 'var(--danger)', fontWeight: 600 }}>Ожидание сети…</span>
          )}
          {connStatus === 'connecting' && (
            <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>Соединение…</span>
          )}
        </div>
      </Link>
      <div className="icon-rail-tabs">
        {items.map((item) => {
          const active =
            pathname === item.href ||
            pathname === item.href.replace(/\/$/, '') ||
            (item.href === '/chats/' && pathname?.startsWith('/chat')) ||
            (item.href === '/admin/' && pathname?.startsWith('/admin')) ||
            (item.href === '/ai-assistant/' && pathname?.startsWith('/ai-assistant'));
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.title}
              className={`icon-rail-item ${active ? 'active' : ''}`}
            >
              <span className="icon-rail-icon">{item.icon}</span>
              <span className="icon-rail-label">{item.title}</span>
            </Link>
          );
        })}

        {isWebBrowser && (
          <button
            type="button"
            className="icon-rail-item"
            title="Скачать приложение PixChats для Windows (.exe) или Android (.apk)"
            onClick={() => openDownloadAppModal()}
            style={{
              background: 'transparent',
              border: '1px dashed rgba(255, 212, 0, 0.35)',
              cursor: 'pointer',
              color: 'var(--accent)',
            }}
          >
            <span className="icon-rail-icon" style={{ fontSize: 15, lineHeight: 1 }}>⬇️</span>
            <span className="icon-rail-label">Скачать</span>
          </button>
        )}
      </div>
    </nav>
  );
}
