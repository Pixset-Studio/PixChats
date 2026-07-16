export const metadata = {
  title: 'PixChats',
  description: 'Мессенджер PixChats',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
