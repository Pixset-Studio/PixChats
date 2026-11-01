'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useConnectionStatus } from '../lib/useConnectionStatus';
import { ChatsIcon, FriendsIcon, SettingsIcon, ProfileIcon } from './Icons';
import { detectRuntimePlatform } from '../lib/nativePlatform';
import { openDownloadAppModal } from './DownloadAppModal';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.2.0';

export function IconRail() {
  const pathname = usePathname();
  const connStatus = useConnectionStatus();
  const [isWebBrowser, setIsWebBrowser] = useState(false);

  useEffect(() => {
    setIsWebBrowser(detectRuntimePlatform() === 'web');
  }, []);

  const items = [
    { href: '/chats/', icon: <ChatsIcon size={18} />, title: 'Чаты' },
    { href: '/friends/', icon: <FriendsIcon size={18} />, title: 'Друзья' },
    { href: '/settings/', icon: <SettingsIcon size={18} />, title: 'Настройки' },
    { href: '/profile/', icon: <ProfileIcon size={18} />, title: 'Профиль' },
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
          <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
            <span className="icon-rail-brand" style={{ fontSize: 18 }}>PixChats</span>
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
            (item.href === '/chats/' && pathname?.startsWith('/chat'));
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

