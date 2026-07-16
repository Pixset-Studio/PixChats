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
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      const result = await signUpWithEmail({ email, password, username, displayName });
      if (result.session) {
        router.push('/chats');
      } else {
        setNotice('Мы отправили письмо для подтверждения на ваш email. Перейдите по ссылке из письма, затем войдите.');
      }
    } catch (err: any) {
      setError(err.message ?? 'Не удалось зарегистрироваться');
    } finally {
      setLoading(false);
    }
  }

  const usernameHintClass =
    usernameStatus === 'ok' ? 'hint hint-ok' : usernameStatus === 'checking' ? 'hint hint-checking' : 'hint hint-error';
  const usernameHintText: Record<typeof usernameStatus, string> = {
    idle: '',
    checking: 'Проверяем…',
    ok: '✓ Юзернейм свободен',
    taken: '✗ Уже занят',
    invalid: '✗ 5-32 символа: латиница, цифры, _',
  };

  return (
    <main className="page-center">
      <div className="container-narrow">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <span className="brand">
            PixChats<span className="brand-dot" />
          </span>
        </div>

        <div className="card">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 0 }}>Регистрация</h1>

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Юзернейм</label>
              <div className="input-prefix">
                <span>@</span>
                <input
                  className="input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
                  placeholder="pixset"
                  required
                />
              </div>
              {usernameStatus !== 'idle' && <p className={usernameHintClass}>{usernameHintText[usernameStatus]}</p>}
            </div>

            <div className="field">
              <label>Отображаемое имя</label>
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            </div>

            <div className="field">
              <label>Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>

            <div className="field">
              <label>Пароль</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>

            {error && <p className="error">{error}</p>}
            {notice && <p className="notice">{notice}</p>}

            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Регистрируем…' : 'Зарегистрироваться'}
            </button>
          </form>

          <hr className="divider" />

          <div className="btn-row">
            <button className="btn" onClick={() => signInWithGoogle(buildAppUrl('/chats/'))}>
              Продолжить с Google
            </button>
            <button className="btn" onClick={() => signInWithVK(buildAppUrl('/chats/'))}>
              Продолжить с VK
            </button>
            <button className="btn" onClick={() => signInWithYandex(buildAppUrl('/chats/'))}>
              Продолжить с Яндекс
            </button>
          </div>
        </div>

        <p className="muted-link">
          Уже есть аккаунт? <Link href="/login">Войти</Link>
        </p>
      </div>
    </main>
  );
}
