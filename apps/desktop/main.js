// PixChats Native Desktop Application (Windows .exe / Electron + Win32 IPC)
//
// Нативное десктопное приложение PixChats для Windows:
// - Системные уведомления Windows 10/11 Action Center (через нативный модуль Notification и AppUserModelId)
// - Работа в фоновом режиме в системном трее (System Tray) для приёма уведомлений при закрытом окне
// - Автоматическое предоставление системных разрешений (микрофон, уведомления, буфер обмена)
// - Нативное скачивание и автоматический запуск .exe-обновлений из GitHub Releases

const {
  app,
  BrowserWindow,
  Notification,
  Tray,
  Menu,
  ipcMain,
  session,
  shell,
} = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const APP_ID = 'studio.pixset.pixchats';
const WEB_DIST = path.join(__dirname, 'web-dist');
const PORT = 47821;

// Регистрируем AppUserModelId для нативных уведомлений Windows 10/11
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

let mainWindow = null;
let tray = null;
let isQuitting = false;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';

      let filePath = path.join(WEB_DIST, urlPath);

      if (!path.extname(filePath)) {
        const withIndex = path.join(filePath, 'index.html');
        if (fs.existsSync(withIndex)) {
          filePath = withIndex;
        } else if (fs.existsSync(filePath + '.html')) {
          filePath = filePath + '.html';
        }
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          fs.readFile(path.join(WEB_DIST, '404.html'), (err2, data2) => {
            res.writeHead(err2 ? 404 : 200, { 'Content-Type': 'text/html' });
            res.end(err2 ? 'Not found' : data2);
          });
          return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });

    server.listen(PORT, '127.0.0.1', resolve);
  });
}

function resolveAppIcon() {
  const candidates = [
    path.join(__dirname, 'build', 'icon-256.png'),
    path.join(WEB_DIST, 'logo', 'icon.png'),
    path.join(__dirname, '..', 'web', 'public', 'logo', 'icon.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function downloadFileWithRedirects(url, destPath) {
  return new Promise((resolve, reject) => {
    const request = (currentUrl, redirectsLeft = 5) => {
      if (redirectsLeft <= 0) {
        reject(new Error('Too many redirects'));
        return;
      }
      const client = currentUrl.startsWith('https') ? https : http;
      client
        .get(
          currentUrl,
          { headers: { 'User-Agent': 'PixChats-Native-Updater/1.0' } },
          (res) => {
            if (
              res.statusCode &&
              res.statusCode >= 300 &&
              res.statusCode < 400 &&
              res.headers.location
            ) {
              request(res.headers.location, redirectsLeft - 1);
              return;
            }
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP status ${res.statusCode}`));
              return;
            }
            const fileStream = fs.createWriteStream(destPath);
            res.pipe(fileStream);
            fileStream.on('finish', () => {
              fileStream.close(() => resolve(destPath));
            });
            fileStream.on('error', (err) => {
              fs.unlink(destPath, () => {});
              reject(err);
            });
          }
        )
        .on('error', reject);
    };
    request(url);
  });
}

function registerNativeIpcHandlers() {
  // 1. Нативные системные уведомления Windows (Toast Notifications)
  ipcMain.handle('pixchats:notify', (_event, payload) => {
    try {
      if (!Notification.isSupported()) return false;
      const { title, body, url, silent } = payload || {};
      const iconPath = resolveAppIcon();

      const notif = new Notification({
        title: String(title || 'PixChats'),
        body: String(body || ''),
        silent: Boolean(silent),
        ...(iconPath ? { icon: iconPath } : {}),
      });

      notif.on('click', () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
          if (url) {
            mainWindow.webContents.send('pixchats:navigate', url);
          }
        }
      });

      notif.show();

      // Мигание иконки на панели задач Windows, если окно не в фокусе
      if (mainWindow && !mainWindow.isFocused()) {
        mainWindow.flashFrame(true);
      }
      return true;
    } catch {
      return false;
    }
  });

  // 2. Автоматическое подтверждение разрешения на уведомления
  ipcMain.handle('pixchats:request-permission', () => {
    return 'granted';
  });

  // 3. Нативное скачивание и установка .exe обновления из GitHub Releases
  ipcMain.handle('pixchats:install-update', async (_event, payload) => {
    try {
      const { downloadUrl, fileName } = payload || {};
      if (!downloadUrl) return false;
      const safeName = (fileName || 'PixChats-Setup-Update.exe').replace(/[^a-zA-Z0-9._-]/g, '_');
      const tempInstallerPath = path.join(os.tmpdir(), safeName);

      await downloadFileWithRedirects(downloadUrl, tempInstallerPath);

      // Запускаем скачанный .exe-инсталлятор как отдельный процесс ОС и закрываем приложение для обновления
      const child = spawn(tempInstallerPath, [], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      setTimeout(() => {
        isQuitting = true;
        app.quit();
      }, 600);
      return true;
    } catch {
      return false;
    }
  });
}

function createSystemTray() {
  const iconPath = resolveAppIcon();
  if (!iconPath) return;

  try {
    tray = new Tray(iconPath);
    tray.setToolTip('PixChats — Мессенджер Pixset Studio');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Открыть PixChats',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Выйти из PixChats',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch {
    // ignore tray errors if OS environment lacks system tray
  }
}

function createWindow() {
  const iconPath = resolveAppIcon();
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 420,
    minHeight: 540,
    title: 'PixChats',
    ...(iconPath ? { icon: iconPath } : {}),
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // не замораживать WebSocket/Realtime в фоне для мгновенных уведомлений
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);

  mainWindow.on('focus', () => {
    if (mainWindow) mainWindow.flashFrame(false);
  });

  // При нажатии на крестик сворачиваем в системный трей Windows, чтобы уведомления продолжали приходить
  mainWindow.on('close', (event) => {
    if (!isQuitting && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${PORT}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

// Защита от запуска нескольких копий приложения
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // Автоматически разрешаем все системные права (уведомления, микрофон для ГС, медиа)
    if (session && session.defaultSession) {
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(true);
      });
      session.defaultSession.setPermissionCheckHandler(() => true);
    }

    registerNativeIpcHandlers();
    await startServer();
    createSystemTray();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
