'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/chats/', icon: '💬', title: 'Чаты' },
  { href: '/friends/', icon: '👤', title: 'Друзья' },
  { href: '/settings/', icon: '⚙', title: 'Настройки' },
  { href: '/profile/', icon: '◆', title: 'Профиль' },
];

export function IconRail() {
  const pathname = usePathname();

  return (
    <nav className="icon-rail">
      <div className="icon-rail-logo">P</div>
      {ITEMS.map((item) => {
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
