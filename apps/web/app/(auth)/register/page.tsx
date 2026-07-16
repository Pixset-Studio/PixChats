'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signUpWithEmail, signInWithGoogle, signInWithVK, signInWithYandex, checkUsernameAvailable } from '@pixchats/core';
import { buildAppUrl } from '../../../lib/url';

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Проверка username с debounce
  useEffect(() => {
    if (!username) {
      setUsernameStatus('idle');
      return;
    }
    setUsernameStatus('checking');
    const timeout = setTimeout(async () => {
      try {
        const result = await checkUsernameAvailable(username);
        if (result.available) setUsernameStatus('ok');
        else setUsernameStatus(result.reason === 'invalid_format' ? 'invalid' : 'taken');
      } catch {
        setUsernameStatus('idle');
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [username]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (usernameStatus !== 'ok') {
      setError('Проверьте юзернейм — он должен быть свободен и корректного формата');
      return;
    }

    setLoading(true);
    try {
      await signUpWithEmail({ email, password, username, displayName });
      router.push('/chats');
    } catch (err: any) {
      setError(err.message ?? 'Не удалось зарегистрироваться');
    } finally {
      setLoading(false);
    }
  }

  const usernameHint: Record<typeof usernameStatus, string> = {
    idle: '',
    checking: 'Проверяем...',
    ok: '✓ Юзернейм свободен',
    taken: '✗ Уже занят',
    invalid: '✗ 5-32 символа: латиница, цифры, _',
  };

  return (
    <main style={{ maxWidth: 400, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <h1>Регистрация в PixChats</h1>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label>Юзернейм</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>@</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
              placeholder="pixset"
              required
            />
          </div>
          {usernameStatus !== 'idle' && (
            <small style={{ color: usernameStatus === 'ok' ? 'green' : usernameStatus === 'checking' ? 'gray' : 'crimson' }}>
              {usernameHint[usernameStatus]}
            </small>
          )}
        </div>

        <div>
          <label>Отображаемое имя</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </div>

        <div>
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>

        <div>
          <label>Пароль</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </div>

        {error && <p style={{ color: 'crimson' }}>{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Регистрация...' : 'Зарегистрироваться'}
        </button>
      </form>

      <hr style={{ margin: '24px 0' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button onClick={() => signInWithGoogle(buildAppUrl('/chats/'))}>Войти через Google</button>
        <button onClick={() => signInWithVK(buildAppUrl('/chats/'))}>Войти через VK</button>
        <button onClick={() => signInWithYandex(buildAppUrl('/chats/'))}>Войти через Яндекс</button>
      </div>

      <p style={{ marginTop: 16 }}>
        Уже есть аккаунт? <Link href="/login">Войти</Link>
      </p>
    </main>
  );
}
