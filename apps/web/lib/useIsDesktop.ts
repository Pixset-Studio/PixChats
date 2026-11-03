import { useEffect, useState } from 'react';

let cachedIsDesktopValue: boolean | null = null;

/** true на широких экранах (ПК) — используется, чтобы не тянуть двойные данные на мобильном и не пересоздавать DOM при навигации. */
export function useIsDesktop(breakpoint = 768): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => cachedIsDesktopValue ?? false);

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${breakpoint}px)`);
    cachedIsDesktopValue = mql.matches;
    setIsDesktop(mql.matches);
    const handler = (e: MediaQueryListEvent) => {
      cachedIsDesktopValue = e.matches;
      setIsDesktop(e.matches);
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);

  return isDesktop;
}

