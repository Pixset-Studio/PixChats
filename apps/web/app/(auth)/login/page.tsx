'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signInWithEmail, signInWithGoogle, signInWithVK, signInWithYandex } from '@pixchats/core';
import { buildAppUrl } from '../../../lib/url';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signInWithEmail(email, password);
      router.push('/chats');
    } catch (err: any) {
      setError(err.message ?? 'Не удалось войти');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 400, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <h1>Вход в PixChats</h1>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label>Пароль</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>

        {error && <p style={{ color: 'crimson' }}>{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Входим...' : 'Войти'}
        </button>
      </form>

      <hr style={{ margin: '24px 0' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button onClick={() => signInWithGoogle(buildAppUrl('/chats/'))}>Войти через Google</button>
        <button onClick={() => signInWithVK(buildAppUrl('/chats/'))}>Войти через VK</button>
        <button onClick={() => signInWithYandex(buildAppUrl('/chats/'))}>Войти через Яндекс</button>
      </div>

      <p style={{ marginTop: 16 }}>
        Нет аккаунта? <Link href="/register">Зарегистрироваться</Link>
      </p>
    </main>
  );
}
