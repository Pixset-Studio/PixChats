'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/chats/', label: 'Чаты', icon: '💬' },
  { href: '/friends/', label: 'Контакты', icon: '👤' },
  { href: '/settings/', label: 'Настройки', icon: '⚙' },
  { href: '/profile/', label: 'Профиль', icon: '◆' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname === tab.href.replace(/\/$/, '');
        return (
          <Link key={tab.href} href={tab.href} className={`bottom-nav-item ${active ? 'active' : ''}`}>
            <span className="bottom-nav-icon">{tab.icon}</span>
            <span className="bottom-nav-label">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
