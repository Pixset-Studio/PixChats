// Нативный Preload-мост между процессом Windows (Electron Main) и клиентским интерфейсом PixChats.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pixchatsDesktop', {
  isDesktop: true,
  platform: process.platform,

  /** Отправить нативное системное уведомление Windows 10/11 */
  sendNotification: (payload) => ipcRenderer.invoke('pixchats:notify', payload),

  /** Автоматически запросить/подтвердить системное разрешение на уведомления */
  requestNotificationPermission: () => ipcRenderer.invoke('pixchats:request-permission'),

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
