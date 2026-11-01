'use client';

import { getSupabaseClient } from '@pixchats/core';
import { detectRuntimePlatform } from './nativePlatform';

export interface DeviceSessionInfo {
  sessionId: string;
  deviceName: string;
  platformType: 'desktop-exe' | 'android-apk' | 'web';
  osName: string;
  clientLabel: string;
  appVersion: string;
  locationLabel: string;
  createdAt: string;
  lastActiveAt: string;
  isOnline?: boolean;
  isCurrent?: boolean;
}

const SESSION_ID_KEY = 'pixchats:device_session_id';
const SESSION_CREATED_KEY = 'pixchats:device_session_created_at';
const LOCAL_DEVICES_CACHE_PREFIX = 'pixchats:devices_cache:';
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.2.0';

export function getOrCreateDeviceSessionId(): string {
  if (typeof window === 'undefined') return 'server-session';
  try {
    let existing = localStorage.getItem(SESSION_ID_KEY);
    if (!existing) {
      existing = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(SESSION_ID_KEY, existing);
      localStorage.setItem(SESSION_CREATED_KEY, new Date().toISOString());
    }
    return existing;
  } catch {
    return `dev-${Date.now().toString(36)}`;
  }
}

function detectDeviceAndOsDetails(): {
  deviceName: string;
  platformType: 'desktop-exe' | 'android-apk' | 'web';
  osName: string;
  clientLabel: string;
} {
  const platformType = detectRuntimePlatform();
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

  let osName = 'Устройство';
  if (/Windows NT 10\.0/i.test(ua)) {
    osName = 'Windows 10 / 11';
  } else if (/Windows/i.test(ua)) {
    osName = 'Windows PC';
  } else if (/Android\s+([0-9.]+)/i.test(ua)) {
    const ver = ua.match(/Android\s+([0-9.]+)/i)?.[1] || '';
    const modelMatch = ua.match(/;\s*([^;)]+)\s+Build\//i);
    const model = modelMatch ? modelMatch[1].trim() : 'Смартфон';
    osName = `Android ${ver} (${model})`.trim();
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    osName = /iPad/i.test(ua) ? 'iPadOS (iPad)' : 'iOS (iPhone)';
  } else if (/Mac OS X/i.test(ua)) {
    osName = 'macOS';
  } else if (/Linux/i.test(ua)) {
    osName = 'Linux';
  }

  let browserName = 'Браузер';
  if (/YaBrowser/i.test(ua)) {
    browserName = 'Яндекс Браузер';
  } else if (/Edg\//i.test(ua)) {
    browserName = 'Microsoft Edge';
  } else if (/OPR\/|Opera/i.test(ua)) {
    browserName = 'Opera';
  } else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) {
    browserName = 'Google Chrome';
  } else if (/Firefox\//i.test(ua)) {
    browserName = 'Mozilla Firefox';
  } else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) {
    browserName = 'Safari';
  }

  if (platformType === 'desktop-exe') {
    return {
      deviceName: `ПК — ${osName}`,
      platformType,
      osName,
      clientLabel: `PixChats Desktop (.exe) v${APP_VERSION}`,
    };
  }

  if (platformType === 'android-apk') {
    return {
      deviceName: osName.startsWith('Android') ? osName : `Телефон — ${osName}`,
      platformType,
      osName,
      clientLabel: `PixChats Android (.apk) v${APP_VERSION}`,
    };
  }

  return {
    deviceName: `${browserName} на ${osName}`,
    platformType: 'web',
    osName,
    clientLabel: `PixChats Web (${browserName}) v${APP_VERSION}`,
  };
}

function getTimezoneLocationLabel(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return 'Локальная сеть';
    return tz.replace(/_/g, ' ');
  } catch {
    return 'Локальная сеть';
  }
}

export function buildCurrentDeviceSession(): DeviceSessionInfo {
  const sessionId = getOrCreateDeviceSessionId();
  const details = detectDeviceAndOsDetails();
  let createdAt = new Date().toISOString();
  try {
    createdAt = localStorage.getItem(SESSION_CREATED_KEY) || createdAt;
  } catch {}

  return {
    sessionId,
    deviceName: details.deviceName,
    platformType: details.platformType,
    osName: details.osName,
    clientLabel: details.clientLabel,
    appVersion: APP_VERSION,
    locationLabel: getTimezoneLocationLabel(),
    createdAt,
    lastActiveAt: new Date().toISOString(),
    isOnline: true,
    isCurrent: true,
  };
}

function readCachedDevices(userId: string): DeviceSessionInfo[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`${LOCAL_DEVICES_CACHE_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedDevices(userId: string, list: DeviceSessionInfo[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${LOCAL_DEVICES_CACHE_PREFIX}${userId}`, JSON.stringify(list));
  } catch {}
}

/**
 * Загружает список активных устройств аккаунта из user_metadata Supabase Auth
 * и синхронизирует текущее устройство.
 */
export async function syncAndGetAccountDevices(userId: string): Promise<{
  devices: DeviceSessionInfo[];
  revokedCurrent: boolean;
}> {
  const current = buildCurrentDeviceSession();
  const supabase = getSupabaseClient();

  try {
    const { data: userData } = await supabase.auth.getUser();
    const meta = (userData?.user?.user_metadata || {}) as {
      pixchats_devices?: DeviceSessionInfo[];
      pixchats_revoked_sessions?: string[];
    };

    const revokedList = Array.isArray(meta.pixchats_revoked_sessions)
      ? meta.pixchats_revoked_sessions
      : [];

    if (revokedList.includes(current.sessionId)) {
      return { devices: [], revokedCurrent: true };
    }

    const remoteDevices = Array.isArray(meta.pixchats_devices)
      ? meta.pixchats_devices
      : readCachedDevices(userId);

    const nowMs = Date.now();
    const mergedMap = new Map<string, DeviceSessionInfo>();

    for (const dev of remoteDevices) {
      if (!dev || !dev.sessionId || revokedList.includes(dev.sessionId)) continue;
      // Отбрасываем устаревшие сессии старше 30 дней без активности
      const lastMs = Date.parse(dev.lastActiveAt || dev.createdAt || '');
      if (!Number.isNaN(lastMs) && nowMs - lastMs > 30 * 24 * 60 * 60 * 1000) continue;
      mergedMap.set(dev.sessionId, {
        ...dev,
        isCurrent: dev.sessionId === current.sessionId,
        isOnline:
          dev.sessionId === current.sessionId ||
          (!Number.isNaN(lastMs) && nowMs - lastMs < 3 * 60 * 1000),
      });
    }

    const existingMine = mergedMap.get(current.sessionId);
    const updatedMine: DeviceSessionInfo = {
      ...current,
      createdAt: existingMine?.createdAt || current.createdAt,
      lastActiveAt: new Date().toISOString(),
      isCurrent: true,
      isOnline: true,
    };
    mergedMap.set(current.sessionId, updatedMine);

    const finalList = Array.from(mergedMap.values()).sort((a, b) => {
      if (a.sessionId === current.sessionId) return -1;
      if (b.sessionId === current.sessionId) return 1;
      return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime();
    });

    writeCachedDevices(userId, finalList);

    // Обновляем в user_metadata (без флагов isCurrent/isOnline)
    const cleanForCloud = finalList.slice(0, 15).map(({ isCurrent, isOnline, ...rest }) => rest);
    await supabase.auth
      .updateUser({
        data: {
          pixchats_devices: cleanForCloud,
          pixchats_revoked_sessions: revokedList.slice(-40),
        },
      })
      .catch(() => {});

    return { devices: finalList, revokedCurrent: false };
  } catch {
    const cached = readCachedDevices(userId);
    const others = cached.filter((d) => d.sessionId !== current.sessionId);
    const combined = [current, ...others];
    writeCachedDevices(userId, combined);
    return { devices: combined, revokedCurrent: false };
  }
}

/**
 * Завершает сеанс конкретного устройства по его sessionId:
 * 1. Удаляет устройство из списка pixchats_devices и заносит sessionId в pixchats_revoked_sessions
 * 2. Отправляет мгновенный Realtime-сигнал revoke-session, чтобы устройство сразу вышло из аккаунта
 */
export async function terminateDeviceSession(
  userId: string,
  targetSessionId: string
): Promise<DeviceSessionInfo[]> {
  const supabase = getSupabaseClient();
  const currentId = getOrCreateDeviceSessionId();

  try {
    const { data: userData } = await supabase.auth.getUser();
    const meta = (userData?.user?.user_metadata || {}) as {
      pixchats_devices?: DeviceSessionInfo[];
      pixchats_revoked_sessions?: string[];
    };

    const existingDevices = Array.isArray(meta.pixchats_devices)
      ? meta.pixchats_devices
      : readCachedDevices(userId);
    const existingRevoked = Array.isArray(meta.pixchats_revoked_sessions)
      ? meta.pixchats_revoked_sessions
      : [];

    const nextDevices = existingDevices.filter((d) => d.sessionId !== targetSessionId);
    const nextRevoked = Array.from(new Set([...existingRevoked, targetSessionId])).slice(-50);

    await supabase.auth.updateUser({
      data: {
        pixchats_devices: nextDevices,
        pixchats_revoked_sessions: nextRevoked,
      },
    });

    // Отправляем мгновенный broadcast на канал устройств пользователя
    const ch = supabase.channel(`pixchats-devices:${userId}`);
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        ch.send({
          type: 'broadcast',
          event: 'revoke-session',
          payload: { sessionIds: [targetSessionId] },
        });
        setTimeout(() => {
          supabase.removeChannel(ch);
        }, 1200);
      }
    });

    const formatted = nextDevices.map((d) => ({
      ...d,
      isCurrent: d.sessionId === currentId,
      isOnline:
        d.sessionId === currentId ||
        Date.now() - Date.parse(d.lastActiveAt || '') < 3 * 60 * 1000,
    }));
    writeCachedDevices(userId, formatted);
    return formatted;
  } catch {
    const filtered = readCachedDevices(userId).filter((d) => d.sessionId !== targetSessionId);
    writeCachedDevices(userId, filtered);
    return filtered;
  }
}

/**
 * Завершает сеансы на ВСЕХ устройствах, кроме текущего.
 */
export async function terminateAllOtherDeviceSessions(
  userId: string
): Promise<DeviceSessionInfo[]> {
  const supabase = getSupabaseClient();
  const current = buildCurrentDeviceSession();

  try {
    const { data: userData } = await supabase.auth.getUser();
    const meta = (userData?.user?.user_metadata || {}) as {
      pixchats_devices?: DeviceSessionInfo[];
      pixchats_revoked_sessions?: string[];
    };

    const existingDevices = Array.isArray(meta.pixchats_devices)
      ? meta.pixchats_devices
      : readCachedDevices(userId);
    const existingRevoked = Array.isArray(meta.pixchats_revoked_sessions)
      ? meta.pixchats_revoked_sessions
      : [];

    const otherIds = existingDevices
      .map((d) => d.sessionId)
      .filter((id) => id && id !== current.sessionId);

    const nextRevoked = Array.from(new Set([...existingRevoked, ...otherIds])).slice(-60);
    const { isCurrent, isOnline, ...cleanCurrent } = current;

    await supabase.auth.updateUser({
      data: {
        pixchats_devices: [cleanCurrent],
        pixchats_revoked_sessions: nextRevoked,
      },
    });

    if (otherIds.length > 0) {
      const ch = supabase.channel(`pixchats-devices:${userId}`);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ch.send({
            type: 'broadcast',
            event: 'revoke-session',
            payload: { sessionIds: otherIds },
          });
          setTimeout(() => {
            supabase.removeChannel(ch);
          }, 1200);
        }
      });
    }

    const finalList = [current];
    writeCachedDevices(userId, finalList);
    return finalList;
  } catch {
    const finalList = [current];
    writeCachedDevices(userId, finalList);
    return finalList;
  }
}

/**
 * Запускает глобальный мониторинг сессии текущего устройства:
 * - Регистрирует устройство при входе
 * - Поддерживает онлайн-статус устройства
 * - Мгновенно разлогинивает устройство, если его сессию завершили с другого устройства
 */
export function startDeviceSessionMonitor(
  userId: string,
  onRevoked: () => void
): () => void {
  const currentSessionId = getOrCreateDeviceSessionId();
  const supabase = getSupabaseClient();

  let stopped = false;

  const handleRevoke = async () => {
    if (stopped) return;
    stopped = true;
    try {
      localStorage.removeItem(SESSION_ID_KEY);
      localStorage.removeItem(SESSION_CREATED_KEY);
      await supabase.auth.signOut();
    } catch {}
    onRevoked();
  };

  void syncAndGetAccountDevices(userId).then(({ revokedCurrent }) => {
    if (revokedCurrent) {
      void handleRevoke();
    }
  });

  const channel = supabase
    .channel(`pixchats-devices:${userId}`, {
      config: {
        presence: { key: currentSessionId },
      },
    })
    .on('broadcast', { event: 'revoke-session' }, ({ payload }) => {
      const ids: string[] = Array.isArray(payload?.sessionIds) ? payload.sessionIds : [];
      if (ids.includes(currentSessionId)) {
        void handleRevoke();
      } else {
        window.dispatchEvent(new CustomEvent('pixchats:devices_updated'));
      }
    })
    .on('presence', { event: 'sync' }, () => {
      window.dispatchEvent(new CustomEvent('pixchats:devices_updated'));
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        const info = buildCurrentDeviceSession();
        void channel.track(info);
      }
    });

  const interval = setInterval(() => {
    void syncAndGetAccountDevices(userId).then(({ revokedCurrent }) => {
      if (revokedCurrent) {
        void handleRevoke();
      }
    });
  }, 2 * 60 * 1000);

  return () => {
    stopped = true;
    clearInterval(interval);
    supabase.removeChannel(channel);
  };
}
