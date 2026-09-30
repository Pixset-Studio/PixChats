// Копирует статическую выгрузку Next.js (apps/web/out, собранную БЕЗ basePath)
// в apps/mobile/www — именно эту папку Capacitor упаковывает внутрь APK (webDir в capacitor.config.ts).
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'web', 'out');
const dest = path.join(__dirname, 'www');

if (!fs.existsSync(src)) {
  console.error('Не найдена папка apps/web/out — сначала выполните npm run build:web');
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log('Скопировано apps/web/out -> apps/mobile/www');
