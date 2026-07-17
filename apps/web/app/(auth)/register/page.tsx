'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  signUpWithEmail,
  signInWithGoogle,
  signInWithVK,
  signInWithYandex,
  checkUsernameAvailable,
  verifySignupCode,
  ensureKeyBundle,
  getCurrentProfile,
} from '@pixchats/core';
import { buildAppUrl } from '../../../lib/url';
import { isRussianVisitor } from '../../../lib/geo';

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hideGoogle, setHideGoogle] = useState(false);

  // Шаг подтверждения кодом (появляется, если требуется подтверждение email)
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [code, setCode] = useState('');

  useEffect(() => {
    isRussianVisitor().then(setHideGoogle);
  }, []);

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
    if (!privacyAccepted) {
      setError('Нужно принять политику конфиденциальности и согласие на обработку персональных данных');
      return;
    }

    setLoading(true);
    try {
      const result = await signUpWithEmail({ email, password, username, displayName, privacyAccepted });
      if (result.session) {
        router.push('/chats');
      } else {
        setAwaitingCode(true);
      }
    } catch (err: any) {
      setError(err.message ?? 'Не удалось зарегистрироваться');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await verifySignupCode(email, code);
      if (result.user) {
        const profile = await getCurrentProfile();
        if (profile) await ensureKeyBundle(profile);
      }
      router.push('/chats');
    } catch (err: any) {
      setError(err.message ?? 'Неверный код');
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
          {awaitingCode ? (
            <>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 0 }}>Подтвердите почту</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: -8 }}>Код отправлен на {email}</p>
              <form onSubmit={handleVerifyCode}>
                <div className="field">
                  <label>Код из письма</label>
                  <input className="input" value={code} onChange={(e) => setCode(e.target.value)} required />
                </div>
                {error && <p className="error">{error}</p>}
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? 'Проверяем…' : 'Подтвердить'}
                </button>
              </form>
            </>
          ) : (
            <>
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

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, marginBottom: 16, color: 'var(--text-muted)' }}>
                  <input
                    type="checkbox"
                    checked={privacyAccepted}
                    onChange={(e) => setPrivacyAccepted(e.target.checked)}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    Я принимаю{' '}
                    <Link href="/privacy" target="_blank" style={{ color: 'var(--accent)' }}>
                      Политику конфиденциальности
                    </Link>{' '}
                    и даю согласие на обработку персональных данных
                  </span>
                </label>

                {error && <p className="error">{error}</p>}

                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? 'Регистрируем…' : 'Зарегистрироваться'}
                </button>
              </form>

              <hr className="divider" />

              <div className="btn-row">
                {!hideGoogle && (
                  <button className="btn" onClick={() => signInWithGoogle(buildAppUrl('/chats/'))}>
                    Продолжить с Google
                  </button>
                )}
                <button className="btn" onClick={() => signInWithVK(buildAppUrl('/chats/'))}>
                  Продолжить с VK
                </button>
                <button className="btn" onClick={() => signInWithYandex(buildAppUrl('/chats/'))}>
                  Продолжить с Яндекс
                </button>
              </div>
            </>
          )}
        </div>

        {!awaitingCode && (
          <p className="muted-link">
            Уже есть аккаунт? <Link href="/login">Войти</Link>
          </p>
        )}
      </div>
    </main>
  );
}
