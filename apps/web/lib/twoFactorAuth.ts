/**
 * twoFactorAuth.ts — Облачный пароль и двухфакторная аутентификация (2FA)
 */

export interface TwoFactorConfig {
  enabled: boolean;
  passwordHash: string;
  hint: string;
  recoveryCode: string;
  updatedAt: string;
}

const STORAGE_KEY = 'pixchats:2fa_config';
const SESSION_VERIFIED_KEY = 'pixchats:2fa_verified_session';

export function get2FAConfig(): TwoFactorConfig {
  if (typeof window === 'undefined') {
    return { enabled: false, passwordHash: '', hint: '', recoveryCode: '', updatedAt: '' };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { enabled: false, passwordHash: '', hint: '', recoveryCode: '', updatedAt: '' };
}

export function save2FAConfig(cfg: TwoFactorConfig): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  window.dispatchEvent(new CustomEvent('pixchats:2fa_changed'));
}

export function is2FASessionVerified(): boolean {
  if (typeof window === 'undefined') return true;
  const cfg = get2FAConfig();
  if (!cfg.enabled || !cfg.passwordHash) return true;
  return sessionStorage.getItem(SESSION_VERIFIED_KEY) === 'true';
}

export function verify2FAPassword(inputPass: string): boolean {
  const cfg = get2FAConfig();
  if (!cfg.enabled || !cfg.passwordHash) return true;
  if (inputPass === cfg.passwordHash || (cfg.recoveryCode && inputPass === cfg.recoveryCode)) {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(SESSION_VERIFIED_KEY, 'true');
    }
    return true;
  }
  return false;
}

export function lock2FASession(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(SESSION_VERIFIED_KEY);
  window.dispatchEvent(new CustomEvent('pixchats:2fa_changed'));
}
