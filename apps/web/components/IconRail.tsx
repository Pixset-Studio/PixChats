'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useConnectionStatus } from '../lib/useConnectionStatus';
import { ChatsIcon, FriendsIcon, SettingsIcon, ProfileIcon } from './Icons';

export function IconRail() {
  const pathname = usePathname();
  const connStatus = useConnectionStatus();

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
          <span className="icon-rail-brand" style={{ fontSize: 18 }}>PixChats</span>
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
      </div>
    </nav>
  );
}

