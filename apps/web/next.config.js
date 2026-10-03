/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',           // статическая выгрузка — то, что умеет отдавать GitHub Pages
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
  experimental: {
    // Включаем поддержку динамических маршрутов с пустым generateStaticParams
    staticGenerationRetryCount: 1,
  },
};

module.exports = nextConfig;
