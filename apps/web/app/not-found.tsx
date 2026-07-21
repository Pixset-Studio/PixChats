'use client';

import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="page-center">
      <div className="container-narrow card" style={{ textAlign: 'center' }}>
        <span className="brand" style={{ fontSize: 20 }}>
          PixChats<span className="brand-dot" />
        </span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, marginTop: 16 }}>404</h1>
        <p style={{ color: 'var(--text-muted)' }}>Такой страницы не существует.</p>
        <Link href="/chats" className="btn btn-primary" style={{ marginTop: 12 }}>
          На главную
        </Link>
      </div>
    </main>
  );
}
