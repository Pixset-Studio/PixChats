/**
 * screenshotGuard.ts — Защита от скриншотов, копирования и сохранения медиафайлов
 */

const GUARD_KEY = 'pixchats:screenshot_guard_enabled';

export function isScreenshotGuardEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(GUARD_KEY) === 'true';
}

export function setScreenshotGuardEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(GUARD_KEY, enabled ? 'true' : 'false');
  window.dispatchEvent(new CustomEvent('pixchats:screenshot_guard_changed'));
}

export function applyScreenshotGuardProtection(node: HTMLElement | null): void {
  if (!node || typeof window === 'undefined') return;
  if (!isScreenshotGuardEnabled()) return;

  // Запрет выделения, контекстного меню и перетаскивания
  node.style.userSelect = 'none';
  node.style.webkitUserSelect = 'none';

  const preventHandler = (e: Event) => e.preventDefault();
  node.addEventListener('contextmenu', preventHandler);
  node.addEventListener('dragstart', preventHandler);
}
