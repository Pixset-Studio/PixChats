'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChatsIcon, FriendsIcon, SettingsIcon, ProfileIcon } from './Icons';

export function IconRail() {
  const pathname = usePathname();

  const items = [
    { href: '/chats/', icon: <ChatsIcon size={22} />, title: 'Чаты' },
    { href: '/friends/', icon: <FriendsIcon size={22} />, title: 'Друзья' },
    { href: '/settings/', icon: <SettingsIcon size={22} />, title: 'Настройки' },
    { href: '/profile/', icon: <ProfileIcon size={22} />, title: 'Профиль' },
  ];

  return (
    <nav className="icon-rail">
      <div className="icon-rail-logo-wrap" title="PixChats">
        <img
          src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/logo/icon.png`}
          alt="PixChats Logo"
          className="icon-rail-logo-img"
        />
      </div>
      {items.map((item) => {
        const active = pathname === item.href || pathname === item.href.replace(/\/$/, '');
        return (
          <Link key={item.href} href={item.href} title={item.title} className={`icon-rail-item ${active ? 'active' : ''}`}>
            {item.icon}
          </Link>
        );
      })}
    </nav>
  );
}
