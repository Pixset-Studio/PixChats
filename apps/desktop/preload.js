const { contextBridge, ipcRenderer } = require('electron');

// Мост для интеграции веб-клиента PixChats с нативной ОС Windows (.exe):
// - Нативные системные уведомления Windows Action Center (в т.ч. в свёрнутом/фоновом режиме в трее)
// - Входящие звонки поверх окон (разворачивание из трея)
// - Управление автозапуском при старте компьютера
// - Управление запуском в свёрнутом виде на ПК + мгновенное сворачивание/разворачивание окна
// - Автоматическое скачивание и установка обновлений .exe из GitHub Releases
contextBridge.exposeInMainWorld('pixchatsDesktop', {
  isDesktop: true,
  platform: 'win32',
  notify: (payload) => ipcRenderer.invoke('pixchats:notify', payload),
  sendNotification: (payload) => ipcRenderer.invoke('pixchats:notify', payload),
  notifyIncomingCall: (payload) => ipcRenderer.invoke('pixchats:incoming-call', payload),
  getAutoStartEnabled: () => ipcRenderer.invoke('pixchats:get-autostart'),
  setAutoStartEnabled: (enabled) => ipcRenderer.invoke('pixchats:set-autostart', enabled),
  getLaunchMinimizedEnabled: () => ipcRenderer.invoke('pixchats:get-launch-minimized'),
  setLaunchMinimizedEnabled: (enabled) => ipcRenderer.invoke('pixchats:set-launch-minimized', enabled),
  minimizeWindow: () => ipcRenderer.invoke('pixchats:minimize-window'),
  restoreWindow: () => ipcRenderer.invoke('pixchats:restore-window'),
  isWindowMinimized: () => ipcRenderer.invoke('pixchats:is-minimized'),
  requestPermissions: () => ipcRenderer.invoke('pixchats:request-permission'),
  requestNotificationPermission: () => ipcRenderer.invoke('pixchats:request-permission'),
  downloadAndInstallUpdate: (payload) => ipcRenderer.invoke('pixchats:install-update', payload),
  installUpdate: (downloadUrl, fileName) =>
    ipcRenderer.invoke('pixchats:install-update', { downloadUrl, fileName }),
  onNavigate: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, targetUrl) => callback(targetUrl);
    ipcRenderer.on('pixchats:navigate', handler);
    return () => ipcRenderer.removeListener('pixchats:navigate', handler);
  },
});
