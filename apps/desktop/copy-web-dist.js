// Копирует статическую выгрузку Next.js (apps/web/out, собранную БЕЗ basePath —
// см. build:web в package.json) в apps/desktop/web-dist, откуда её грузит Electron.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'web', 'out');
const dest = path.join(__dirname, 'web-dist');

if (!fs.existsSync(src)) {
  console.error('Не найдена папка apps/web/out — сначала выполните npm run build:web');
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log('Скопировано apps/web/out -> apps/desktop/web-dist');
