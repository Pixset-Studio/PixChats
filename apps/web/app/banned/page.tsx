'use client';

export default function BannedPage() {
  return (
    <main className="page-center">
      <div className="container-narrow card" style={{ textAlign: 'center' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--danger)' }}>Аккаунт заблокирован</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Ваш аккаунт заблокирован администрацией PixChats. Если вы считаете, что это ошибка — обратитесь в
          поддержку.
        </p>
      </div>
    </main>
  );
}
