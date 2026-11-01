'use client';

export interface AppLockConfig {
  enabled: boolean;
  pinCode: string; // 4-8 символов
  autoLockMinutes: 0 | 1 | 5 | 15; // 0 = только при запуске или по кнопке
}

const APP_LOCK_KEY = 'pixchats:app_lock_v1';
const HIDDEN_CHATS_KEY = 'pixchats:hidden_chats_v1';
const SESSION_UNLOCKED_KEY = 'pixchats:app_lock_session_unlocked';

export const DEFAULT_APP_LOCK: AppLockConfig = {
  enabled: false,
  pinCode: '',
  autoLockMinutes: 5,
};

export function getAppLockConfig(): AppLockConfig {
  if (typeof window === 'undefined') return DEFAULT_APP_LOCK;
  try {
    const raw = localStorage.getItem(APP_LOCK_KEY);
    if (!raw) return DEFAULT_APP_LOCK;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_APP_LOCK,
      ...parsed,
    };
  } catch {
    return DEFAULT_APP_LOCK;
  }
}

export function saveAppLockConfig(next: Partial<AppLockConfig>): AppLockConfig {
  const merged: AppLockConfig = {
    ...getAppLockConfig(),
    ...next,
  };
  if (typeof window !== 'undefined') {
    localStorage.setItem(APP_LOCK_KEY, JSON.stringify(merged));
    if (merged.enabled && merged.pinCode) {
      sessionStorage.setItem(SESSION_UNLOCKED_KEY, '1');
    } else {
      sessionStorage.removeItem(SESSION_UNLOCKED_KEY);
    }
    window.dispatchEvent(new CustomEvent('pixchats:applock_changed'));
  }
  return merged;
}

export function isSessionUnlocked(): boolean {
  if (typeof window === 'undefined') return true;
  const cfg = getAppLockConfig();
  if (!cfg.enabled || !cfg.pinCode) return true;
  return sessionStorage.getItem(SESSION_UNLOCKED_KEY) === '1';
}

export function lockSessionNow(): void {
  if (typeof window === 'undefined') return;
  const cfg = getAppLockConfig();
  if (!cfg.enabled || !cfg.pinCode) return;
  sessionStorage.removeItem(SESSION_UNLOCKED_KEY);
  window.dispatchEvent(new CustomEvent('pixchats:applock_changed'));
}

export function verifyAndUnlockSession(inputPin: string): boolean {
  const cfg = getAppLockConfig();
  if (!cfg.enabled || !cfg.pinCode) return true;
  if (inputPin.trim() === cfg.pinCode.trim()) {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(SESSION_UNLOCKED_KEY, '1');
      window.dispatchEvent(new CustomEvent('pixchats:applock_changed'));
    }
    return true;
  }
  return false;
}

/** Скрытые под PIN-кодом чаты */
export function getHiddenChatIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HIDDEN_CHATS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isChatHidden(chatId: string): boolean {
  return getHiddenChatIds().includes(chatId);
}

export function toggleHiddenChat(chatId: string): boolean {
  if (typeof window === 'undefined') return false;
  const current = getHiddenChatIds();
  const isNowHidden = !current.includes(chatId);
  const next = isNowHidden ? [...current, chatId] : current.filter((id) => id !== chatId);
  localStorage.setItem(HIDDEN_CHATS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('pixchats:folders_changed'));
  return isNowHidden;
}
