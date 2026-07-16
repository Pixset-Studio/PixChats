/**
 * На GitHub Pages сайт живёт под /<repo-name>/, а не в корне домена.
 * NEXT_PUBLIC_BASE_PATH подставляется в CI (см. .github/workflows/deploy.yml)
 * и должна использоваться в любых абсолютных ссылках вида window.location.origin + путь.
 * На Vercel/Netlify/локально NEXT_PUBLIC_BASE_PATH пустая — buildAppUrl ведёт себя как обычно.
 */
export function buildAppUrl(path: string): string {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  return window.location.origin + basePath + path;
}
