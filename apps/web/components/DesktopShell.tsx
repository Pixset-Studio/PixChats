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
 * На широких экранах (ПК) показывает рейл папок + список чатов слева и содержимое
 * страницы (сам чат, или заглушку "выберите чат") справа — как в десктопной версии
 * Telegram. На мобильном — просто рендерит children без изменений (там уже есть
 * BottomNav и собственный список чатов внутри страницы /chats).
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
  );
}
