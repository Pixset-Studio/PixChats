import { useEffect, useState } from 'react';

/** true на широких экранах (ПК) — используется, чтобы не тянуть двойные данные на мобильном. */
export function useIsDesktop(breakpoint = 900): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${breakpoint}px)`);
    setIsDesktop(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);

  return isDesktop;
}
