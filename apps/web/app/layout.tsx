import './globals.css';
import { NotificationListener } from '../components/NotificationListener';
import { UpdateNotifier } from '../components/UpdateNotifier';

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <link rel="icon" href={`${BASE_PATH}/logo/icon.png`} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* Применяем сохранённую тему до первой отрисовки — иначе будет вспышка дефолтной темы */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('pixchats:theme') || 'pixchats';
                  document.documentElement.setAttribute('data-theme', theme);
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        {children}
        <NotificationListener />
        <UpdateNotifier />
      </body>
    </html>
  );
}
