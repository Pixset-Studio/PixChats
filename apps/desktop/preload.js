// PixChats Desktop Preload
const { contextBridge, ipcRenderer } = require('electron');

try {
  contextBridge.exposeInMainWorld('pixchatsDesktop', {
    isDesktop: true,
    platform: process.platform,
    version: '0.1.0',
  });
} catch (e) {
  // contextIsolation fallback
}
