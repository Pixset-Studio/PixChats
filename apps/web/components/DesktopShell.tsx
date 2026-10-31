'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useIsDesktop } from '../lib/useIsDesktop';
import { IconRail } from './IconRail';
import { ChatListPanel } from './ChatListPanel';

// useLayoutEffect не нужен на сервере (статический экспорт) — там берём обычный useEffect
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// Позиция прокрутки списка чатов живёт на уровне модуля — переживает пересоздание панели при переходах
let savedListScroll = 0;

/**
 * На широких экранах (ПК) показывает горизонтальную панель вкладок сверху,
 * список чатов слева и содержимое страницы справа.
 */
export function DesktopShell({ children }: { children: React.ReactNode }) {
  const isDesktop = useIsDesktop();
  const listRef = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = savedListScroll;
  }, [isDesktop]);

  if (!isDesktop) return <>{children}</>;

  return (
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
  );
}
