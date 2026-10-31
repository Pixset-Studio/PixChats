'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChatsIcon, FriendsIcon, SettingsIcon, ProfileIcon } from './Icons';

export function IconRail() {
  const pathname = usePathname();

  const items = [
    { href: '/chats/', icon: <ChatsIcon size={18} />, title: 'Чаты' },
    { href: '/friends/', icon: <FriendsIcon size={18} />, title: 'Друзья' },
    { href: '/settings/', icon: <SettingsIcon size={18} />, title: 'Настройки' },
    { href: '/profile/', icon: <ProfileIcon size={18} />, title: 'Профиль' },
  ];

  return (
    <nav className="icon-rail" aria-label="Основная навигация">
      <Link href="/chats/" className="icon-rail-logo-wrap" title="PixChats" style={{ textDecoration: 'none' }}>
        <img
          src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/logo/icon.png`}
          alt="PixChats Logo"
          className="icon-rail-logo-img"
        />
        <span className="icon-rail-brand">PixChats</span>
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
              {item.icon}
              <span className="icon-rail-label">{item.title}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
