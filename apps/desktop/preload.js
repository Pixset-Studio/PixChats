// Нативный Preload-мост между процессом Windows (Electron Main) и клиентским интерфейсом PixChats.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pixchatsDesktop', {
  isDesktop: true,
  platform: process.platform,

  /** Отправить нативное системное уведомление Windows 10/11 */
  sendNotification: (payload) => ipcRenderer.invoke('pixchats:notify', payload),

  /** Разбудить окно из фонового режима и показать уведомление при входящем звонке */
  notifyIncomingCall: (payload) => ipcRenderer.invoke('pixchats:incoming-call', payload),

  /** Автоматически запросить/подтвердить системное разрешение на уведомления */
  requestNotificationPermission: () => ipcRenderer.invoke('pixchats:request-permission'),

  /** Проверить статус автозапуска при старте компьютера */
  getAutoStartEnabled: () => ipcRenderer.invoke('pixchats:get-autostart'),

  /** Включить или выключить автозапуск при старте компьютера (в фоновом режиме) */
  setAutoStartEnabled: (enabled) => ipcRenderer.invoke('pixchats:set-autostart', Boolean(enabled)),

  /** Скачать и автоматически запустить инсталлятор обновления .exe */
  installUpdate: (downloadUrl, fileName) =>
    ipcRenderer.invoke('pixchats:install-update', { downloadUrl, fileName }),

  /** Подписка на переход в нужный чат при клике по системному уведомлению Windows */
  onNavigate: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, url) => callback(url);
    ipcRenderer.on('pixchats:navigate', handler);
    return () => ipcRenderer.removeListener('pixchats:navigate', handler);
  },
});
