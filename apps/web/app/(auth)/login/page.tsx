'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  signInWithEmail,
  signInWithGoogle,
  signInWithVK,
  signInWithYandex,
  requestLoginCode,
  verifyLoginCode,
} from '@pixchats/core';
import { buildAppUrl } from '../../../lib/url';
import { isRussianVisitor } from '../../../lib/geo';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'password' | 'code'>('password');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hideGoogle, setHideGoogle] = useState(false);

  useEffect(() => {
    isRussianVisitor().then(setHideGoogle);
  }, []);

  async function handlePasswordSubmit(e: React.FormEvent) {
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

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await requestLoginCode(email);
      setCodeSent(true);
      setNotice('Код отправлен на почту — введите его ниже');
    } catch (err: any) {
      setError(err.message ?? 'Не удалось отправить код');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await verifyLoginCode(email, code);
      router.push('/chats');
    } catch (err: any) {
      setError(err.message ?? 'Неверный код');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-center">
      <div className="container-narrow">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <span className="brand">
            PixChats<span className="brand-dot" />
          </span>
        </div>

        <div className="card">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 0 }}>Вход</h1>

          <div className="btn-row" style={{ flexDirection: 'row', marginBottom: 16 }}>
            <button
              className="btn"
              style={{ borderColor: mode === 'password' ? 'var(--accent)' : undefined }}
              onClick={() => {
                setMode('password');
                setError(null);
                setNotice(null);
              }}
            >
              Пароль
            </button>
            <button
              className="btn"
              style={{ borderColor: mode === 'code' ? 'var(--accent)' : undefined }}
              onClick={() => {
                setMode('code');
                setError(null);
                setNotice(null);
              }}
            >
              Код с почты
            </button>
          </div>

          {mode === 'password' ? (
            <form onSubmit={handlePasswordSubmit}>
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
                />
              </div>

              {error && <p className="error">{error}</p>}

              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Входим…' : 'Войти'}
              </button>
            </form>
          ) : !codeSent ? (
            <form onSubmit={handleSendCode}>
              <div className="field">
                <label>Email</label>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>

              {error && <p className="error">{error}</p>}
              {notice && <p className="notice">{notice}</p>}

              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Отправляем…' : 'Отправить код'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode}>
              <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Код отправлен на {email}</p>
              <div className="field">
                <label>Код из письма</label>
                <input className="input" value={code} onChange={(e) => setCode(e.target.value)} required />
              </div>

              {error && <p className="error">{error}</p>}

              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Проверяем…' : 'Войти по коду'}
              </button>
            </form>
          )}

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
        </div>

        <p className="muted-link">
          Нет аккаунта? <Link href="/register">Зарегистрироваться</Link>
        </p>
      </div>
    </main>
  );
}
