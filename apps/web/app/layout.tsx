import './globals.css';
import { NotificationListener } from '../components/NotificationListener';
import { UpdateNotifier } from '../components/UpdateNotifier';
import { ThemeManager } from '../components/ThemeManager';
import { CallManager } from '../components/CallManager';
import { AppLockGuard } from '../components/AppLockGuard';
import { MiniAudioPlayer } from '../components/MiniAudioPlayer';
import { DownloadAppModal } from '../components/DownloadAppModal';
import { PersistentAppShell } from '../components/DesktopShell';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://pixchats.app'),
  title: 'PixChats',
  description: 'Мессенджер PixChats — веб-клиент для обмена сообщениями, каналов и групп.',
  openGraph: {
    title: 'PixChats',
    description: 'Мессенджер PixChats — веб-клиент для обмена сообщениями, каналов и групп.',
    images: [`${BASE_PATH}/logo/icon.png`],
  },
  icons: {
    icon: `${BASE_PATH}/logo/icon.png`,
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#09090b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <link rel="icon" href={`${BASE_PATH}/logo/icon.png`} />
        <link rel="manifest" href={`${BASE_PATH}/manifest.json`} />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="PixChats" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Press+Start+2P&family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
        {/* Применяем сохранённую тему и исправляем RSC-запросы статического экспорта (GitHub Pages / Electron / Capacitor), чтобы клики по ссылкам никогда не вызывали полную перезагрузку страницы */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('pixchats:theme') || 'pixchats';
                  document.documentElement.setAttribute('data-theme', theme);
                } catch (e) {}

                try {
                  if (typeof window !== 'undefined' && window.fetch && !window.__pixchatsRscPatched) {
                    window.__pixchatsRscPatched = true;
                    var origFetch = window.fetch.bind(window);
                    window.fetch = function(input, init) {
                      try {
                        var urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : '');
                        var headers = (init && init.headers) || (input && input.headers);
                        var isRsc = false;
                        if (urlStr && urlStr.indexOf('_rsc=') !== -1) isRsc = true;
                        if (!isRsc && headers) {
                          if (typeof headers.get === 'function') {
                            isRsc = headers.get('RSC') === '1' || headers.get('rsc') === '1';
                          } else if (typeof headers === 'object') {
                            isRsc = headers['RSC'] === '1' || headers['rsc'] === '1';
                          }
                        }
                        if (isRsc && urlStr) {
                          var u = new URL(urlStr, window.location.origin);
                          if (u.origin === window.location.origin && !u.pathname.endsWith('.txt')) {
                            return origFetch(input, init).then(function(res) {
                              var ct = (res.headers && res.headers.get('content-type')) || '';
                              if (res.ok && ct.indexOf('text/x-component') !== -1) {
                                return res;
                              }
                              var cleanPath = u.pathname.replace(/\\/+$/, '');
                              var txtUrl = (cleanPath || '') + '/index.txt' + u.search;
                              return origFetch(txtUrl, init).then(function(txtRes) {
                                if (!txtRes.ok) return res;
                                return txtRes.text().then(function(bodyText) {
                                  if (bodyText.trim().indexOf('<') === 0) return res;
                                  return new Response(bodyText, {
                                    status: 200,
                                    headers: { 'Content-Type': 'text/x-component; charset=utf-8' }
                                  });
                                });
                              }).catch(function() { return res; });
                            });
                          }
                        }
                      } catch (e) {}
                      return origFetch(input, init);
                    };
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        <ThemeManager />
        <AppLockGuard />
        <PersistentAppShell>{children}</PersistentAppShell>
        <MiniAudioPlayer />
        <DownloadAppModal />
        <NotificationListener />
        <CallManager />
        <UpdateNotifier />
      </body>
    </html>
  );
}
