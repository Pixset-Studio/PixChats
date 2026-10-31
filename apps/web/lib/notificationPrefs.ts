export interface NotificationPreferences {
  /** Главный переключатель всех уведомлений */
  enabled: boolean;
  /** Входящие аудио- и видеозвонки */
  incomingCalls: boolean;
  /** Новые личные сообщения (direct) */
  directMessages: boolean;
  /** Новые сообщения в группах и каналах */
  groupMessages: boolean;
  /** Упоминания через @username */
  mentions: boolean;
  /** Входящие заявки в друзья и принятые запросы */
  friendRequests: boolean;
  /** Добавление в новые группы и каналы */
  chatInvites: boolean;
  /** Изменения статуса аккаунта, ролей и бейджей */
  accountEvents: boolean;
  /** Звуковой сигнал при уведомлении */
  sound: boolean;
}

const STORAGE_KEY = 'pixchats:notification_prefs_v1';

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  enabled: true,
  incomingCalls: true,
  directMessages: true,
  groupMessages: true,
  mentions: true,
  friendRequests: true,
  chatInvites: true,
  accountEvents: true,
  sound: true,
};

export function getNotificationPrefs(): NotificationPreferences {
  if (typeof window === 'undefined') return DEFAULT_NOTIFICATION_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_PREFS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_NOTIFICATION_PREFS,
      ...(typeof parsed === 'object' && parsed !== null ? parsed : {}),
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

export function setNotificationPrefs(prefs: NotificationPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent('pixchats:notification_prefs_changed', { detail: prefs }));
  } catch {
    // ignore storage errors
  }
}

export function updateNotificationPref<K extends keyof NotificationPreferences>(
  key: K,
  value: NotificationPreferences[K]
): NotificationPreferences {
  const next = {
    ...getNotificationPrefs(),
    [key]: value,
  };
  setNotificationPrefs(next);
  return next;
}
