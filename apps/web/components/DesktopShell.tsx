'use client';

import { useIsDesktop } from '../lib/useIsDesktop';
import { IconRail } from './IconRail';
import { ChatListPanel } from './ChatListPanel';

/**
 * На широких экранах (ПК) показывает рейл папок + список чатов слева и содержимое
 * страницы (сам чат, или заглушку "выберите чат") справа — как в десктопной версии
 * Telegram. На мобильном — просто рендерит children без изменений (там уже есть
 * BottomNav и собственный список чатов внутри страницы /chats).
 */
export function DesktopShell({ children }: { children: React.ReactNode }) {
  const isDesktop = useIsDesktop();

  if (!isDesktop) return <>{children}</>;

  return (
    <div className="desktop-shell">
      <IconRail />
      <div className="desktop-list-pane">
        <ChatListPanel />
      </div>
      <div className="desktop-content-pane">{children}</div>
    </div>
  );
}
