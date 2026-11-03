'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useIsDesktop } from '../lib/useIsDesktop';
import {
  isDesktopOrPcDevice,
  isPcLaunchMinimizedEnabled,
  setPcLaunchMinimizedEnabled,
} from '../lib/nativePlatform';
import { IconRail } from './IconRail';
import { ChatListPanel } from './ChatListPanel';

// useLayoutEffect не нужен на сервере (статический экспорт) — там берём обычный useEffect
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// Позиция прокрутки списка чатов живёт на уровне модуля — переживает любые переходы
let savedListScroll = 0;

const DesktopShellContext = createContext<boolean>(false);

const STANDALONE_PATHS = ['/', '/login', '/register', '/complete-profile', '/banned', '/appeals', '/faq', '/privacy'];
const PC_UNMINIMIZED_SESSION_KEY = 'pixchats:pc_session_unminimized';

function isStandaloneRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return STANDALONE_PATHS.includes(normalized);
}

/**
 * Постоянная оболочка на уровне RootLayout: удерживает IconRail и ChatListPanel
 * смонтированными при любых кликах между чатами и вкладками без перезагрузки панели.
 * Также реализует «Запуск в свёрнутом виде на ПК» (как в нативном .exe, так и в веб-клиенте ПК).
 */
export function PersistentAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  const listRef = useRef<HTMLDivElement>(null);
  const [pcMinimized, setPcMinimized] = useState(false);

  useIsoLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = savedListScroll;
  }, [isDesktop]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isDesktopOrPcDevice()) return;

    const checkStartupMinimize = async () => {
      try {
        let shouldMin = isPcLaunchMinimizedEnabled();
        if (window.pixchatsDesktop?.getLaunchMinimizedEnabled) {
          const savedLocal = localStorage.getItem('pixchats:desktop_launch_minimized');
          if (savedLocal !== null) {
            shouldMin = savedLocal === '1';
            await window.pixchatsDesktop.setLaunchMinimizedEnabled?.(shouldMin);
          } else {
            shouldMin = await window.pixchatsDesktop.getLaunchMinimizedEnabled();
            localStorage.setItem('pixchats:desktop_launch_minimized', shouldMin ? '1' : '0');
          }
        }

        const alreadyUnminimized = sessionStorage.getItem(PC_UNMINIMIZED_SESSION_KEY) === '1';
        if (shouldMin && !alreadyUnminimized) {
          setPcMinimized(true);
          if (window.pixchatsDesktop?.minimizeWindow) {
            void window.pixchatsDesktop.minimizeWindow();
          }
        }
      } catch {}
    };

    void checkStartupMinimize();

    const onMinimizeCmd = () => {
      setPcMinimized(true);
      try {
        window.pixchatsDesktop?.minimizeWindow?.();
      } catch {}
    };

    const onRestoreCmd = () => {
      try {
        sessionStorage.setItem(PC_UNMINIMIZED_SESSION_KEY, '1');
        window.pixchatsDesktop?.restoreWindow?.();
      } catch {}
      setPcMinimized(false);
    };

    const onFocusOrVisibility = () => {
      // Если в нативном .exe пользователь развернул окно с панели задач, разворачиваем и интерфейс
      if (window.pixchatsDesktop?.isWindowMinimized) {
        void window.pixchatsDesktop.isWindowMinimized().then((isMin) => {
          if (!isMin && document.visibilityState === 'visible') {
            sessionStorage.setItem(PC_UNMINIMIZED_SESSION_KEY, '1');
            setPcMinimized(false);
          }
        });
      }
    };

    window.addEventListener('pixchats:pc_minimize_now', onMinimizeCmd);
    window.addEventListener('pixchats:pc_restore_now', onRestoreCmd);
    window.addEventListener('focus', onFocusOrVisibility);

    return () => {
      window.removeEventListener('pixchats:pc_minimize_now', onMinimizeCmd);
      window.removeEventListener('pixchats:pc_restore_now', onRestoreCmd);
      window.removeEventListener('focus', onFocusOrVisibility);
    };
  }, []);

  const handleRestorePcWindow = () => {
    try {
      sessionStorage.setItem(PC_UNMINIMIZED_SESSION_KEY, '1');
      window.pixchatsDesktop?.restoreWindow?.();
    } catch {}
    setPcMinimized(false);
  };

  const handleDisableStartupMinimizeAndRestore = async () => {
    try {
      sessionStorage.setItem(PC_UNMINIMIZED_SESSION_KEY, '1');
      await setPcLaunchMinimizedEnabled(false);
      window.pixchatsDesktop?.restoreWindow?.();
    } catch {}
    setPcMinimized(false);
  };

  const minimizedOverlay = pcMinimized && isDesktop && !isStandaloneRoute(pathname) ? (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 15000,
        background: 'rgba(9, 9, 11, 0.86)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
        padding: 24,
      }}
      onClick={handleRestorePcWindow}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 380,
          maxWidth: '92vw',
          padding: 18,
          borderRadius: 16,
          background: 'var(--surface-raised)',
          border: '1.5px solid var(--accent)',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.75)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img
              src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/logo/icon.png`}
              alt="PixChats"
              style={{ width: 34, height: 34, objectFit: 'contain' }}
            />
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>
                🗕 PixChats свёрнут в фоне
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}>
                Уведомления и звонки активны
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: 'auto', padding: '7px 14px', fontSize: 12.5, fontWeight: 800 }}
            onClick={handleRestorePcWindow}
          >
            🗖 Развернуть
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
          Приложение запущено в свёрнутом режиме на ПК согласно вашим настройкам. Нажмите «Развернуть» или кликните в любом месте, чтобы открыть чаты.
        </p>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: 'auto', padding: '5px 10px', fontSize: 11.5, color: 'var(--text-muted)' }}
            onClick={handleDisableStartupMinimizeAndRestore}
          >
            ⚙️ Отключить запуск свёрнутым
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Настройки → Уведомления</span>
        </div>
      </div>
    </div>
  ) : null;

  if (!isDesktop || isStandaloneRoute(pathname)) {
    return <>{children}</>;
  }

  return (
    <DesktopShellContext.Provider value={true}>
      {minimizedOverlay}
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
