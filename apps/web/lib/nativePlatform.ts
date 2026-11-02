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
  notifyIncomingCall?: (payload: {
    callerName: string;
    mode: 'audio' | 'video';
    chatId?: string;
  }) => Promise<boolean> | boolean;
  requestNotificationPermission?: () => Promise<'granted' | 'denied'>;
  getAutoStartEnabled?: () => Promise<boolean>;
  setAutoStartEnabled?: (enabled: boolean) => Promise<boolean>;
  getLaunchMinimizedEnabled?: () => Promise<boolean>;
  setLaunchMinimizedEnabled?: (enabled: boolean) => Promise<boolean>;
  setBadgeCount?: (count: number) => void;
  installUpdate?: (downloadUrl: string, fileName?: string) => Promise<boolean>;
  onNavigate?: (callback: (url: string) => void) => () => void;
}

export interface NativeAndroidBridge {
  isNativeAndroid?: () => boolean;
  hasNotificationPermission?: () => boolean;
  requestNotificationPermission?: () => void;
  showNotification?: (title: string, body: string, targetUrl: string) => void;
  showIncomingCallNotification?: (callerName: string, mode: string, targetUrl: string) => void;
  stopIncomingCallAlert?: () => void;
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
 * Определяет, запущено ли приложение на мобильном устройстве (телефоне / планшете / Android APK).
 * Используется для отображения функции переворота камеры (только на телефонах) и скрытия ПК-настроек.
 */
export function isMobilePhoneDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const platform = detectRuntimePlatform();
  if (platform === 'desktop-exe') return false;
  if (platform === 'android-apk') return true;
  const ua = navigator.userAgent || '';
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)) {
    return true;
  }
  if (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0 && window.innerWidth <= 900) {
    return true;
  }
  return false;
}

/**
 * Определяет, запущено ли приложение на ПК (Windows .exe или настольный браузер ПК).
 */
export function isDesktopOrPcDevice(): boolean {
  if (typeof window === 'undefined') return true;
  const platform = detectRuntimePlatform();
  if (platform === 'desktop-exe') return true;
  if (platform === 'android-apk') return false;
  return !isMobilePhoneDevice();
}

let autoRequestInitialized = false;

export async function requestPermissionNow(): Promise<'granted' | 'denied' | 'default'> {
  if (typeof window === 'undefined') return 'default';

  const platform = detectRuntimePlatform();

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

  void requestPermissionNow();

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
    if (window.PixChatsAndroid?.showNotification) {
      try {
        window.PixChatsAndroid.showNotification(title, body, url);
        return;
      } catch {}
    }

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
      } catch {}
    }
  }

  // 3. Стандартный Web Notification API / Service Worker
  if ('Notification' in window) {
    if (Notification.permission === 'default') {
      await requestPermissionNow();
    }
    if (Notification.permission === 'granted') {
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
      const iconUrl = `${basePath}/icon.svg`;

      try {
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg && typeof reg.showNotification === 'function') {
            await reg.showNotification(title, {
              body,
              icon: iconUrl,
              badge: iconUrl,
              silent,
              data: { url },
            });
            return;
          }
        }
      } catch {
        // fallback к конструктору Notification
      }

      try {
        const notif = new Notification(title, {
          body,
          icon: iconUrl,
          silent,
        });
        notif.onclick = () => {
          window.focus();
          if (onNavigate) onNavigate(url);
        };
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Вызывает нативный входящий звонок на всех платформах:
 * - На Android (.apk): запускает системный рингтон телефона, вибрацию, будит экран и разворачивает окно поверх блокировки
 * - На Windows (.exe): разворачивает окно из системного трея на передний план и показывает системный Toast
 * - В браузере (Web / Mobile Web): включает вибрацию и показывает неотключаемое уведомление о звонке
 */
export async function triggerIncomingCallNativeAlert(options: {
  callerName: string;
  mode: 'audio' | 'video';
  chatId?: string;
  silent?: boolean;
}): Promise<void> {
  if (typeof window === 'undefined') return;

  const targetUrl = options.chatId ? `/chat/?id=${options.chatId}` : '/chats/';

  // Вибрация на мобильных браузерах и Android
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([700, 350, 700, 350, 700, 350, 700]);
    }
  } catch {}

  // 1. Android APK: нативный рингтон телефона + FullScreen Intent + пробуждение экрана
  if (window.PixChatsAndroid?.showIncomingCallNotification) {
    try {
      window.PixChatsAndroid.showIncomingCallNotification(
        options.callerName,
        options.mode,
        targetUrl
      );
      return;
    } catch {}
  }

  // 2. Windows EXE: выход из системного трея на передний план + Toast
  if (window.pixchatsDesktop?.notifyIncomingCall) {
    try {
      await window.pixchatsDesktop.notifyIncomingCall({
        callerName: options.callerName,
        mode: options.mode,
        chatId: options.chatId,
      });
      return;
    } catch {}
  }

  // 3. Web / Mobile Web: системное уведомление с requireInteraction
  await sendNativeOrWebNotification({
    title: options.mode === 'video' ? '📹 Входящий видеозвонок' : '📞 Входящий звонок',
    body: `${options.callerName} звонит вам в PixChats — нажмите, чтобы ответить`,
    url: targetUrl,
    silent: options.silent,
  });
}

/**
 * Останавливает нативный рингтон и вибрацию входящего звонка на телефоне.
 */
export function stopIncomingCallNativeAlert(): void {
  if (typeof window === 'undefined') return;
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(0);
    }
  } catch {}
  try {
    window.PixChatsAndroid?.stopIncomingCallAlert?.();
  } catch {}
}
