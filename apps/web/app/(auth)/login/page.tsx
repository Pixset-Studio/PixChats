'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  signInWithEmail,
  signInWithGoogle,
  requestLoginCode,
  verifyLoginCode,
  signInWithPixsetStudioAccount,
} from '@pixchats/core';
import { buildAppUrl } from '../../../lib/url';
import { isRussianVisitor } from '../../../lib/geo';
import { buildQrMatrix, generateQrSessionCode, listenForQrLoginApproval } from '../../../lib/qrAuth';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'password' | 'code' | 'qr' | 'pixset'>('password');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);

  // QR-код для мгновенного входа с телефона
  const [qrCode, setQrCode] = useState<string>(() => generateQrSessionCode());

  // Pixset Studio Login State
  const [pixsetLogin, setPixsetLogin] = useState('');
  const [pixsetPassword, setPixsetPassword] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hideGoogle, setHideGoogle] = useState(false);

  useEffect(() => {
    isRussianVisitor().then(setHideGoogle);
  }, []);

  useEffect(() => {
    if (mode !== 'qr') return;
    const stop = listenForQrLoginApproval(
      qrCode,
      ({ deviceName }) => {
        setNotice(`✅ Вход подтверждён с устройства «${deviceName}»! Переходим в чаты…`);
        router.push('/chats');
      },
      (errMsg) => setError(errMsg)
    );
    return () => stop();
  }, [mode, qrCode, router]);

  const qrMatrix = useMemo(() => buildQrMatrix(qrCode), [qrCode]);

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

  async function handlePixsetSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signInWithPixsetStudioAccount(pixsetLogin, pixsetPassword);
      router.push('/chats');
    } catch (err: any) {
      setError(err.message ?? 'Не удалось войти через учётную запись Pixset Studio');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-center">
      <div className="container-narrow">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <span className="brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <img src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/logo/icon.png`} alt="" width={26} height={26} />
            PixChats
          </span>
        </div>

        <div className="card">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 0 }}>
            {mode === 'pixset' ? 'Вход через Pixset Studio' : 'Вход'}
          </h1>

          {mode !== 'pixset' && (
            <div className="btn-row" style={{ flexDirection: 'row', marginBottom: 16, gap: 6 }}>
              <button
                type="button"
                className="btn"
                style={{
                  borderColor: mode === 'password' ? 'var(--accent)' : undefined,
                  color: mode === 'password' ? 'var(--accent)' : undefined,
                  padding: '9px 10px',
                  fontSize: 13,
                }}
                onClick={() => {
                  setMode('password');
                  setError(null);
                  setNotice(null);
                }}
              >
                Пароль
              </button>
              <button
                type="button"
                className="btn"
                style={{
                  borderColor: mode === 'code' ? 'var(--accent)' : undefined,
                  color: mode === 'code' ? 'var(--accent)' : undefined,
                  padding: '9px 10px',
                  fontSize: 13,
                }}
                onClick={() => {
                  setMode('code');
                  setError(null);
                  setNotice(null);
                }}
              >
                Код с почты
              </button>
              <button
                type="button"
                className="btn"
                style={{
                  borderColor: mode === 'qr' ? 'var(--accent)' : undefined,
                  color: mode === 'qr' ? 'var(--accent)' : undefined,
                  padding: '9px 10px',
                  fontSize: 13,
                }}
                onClick={() => {
                  setMode('qr');
                  setError(null);
                  setNotice(null);
                }}
              >
                📷 QR-код
              </button>
            </div>
          )}

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
          ) : mode === 'qr' ? (
            <div style={{ textAlign: 'center', padding: '4px 0 8px' }}>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                Откройте PixChats на телефоне (или другом авторизованном устройстве) → <b>Настройки → Устройства</b> → отсканируйте QR-код или введите 6-значный код:
              </p>

              <div
                style={{
                  display: 'inline-flex',
                  padding: 12,
                  borderRadius: 16,
                  background: '#ffffff',
                  border: '3px solid var(--accent)',
                  boxShadow: '0 10px 30px rgba(255, 212, 0, 0.18)',
                  marginBottom: 12,
                }}
              >
                <svg
                  width={196}
                  height={196}
                  viewBox={`0 0 ${qrMatrix.length + 8} ${qrMatrix.length + 8}`}
                  shapeRendering="crispEdges"
                >
                  <rect width={qrMatrix.length + 8} height={qrMatrix.length + 8} fill="#ffffff" />
                  {qrMatrix.map((row, r) =>
                    row.map((cell, c) =>
                      cell ? (
                        <rect key={`${r}-${c}`} x={c + 4} y={r + 4} width={1} height={1} fill="#000000" />
                      ) : null
                    )
                  )}
                </svg>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono, monospace)',
                    fontSize: 20,
                    fontWeight: 800,
                    letterSpacing: '0.18em',
                    padding: '6px 14px',
                    borderRadius: 10,
                    background: 'rgba(255, 212, 0, 0.12)',
                    border: '1px solid rgba(255, 212, 0, 0.4)',
                    color: 'var(--accent)',
                  }}
                >
                  {qrCode}
                </span>
                <button
                  type="button"
                  className="btn btn-compact"
                  style={{ width: 'auto' }}
                  onClick={() => setQrCode(generateQrSessionCode())}
                  title="Сгенерировать новый QR-код"
                >
                  🔄 Обновить
                </button>
              </div>

              {error && <p className="error">{error}</p>}
              {notice && <p className="notice">{notice}</p>}
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                ⏳ Ожидание подтверждения входа с вашего устройства…
              </div>
            </div>
          ) : mode === 'pixset' ? (
            <form onSubmit={handlePixsetSubmit}>
              <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  ⚡ Учётная запись Pixset Studio
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Используйте единый логин и пароль от аккаунта студии (игры Byte Blaster, store и портал pixset-studio.github.io).
                </span>
              </div>

              <div className="field">
                <label>Никнейм или Email в Pixset Studio</label>
                <input
                  className="input"
                  type="text"
                  placeholder="никнейм или email"
                  value={pixsetLogin}
                  onChange={(e) => setPixsetLogin(e.target.value)}
                  required
                />
              </div>

              <div className="field">
                <label>Пароль</label>
                <input
                  className="input"
                  type="password"
                  value={pixsetPassword}
                  onChange={(e) => setPixsetPassword(e.target.value)}
                  required
                />
              </div>

              {error && <p className="error">{error}</p>}

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1 }}>
                  {loading ? 'Проверяем аккаунт Pixset…' : 'Войти через Pixset Studio'}
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ width: 'auto' }}
                  onClick={() => {
                    setMode('password');
                    setError(null);
                  }}
                >
                  ← Назад
                </button>
              </div>
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
            {mode !== 'pixset' && (
              <button
                className="btn"
                style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                onClick={() => {
                  setMode('pixset');
                  setError(null);
                  setNotice(null);
                }}
              >
                ⚡ Войти через Pixset Studio
              </button>
            )}
            {!hideGoogle && (
              <button className="btn" onClick={() => signInWithGoogle(buildAppUrl('/chats/'))}>
                Продолжить с Google
              </button>
            )}
          </div>
        </div>

        <p className="muted-link">
          Нет аккаунта? <Link href="/register">Зарегистрироваться</Link>
        </p>
      </div>
    </main>
  );
}
