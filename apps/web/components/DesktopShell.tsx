'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useIsDesktop } from '../lib/useIsDesktop';
import { IconRail } from './IconRail';
import { ChatListPanel } from './ChatListPanel';

// useLayoutEffect не нужен на сервере (статический экспорт) — там берём обычный useEffect
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// Позиция прокрутки списка чатов живёт на уровне модуля — переживает любые переходы
let savedListScroll = 0;

const DesktopShellContext = createContext<boolean>(false);

const STANDALONE_PATHS = ['/', '/login', '/register', '/complete-profile', '/banned', '/appeals', '/faq', '/privacy'];

function isStandaloneRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return STANDALONE_PATHS.includes(normalized);
}

/**
 * Постоянная оболочка на уровне RootLayout: удерживает IconRail и ChatListPanel
 * смонтированными при любых кликах между чатами и вкладками без перезагрузки панели.
 */
export function PersistentAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  const listRef = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = savedListScroll;
  }, [isDesktop]);

  if (!isDesktop || isStandaloneRoute(pathname)) {
    return <>{children}</>;
  }

  return (
    <DesktopShellContext.Provider value={true}>
      <div className="desktop-shell">
        <IconRail />
        <div className="desktop-body">
          <div
            className="desktop-list-pane"
            ref={listRef}
            onScroll={(e) => {
              savedListScroll = e.currentTarget.scrollTop;
            }}
          >
            <ChatListPanel />
          </div>
          <div className="desktop-content-pane">{children}</div>
        </div>
      </div>
    </DesktopShellContext.Provider>
  );
}

/**
 * На широких экранах (ПК) показывает горизонтальную панель вкладок сверху,
 * список чатов слева и содержимое страницы справа. Если уже внутри PersistentAppShell —
 * не дублирует оболочку и не пересоздаёт дерево.
 */
export function DesktopShell({ children }: { children: React.ReactNode }) {
  const alreadyInShell = useContext(DesktopShellContext);
  const isDesktop = useIsDesktop();
  const listRef = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = savedListScroll;
  }, [isDesktop]);

  if (alreadyInShell || !isDesktop) return <>{children}</>;

  return (
    <DesktopShellContext.Provider value={true}>
      <div className="desktop-shell">
        <IconRail />
        <div className="desktop-body">
          <div
            className="desktop-list-pane"
            ref={listRef}
            onScroll={(e) => {
              savedListScroll = e.currentTarget.scrollTop;
            }}
          >
            <ChatListPanel />
          </div>
          <div className="desktop-content-pane">{children}</div>
        </div>
      </div>
    </DesktopShellContext.Provider>
  );
}
