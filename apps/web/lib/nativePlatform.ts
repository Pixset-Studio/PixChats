'use client';

export type RuntimePlatform = 'desktop-exe' | 'android-apk' | 'web';

export interface NativeDesktopBridge {
  isDesktop: boolean;
  platform: string;
  sendNotification?: (payload: {
    title: string;
    body: string;
    url?: string;
    silent?: boolean;
  }) => Promise<boolean> | boolean;
  requestNotificationPermission?: () => Promise<'granted' | 'denied'>;
  setBadgeCount?: (count: number) => void;
  installUpdate?: (downloadUrl: string, fileName?: string) => Promise<boolean>;
  onNavigate?: (callback: (url: string) => void) => () => void;
}

export interface NativeAndroidBridge {
  isNativeAndroid?: () => boolean;
  hasNotificationPermission?: () => boolean;
  requestNotificationPermission?: () => void;
  showNotification?: (title: string, body: string, targetUrl: string) => void;
  downloadAndInstallApk?: (apkUrl: string) => void;
}

declare global {
  interface Window {
    pixchatsDesktop?: NativeDesktopBridge;
    PixChatsAndroid?: NativeAndroidBridge;
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
      Plugins?: {
        LocalNotifications?: {
          checkPermissions?: () => Promise<{ display: string }>;
          requestPermissions?: () => Promise<{ display: string }>;
          schedule?: (options: {
            notifications: Array<{
              id: number;
              title: string;
              body: string;
              extra?: Record<string, any>;
              smallIcon?: string;
              sound?: string;
            }>;
          }) => Promise<void>;
          addListener?: (
            eventName: string,
            listenerFunc: (event: any) => void
          ) => Promise<{ remove: () => void }>;
        };
      };
    };
  }
}

/**
 * Определяет текущую платформу исполнения:
 * - 'desktop-exe': нативное Windows-приложение (.exe)
 * - 'android-apk': нативное Android-приложение (.apk)
 * - 'web': обычный браузер
 */
export function detectRuntimePlatform(): RuntimePlatform {
  if (typeof window === 'undefined') return 'web';

  const ua = navigator.userAgent.toLowerCase();

  if (
    Boolean(window.pixchatsDesktop) ||
    ua.includes('electron') ||
    window.location.port === '47821'
  ) {
    return 'desktop-exe';
  }

  if (
    Boolean(window.PixChatsAndroid) ||
    Boolean(window.Capacitor?.isNativePlatform?.()) ||
    ua.includes('capacitor') ||
    ua.includes('pixchats-android') ||
    ua.includes('; wv)')
  ) {
    return 'android-apk';
  }

  return 'web';
}

/**
 * Автоматически запрашивает разрешение на уведомления сразу везде:
 * - В Android APK: через нативный Kotlin-мост (PixChatsAndroid.requestNotificationPermission)
 *   и через плагин Capacitor LocalNotifications
 * - В Windows EXE: через нативный процесс Electron / Windows Toast API
 * - В Web: через браузерный Notification.requestPermission() (сразу и при первом касании/клике)
 */
let autoRequestInitialized = false;

export async function requestPermissionNow(): Promise<'granted' | 'denied' | 'default'> {
  if (typeof window === 'undefined') return 'default';

  const platform = detectRuntimePlatform();

  // 1. Нативное приложение Windows (.exe) — уведомления разрешены на уровне ОС
  if (platform === 'desktop-exe') {
    try {
      if (window.pixchatsDesktop?.requestNotificationPermission) {
        return await window.pixchatsDesktop.requestNotificationPermission();
      }
    } catch {
      // ignore
    }
    return 'granted';
  }

  // 2. Нативное приложение Android (.apk) — запрашиваем системное разрешение POST_NOTIFICATIONS
  if (platform === 'android-apk') {
    let granted = false;

    try {
      if (window.PixChatsAndroid) {
        if (window.PixChatsAndroid.hasNotificationPermission?.()) {
          granted = true;
        } else {
          window.PixChatsAndroid.requestNotificationPermission?.();
        }
      }
    } catch {
      // ignore
    }

    try {
      const localNotifs = window.Capacitor?.Plugins?.LocalNotifications;
      if (localNotifs) {
        const status = await localNotifs.checkPermissions?.();
        if (status?.display === 'granted') {
          granted = true;
        } else {
          const req = await localNotifs.requestPermissions?.();
          if (req?.display === 'granted') granted = true;
        }
      }
    } catch {
      // ignore
    }

    // Дополнительно пробуем Web Notification API, если он доступен
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        const res = await Notification.requestPermission();
        if (res === 'granted') granted = true;
      } catch {
        // ignore
      }
    }

    return granted ? 'granted' : 'default';
  }

  // 3. Веб-версия
  if ('Notification' in window) {
    if (Notification.permission === 'granted' || Notification.permission === 'denied') {
      return Notification.permission;
    }
    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  }

  return 'default';
}

export function ensureNotificationPermissionEverywhere(): void {
  if (typeof window === 'undefined' || autoRequestInitialized) return;
  autoRequestInitialized = true;

  // Запрашиваем сразу при старте приложения
  void requestPermissionNow();

  // Также подписываемся на первые взаимодействия пользователя, чтобы гарантировать
  // показ системного диалога разрешений на всех браузерах и мобильных устройствах
  const triggerOnInteraction = async () => {
    const status = await requestPermissionNow();
    if (status === 'granted' || status === 'denied') {
      window.removeEventListener('pointerdown', triggerOnInteraction);
      window.removeEventListener('keydown', triggerOnInteraction);
      window.removeEventListener('touchstart', triggerOnInteraction);
    }
  };

  window.addEventListener('pointerdown', triggerOnInteraction, { passive: true });
  window.addEventListener('keydown', triggerOnInteraction, { passive: true });
  window.addEventListener('touchstart', triggerOnInteraction, { passive: true });
}

/**
 * Отправляет системное уведомление нативным способом для текущей платформы (.exe, .apk, web).
 */
export async function sendNativeOrWebNotification(options: {
  title: string;
  body: string;
  url?: string;
  silent?: boolean;
  onNavigate?: (url: string) => void;
}): Promise<void> {
  if (typeof window === 'undefined') return;

  const { title, body, url = '/chats/', silent = false, onNavigate } = options;
  const platform = detectRuntimePlatform();

  // 1. Нативное приложение Windows (.exe)
  if (platform === 'desktop-exe' && window.pixchatsDesktop?.sendNotification) {
    try {
      await window.pixchatsDesktop.sendNotification({ title, body, url, silent });
      return;
    } catch {
      // fallback ниже
    }
  }

  // 2. Нативное приложение Android (.apk)
  if (platform === 'android-apk') {
    // 2a. Через нативный Kotlin JavascriptInterface
    if (window.PixChatsAndroid?.showNotification) {
      try {
        window.PixChatsAndroid.showNotification(title, body, url);
        return;
      } catch {
        // fallback к Capacitor LocalNotifications
      }
    }

    // 2b. Через Capacitor LocalNotifications
    const localNotifs = window.Capacitor?.Plugins?.LocalNotifications;
    if (localNotifs?.schedule) {
      try {
        await localNotifs.schedule({
          notifications: [
            {
              id: Math.floor(Date.now() % 2147483000),
              title,
              body,
              extra: { url },
            },
          ],
        });
        return;
      } catch {
        // fallback ниже
      }
    }
  }

  // 3. Стандартный Web Notification API / Service Worker
  if ('Notification' in window) {
    if (Notification.permission === 'default') {
      await requestPermissionNow();
    }
    if (Notification.permission === 'granted') {
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
      const iconUrl = `${basePath}/logo/icon.png`;
      try {
        const notif = new Notification(title, {
          body,
          icon: iconUrl,
          badge: iconUrl,
          silent,
        });
        if (url && onNavigate) {
          notif.onclick = () => {
            window.focus();
            onNavigate(url);
          };
        }
        return;
      } catch {
        // На мобильных браузерах new Notification() может требовать ServiceWorkerRegistration
        if ('serviceWorker' in navigator) {
          try {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) {
              await reg.showNotification(title, {
                body,
                icon: iconUrl,
                badge: iconUrl,
                data: { url },
              });
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }
}
