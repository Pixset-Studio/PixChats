// PixChats Native Desktop Application (Windows .exe / Electron + Win32 Background Daemon)
//
// Нативное десктопное приложение PixChats для Windows:
// - Автозапуск при старте компьютера (Windows Startup / Run Registry + LoginItemSettings) в фоновом режиме (--autostart-background)
// - Непрерывная работа в фоне в системном трее (System Tray) с защитой от засыпания процесса (powerSaveBlocker)
// - Мгновенный приём сообщений, звонков и любых других уведомлений в фоновом режиме 24/7
// - Автоматическое разворачивание окна поверх экрана при входящем звонке
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
  powerSaveBlocker,
} = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');

const APP_ID = 'studio.pixset.pixchats';
const WEB_DIST = path.join(__dirname, 'web-dist');
const PORT = 47821;

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

let mainWindow = null;
let tray = null;
let isQuitting = false;
let hasShownTrayHint = false;
let powerSaveId = null;

function getConfigFilePath() {
  try {
    return path.join(app.getPath('userData'), 'pixchats-desktop-config.json');
  } catch {
    return path.join(os.tmpdir(), 'pixchats-desktop-config.json');
  }
}

function readDesktopConfig() {
  try {
    const file = getConfigFilePath();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch {}
  return { autoStart: true };
}

function writeDesktopConfig(patch) {
  try {
    const current = readDesktopConfig();
    const next = { ...current, ...patch };
    fs.writeFileSync(getConfigFilePath(), JSON.stringify(next, null, 2), 'utf8');
    return next;
  } catch {
    return readDesktopConfig();
  }
}

/**
 * Включает или выключает автозапуск PixChats при старте Windows (с запуском в фоновом режиме).
 */
function configureAutoStartOnBoot(enable = true) {
  writeDesktopConfig({ autoStart: Boolean(enable) });

  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enable),
      openAsHidden: true,
      path: process.execPath,
      args: ['--autostart-background'],
    });
  } catch {}

  // Дополнительно прописываем в реестр Windows HKCU\Software\Microsoft\Windows\CurrentVersion\Run
  // чтобы автозапуск гарантированно работал на всех редакциях Windows 10/11
  if (process.platform === 'win32' && app.isPackaged) {
    const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    if (enable) {
      const cmdValue = `"${process.execPath}" --autostart-background`;
      execFile(
        'reg.exe',
        ['add', regKey, '/v', 'PixChats', '/t', 'REG_SZ', '/d', cmdValue, '/f'],
        () => {}
      );
    } else {
      execFile('reg.exe', ['delete', regKey, '/v', 'PixChats', '/f'], () => {});
    }
  }

  rebuildTrayMenu();
}

function isStartedInBackground() {
  const args = process.argv.map((a) => String(a).toLowerCase());
  if (args.includes('--autostart-background') || args.includes('--hidden') || args.includes('--background')) {
    return true;
  }
  try {
    const loginSettings = app.getLoginItemSettings();
    if (loginSettings && loginSettings.wasOpenedAsHidden) return true;
  } catch {}
  return false;
}

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

function emitUpdateProgress(percent, status = 'downloading') {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents
      .executeJavaScript(
        `window.dispatchEvent(new CustomEvent('pixchats:update_progress', { detail: { percent: ${Number(percent) || 0}, status: '${status}' } }));`
      )
      .catch(() => {});
  } catch {}
}

function downloadFileWithRedirects(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const request = (currentUrl, redirectsLeft = 7) => {
      if (redirectsLeft <= 0) {
        reject(new Error('Too many redirects'));
        return;
      }
      const client = currentUrl.startsWith('https') ? https : http;
      client
        .get(
          currentUrl,
          { headers: { 'User-Agent': 'PixChats-Native-Updater/2.0' } },
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
            const totalBytes = parseInt(res.headers['content-length'] || '0', 10) || 0;
            let downloadedBytes = 0;
            let lastPercent = -1;

            const fileStream = fs.createWriteStream(destPath);
            res.on('data', (chunk) => {
              downloadedBytes += chunk.length;
              if (totalBytes > 0 && typeof onProgress === 'function') {
                const pct = Math.min(99, Math.round((downloadedBytes * 100) / totalBytes));
                if (pct !== lastPercent) {
                  lastPercent = pct;
                  onProgress(pct);
                }
              }
            });
            res.pipe(fileStream);
            fileStream.on('finish', () => {
              if (typeof onProgress === 'function') onProgress(100);
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

function showAndFocusMainWindow(targetUrl) {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (targetUrl) {
    mainWindow.webContents.send('pixchats:navigate', targetUrl);
  }
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
        showAndFocusMainWindow(url);
      });

      notif.show();

      if (mainWindow && !mainWindow.isFocused()) {
        mainWindow.flashFrame(true);
      }
      return true;
    } catch {
      return false;
    }
  });

  // 2. Входящий звонок из фонового режима — разворачивает окно поверх экрана + системное уведомление
  ipcMain.handle('pixchats:incoming-call', (_event, payload) => {
    try {
      const { callerName, mode, chatId } = payload || {};
      const iconPath = resolveAppIcon();

      if (Notification.isSupported()) {
        const callLabel = mode === 'video' ? '📹 Входящий видеозвонок' : '📞 Входящий аудиозвонок';
        const notif = new Notification({
          title: callLabel,
          body: `${callerName || 'Собеседник'} звонит вам в PixChats`,
          silent: false,
          ...(iconPath ? { icon: iconPath } : {}),
        });
        notif.on('click', () => {
          showAndFocusMainWindow(chatId ? `/chat/?id=${chatId}` : undefined);
        });
        notif.show();
      }

      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.flashFrame(true);
        mainWindow.setAlwaysOnTop(true);
        setTimeout(() => {
          if (mainWindow) mainWindow.setAlwaysOnTop(false);
        }, 3000);
      }
      return true;
    } catch {
      return false;
    }
  });

  // 3. Управление автозапуском с Windows
  ipcMain.handle('pixchats:get-autostart', () => {
    const cfg = readDesktopConfig();
    return cfg.autoStart !== false;
  });

  ipcMain.handle('pixchats:set-autostart', (_event, enabled) => {
    configureAutoStartOnBoot(Boolean(enabled));
    return Boolean(enabled);
  });

  // 4. Автоматическое подтверждение разрешения на уведомления
  ipcMain.handle('pixchats:request-permission', () => {
    return 'granted';
  });

  // 5. Полностью автоматическое тихое скачивание, самоустановка (/S) и перезапуск .exe обновления
  ipcMain.handle('pixchats:install-update', async (_event, payload) => {
    try {
      const { downloadUrl, fileName } = payload || {};
      if (!downloadUrl) return false;
      const safeName = (fileName || 'PixChats-Setup-Update.exe').replace(/[^a-zA-Z0-9._-]/g, '_');
      const tempInstallerPath = path.join(os.tmpdir(), safeName);

      emitUpdateProgress(2, 'downloading');
      await downloadFileWithRedirects(downloadUrl, tempInstallerPath, (pct) => {
        emitUpdateProgress(pct, 'downloading');
      });
      emitUpdateProgress(100, 'installing');

      if (process.platform === 'win32') {
        const updaterCmdPath = path.join(os.tmpdir(), 'pixchats-silent-auto-update.cmd');
        const currentExe = process.execPath;
        const scriptLines = [
          '@echo off',
          'timeout /t 2 /nobreak >nul',
          `"${tempInstallerPath}" /S`,
          `if exist "${currentExe}" (`,
          `  start "" "${currentExe}"`,
          ') else if exist "%LOCALAPPDATA%\\Programs\\pixchats-desktop\\PixChats.exe" (',
          '  start "" "%LOCALAPPDATA%\\Programs\\pixchats-desktop\\PixChats.exe"',
          ') else if exist "%LOCALAPPDATA%\\Programs\\PixChats\\PixChats.exe" (',
          '  start "" "%LOCALAPPDATA%\\Programs\\PixChats\\PixChats.exe"',
          ')',
          `del /q "${tempInstallerPath}" >nul 2>&1`,
          'del /q "%~f0" >nul 2>&1',
        ];
        fs.writeFileSync(updaterCmdPath, scriptLines.join('\r\n'), 'utf8');

        const child = spawn('cmd.exe', ['/c', updaterCmdPath], {
          detached: true,
          windowsHide: true,
          stdio: 'ignore',
        });
        child.unref();
      } else {
        const child = spawn(tempInstallerPath, ['/S'], {
          detached: true,
          windowsHide: true,
          stdio: 'ignore',
        });
        child.unref();
      }

      setTimeout(() => {
        isQuitting = true;
        app.quit();
      }, 500);
      return true;
    } catch {
      return false;
    }
  });
}

function rebuildTrayMenu() {
  if (!tray) return;
  const cfg = readDesktopConfig();
  const autoStartEnabled = cfg.autoStart !== false;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Открыть PixChats',
      click: () => showAndFocusMainWindow(),
    },
    {
      label: 'Запускать при старте ПК (в фоне)',
      type: 'checkbox',
      checked: autoStartEnabled,
      click: (menuItem) => {
        configureAutoStartOnBoot(menuItem.checked);
      },
    },
    { type: 'separator' },
    {
      label: 'Выйти полностью',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function createSystemTray() {
  const iconPath = resolveAppIcon();
  if (!iconPath) return;

  try {
    tray = new Tray(iconPath);
    tray.setToolTip('PixChats — работает в фоне (ожидание сообщений и звонков)');
    rebuildTrayMenu();

    tray.on('click', () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        showAndFocusMainWindow();
      }
    });
  } catch {
    // ignore tray errors
  }
}

function createWindow(startHidden = false) {
  const iconPath = resolveAppIcon();
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 420,
    minHeight: 540,
    show: !startHidden,
    title: 'PixChats',
    ...(iconPath ? { icon: iconPath } : {}),
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // не замораживать процесс в фоне — держим живое соединение для сообщений и звонков
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);

  mainWindow.on('focus', () => {
    if (mainWindow) mainWindow.flashFrame(false);
  });

  // При нажатии на крестик приложение не закрывается, а остаётся работать в фоне в системном трее
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();

      if (!hasShownTrayHint && Notification.isSupported()) {
        hasShownTrayHint = true;
        try {
          new Notification({
            title: 'PixChats работает в фоне',
            body: 'Приложение свёрнуто в системный трей и продолжает принимать сообщения, звонки и уведомления.',
            silent: true,
            ...(iconPath ? { icon: iconPath } : {}),
          }).show();
        } catch {}
      }
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

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showAndFocusMainWindow();
  });

  app.whenReady().then(async () => {
    // Запрещаем ОС усыплять фоновый процесс PixChats, чтобы уведомления и звонки приходили мгновенно
    try {
      powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
    } catch {}

    // Включаем автозапуск с Windows по умолчанию (если пользователь сам его не отключил)
    const cfg = readDesktopConfig();
    configureAutoStartOnBoot(cfg.autoStart !== false);

    // Автоматически предоставляем все системные разрешения (микрофон, камера для звонков, экран, уведомления)
    if (session && session.defaultSession) {
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(true);
      });
      session.defaultSession.setPermissionCheckHandler(() => true);
    }

    registerNativeIpcHandlers();
    await startServer();
    createSystemTray();

    // Если приложение было запущено системой при старте компьютера (--autostart-background),
    // оно тихо стартует в фоновом режиме в трее и ждёт новых сообщений/звонков.
    const startHidden = isStartedInBackground();
    createWindow(startHidden);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(false);
      } else {
        showAndFocusMainWindow();
      }
    });
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  if (powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId);
  }
});

app.on('window-all-closed', () => {
  // Не завершаем процесс при закрытии окон на Windows, пока приложение работает в фоне в трее
  if (isQuitting && process.platform !== 'darwin') {
    app.quit();
  }
});
