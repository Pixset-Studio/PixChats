/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,        // ссылки вида /chats/ вместо /chats — так GitHub Pages отдаёт index.html корректно
  images: {
    unoptimized: true,        // next/image без серверной оптимизации — на статике её нет
  },
  // @pixchats/core — локальный workspace-пакет, экспортируется как сырой .ts (см. main в его package.json).
  // Next.js по умолчанию транспилирует только код внутри apps/web, поэтому пакет нужно явно перечислить,
  // иначе сборка падает на попытке распарсить TypeScript-синтаксис как обычный JS.
  transpilePackages: ['@pixchats/core'],
  // GitHub Pages отдаёт публичный (не user/organization) репозиторий по адресу
  // https://<username>.github.io/<repo-name>/ — значит все ссылки на статику должны
  // учитывать этот префикс. Задаётся переменной окружения при сборке в CI (см. workflow).
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  assetPrefix: process.env.NEXT_PUBLIC_BASE_PATH || '',
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION || '0.2.0',
    NEXT_PUBLIC_BUILD_SHA: process.env.NEXT_PUBLIC_BUILD_SHA || '',
    NEXT_PUBLIC_BUILD_TIMESTAMP: process.env.NEXT_PUBLIC_BUILD_TIMESTAMP || new Date().toISOString(),
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  },
};

module.exports = nextConfig;

