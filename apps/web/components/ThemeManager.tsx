'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { applyChatAppearance } from '../lib/chatAppearance';

export const PIXSET_THEMES = [
  {
    id: 'pixchats',
    name: 'PixChats',
    desc: 'Фирменный тёмно-жёлтый мессенджер',
    accent: '#ffd400',
    bg: '#09090b',
    surface: '#161510',
  },
  {
    id: 'industrial',
    name: 'Индустриальная',
    desc: 'Жёлтая лента, крупный шрифт (Pixset Studio)',
    accent: '#ffd400',
    bg: '#0a0a0a',
    surface: '#161510',
  },
  {
    id: 'arcade',
    name: 'Аркадная',
    desc: 'Пиксельный ретро-терминал (Pixset Studio)',
    accent: '#ffd400',
    bg: '#04040a',
    surface: '#0e0e18',
  },
  {
    id: 'minimal',
    name: 'Минимализм',
    desc: 'Чёрный лист и золотая линия (Pixset Studio)',
    accent: '#ffd400',
    bg: '#070707',
    surface: '#101010',
  },
  {
    id: 'byteblaster',
    name: 'Byte Blaster',
    desc: 'Неон игры — бирюзовый & маджента (Pixset Studio)',
    accent: '#00ffff',
    bg: '#04040f',
    surface: '#0a0a20',
  },
  {
    id: 'light',
    name: 'Светлая',
    desc: 'Чистое светлое оформление',
    accent: '#ca8a04',
    bg: '#f8fafc',
    surface: '#ffffff',
  },
] as const;

export type AppThemeId = (typeof PIXSET_THEMES)[number]['id'];

export function applyTheme(themeId: string) {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', themeId);
  localStorage.setItem('pixchats:theme', themeId);
  document.dispatchEvent(new CustomEvent('pixset:theme', { detail: themeId }));
}

export function getCurrentTheme(): AppThemeId {
  if (typeof window === 'undefined') return 'pixchats';
  const saved = localStorage.getItem('pixchats:theme');
  if (saved && PIXSET_THEMES.some((t) => t.id === saved)) {
    return saved as AppThemeId;
  }
  // Обратная совместимость для byte_blaster
  if (saved === 'byte_blaster') return 'byteblaster';
  return 'pixchats';
}

/**
 * Гарантирует постоянное сохранение выбранной темы при любых переходах между страницами,
 * клиентских навигациях Next.js и рендерах.
 */
export function ThemeManager() {
  const pathname = usePathname();

  useEffect(() => {
    function syncTheme() {
      const theme = getCurrentTheme();
      if (document.documentElement.getAttribute('data-theme') !== theme) {
        document.documentElement.setAttribute('data-theme', theme);
      }
      applyChatAppearance();
    }

    syncTheme();

    // Слушаем изменение в других вкладках или кастомные события
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'pixchats:theme') syncTheme();
    };
    const onCustom = () => syncTheme();

    window.addEventListener('storage', onStorage);
    window.addEventListener('popstate', syncTheme);
    document.addEventListener('pixset:theme', onCustom);

    // Следим через MutationObserver на случай, если Next.js затрёт data-theme при роутинге
    const observer = new MutationObserver(() => {
      const current = getCurrentTheme();
      if (document.documentElement.getAttribute('data-theme') !== current) {
        document.documentElement.setAttribute('data-theme', current);
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('popstate', syncTheme);
      document.removeEventListener('pixset:theme', onCustom);
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}
