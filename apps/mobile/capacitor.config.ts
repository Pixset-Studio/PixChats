import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'studio.pixset.pixchats',
  appName: 'PixChats',
  webDir: 'www',
  server: {
    // https-схема внутри WebView — нужна, чтобы работали getUserMedia (голосовые
    // сообщения), Notification API и Web Crypto (будущее E2E) — они требуют
    // "безопасный контекст", а дефолтная http://localhost его не всегда даёт.
    androidScheme: 'https',
  },
  android: {
    // Разрешаем WebView открывать внешние https-ресурсы (Supabase API, шрифты Google)
    allowMixedContent: false,
  },
};

export default config;
