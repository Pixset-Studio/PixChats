/**
 * secretMedia.ts — Одноразовые («View Once») и временные сгорающие медиафайлы (3, 5, 10, 15, 30 сек)
 */

export type SecretMediaRule = 'view_once' | '3' | '5' | '10' | '15' | '30';

export interface SecretMediaConfig {
  isSecret: boolean;
  rule: SecretMediaRule;
  label: string;
}

const OPENED_SECRET_MEDIA_KEY = 'pixchats:opened_secret_media_ids';

export function encodeSecretMediaCaption(rule: SecretMediaRule, caption?: string): string {
  const prefix = `[SECRET_MEDIA:${rule}]`;
  return caption ? `${prefix} ${caption}` : prefix;
}

export function parseSecretMediaCaption(caption?: string): {
  isSecret: boolean;
  rule: SecretMediaRule;
  cleanCaption: string;
} {
  if (!caption) return { isSecret: false, rule: 'view_once', cleanCaption: '' };
  const match = caption.match(/^\[SECRET_MEDIA:(view_once|3|5|10|15|30)\]\s*(.*)$/);
  if (!match) return { isSecret: false, rule: 'view_once', cleanCaption: caption };

  return {
    isSecret: true,
    rule: match[1] as SecretMediaRule,
    cleanCaption: match[2] || '',
  };
}

export function isSecretMediaOpened(messageId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const list: string[] = JSON.parse(localStorage.getItem(OPENED_SECRET_MEDIA_KEY) || '[]');
    return list.includes(messageId);
  } catch {
    return false;
  }
}

export function markSecretMediaOpened(messageId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const list: string[] = JSON.parse(localStorage.getItem(OPENED_SECRET_MEDIA_KEY) || '[]');
    if (!list.includes(messageId)) {
      list.push(messageId);
      localStorage.setItem(OPENED_SECRET_MEDIA_KEY, JSON.stringify(list));
      window.dispatchEvent(new CustomEvent('pixchats:secret_media_opened'));
    }
  } catch {}
}

export function getSecretMediaRuleLabel(rule: SecretMediaRule): string {
  switch (rule) {
    case 'view_once':
      return '👁️ 1 раз (Одноразовое)';
    case '3':
      return '⏱️ 3 секунды';
    case '5':
      return '⏱️ 5 секунд';
    case '10':
      return '⏱️ 10 секунд';
    case '15':
      return '⏱️ 15 секунд';
    case '30':
      return '⏱️ 30 секунд';
    default:
      return '🔥 Сгорающее';
  }
}
