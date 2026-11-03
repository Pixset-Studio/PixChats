'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChatsIcon, FriendsIcon, SettingsIcon, ProfileIcon } from './Icons';
import { useIsDesktop } from '../lib/useIsDesktop';
import { detectRuntimePlatform } from '../lib/nativePlatform';
import { openDownloadAppModal } from './DownloadAppModal';

export function BottomNav() {
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  const [isWebBrowser, setIsWebBrowser] = useState(false);

  useEffect(() => {
    setIsWebBrowser(detectRuntimePlatform() === 'web');
  }, []);

  // На ПК уже есть верхняя горизонтальная панель навигации в DesktopShell
  if (isDesktop) return null;

  // На телефонах Панель администратора и AI ассистент находятся внутри раздела «Настройки»
  const tabs = [
    { href: '/chats/', label: 'Чаты', icon: <ChatsIcon size={20} /> },
    { href: '/friends/', label: 'Друзья', icon: <FriendsIcon size={20} /> },
    { href: '/settings/', label: 'Настройки', icon: <SettingsIcon size={20} /> },
    { href: '/profile/', label: 'Профиль', icon: <ProfileIcon size={20} /> },
  ];

  return (
    <nav className="bottom-nav">
      {tabs.map((tab) => {
        const active =
          pathname === tab.href ||
          pathname === tab.href.replace(/\/$/, '') ||
          (tab.href === '/settings/' &&
            (pathname?.startsWith('/admin') || pathname?.startsWith('/ai-assistant')));
        return (
          <Link key={tab.href} href={tab.href} className={`bottom-nav-item ${active ? 'active' : ''}`}>
            <span className="bottom-nav-icon">{tab.icon}</span>
            <span className="bottom-nav-label">{tab.label}</span>
          </Link>
        );
      })}
      {isWebBrowser && (
        <button
          type="button"
          className="bottom-nav-item"
          onClick={() => openDownloadAppModal()}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--accent)',
          }}
        >
          <span className="bottom-nav-icon" style={{ fontSize: 18, lineHeight: 1 }}>📲</span>
          <span className="bottom-nav-label">Скачать</span>
        </button>
      )}
    </nav>
  );
}
