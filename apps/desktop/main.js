// PixChats Desktop (Electron)
//
// Почему через локальный HTTP-сервер, а не file://:
// Next.js static export делает client-side навигацию через History API
// (pushState) — под file:// у Chromium это часто работает нестабильно
// (origin = null). Поднимаем локальный статический сервер на 127.0.0.1
// и грузим страницу через http:// — так навигация и Supabase-запросы
// (CORS уже настроен на любой источник) работают предсказуемо.

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

const WEB_DIST = path.join(__dirname, 'web-dist');
const PORT = 47821; // невидный локальный порт, чтобы не конфликтовать с другими программами

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

      // Next static export кладёт страницы как /route/index.html (trailingSlash: true).
      // Если запросили путь без расширения и без слэша — пробуем добавить index.html.
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
          // SPA-фолбэк на 404.html, чтобы не ломать прямую загрузку query-роутов вроде /chat/?id=...
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 500,
    icon: path.join(__dirname, 'build', 'icon-256.png'),
    autoHideMenuBar: true,
    backgroundColor: '#0f1117', // фон темы PixChats — без белой вспышки при старте
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(`http://127.0.0.1:${PORT}/`);

  // Внешние ссылки (например, из письма или "Скопировать ссылку") — в обычном браузере,
  // а не в новом окне Electron.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${PORT}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

app.whenReady().then(async () => {
  await startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
