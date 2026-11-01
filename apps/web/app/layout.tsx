import './globals.css';
import { NotificationListener } from '../components/NotificationListener';
import { UpdateNotifier } from '../components/UpdateNotifier';
import { ThemeManager } from '../components/ThemeManager';
import { CallManager } from '../components/CallManager';
import { AppLockGuard } from '../components/AppLockGuard';
import { MiniAudioPlayer } from '../components/MiniAudioPlayer';
import { DownloadAppModal } from '../components/DownloadAppModal';

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
        {/* Применяем сохранённую тему и включаем авто-полноэкранный режим на смартфонах */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('pixchats:theme') || 'pixchats';
                  document.documentElement.setAttribute('data-theme', theme);
                } catch (e) {}

                function tryMobileFullscreen() {
                  if (window.innerWidth <= 768 && document.documentElement.requestFullscreen && !document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(function(){});
                  }
                }
                window.addEventListener('touchstart', tryMobileFullscreen, { once: true, passive: true });
                window.addEventListener('click', tryMobileFullscreen, { once: true });
              })();
            `,
          }}
        />
      </head>
      <body>
        <ThemeManager />
        <AppLockGuard />
        {children}
        <MiniAudioPlayer />
        <DownloadAppModal />
        <NotificationListener />
        <CallManager />
        <UpdateNotifier />
      </body>
    </html>
  );
}
