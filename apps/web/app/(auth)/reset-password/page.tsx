'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getSupabaseClient,
  requestPasswordReset,
  verifyRecoveryCodeAndSetNewPassword,
  updateUserPassword,
} from '@pixchats/core';

export default function ResetPasswordPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [isRecoverySession, setIsRecoverySession] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendCountdown, setResendCountdown] = useState(0);

  // Проверяем, если пользователь перешёл по ссылке восстановления из письма
  useEffect(() => {
    const supabase = getSupabaseClient();

    // Проверяем hash URL на наличие access_token типа recovery
    if (typeof window !== 'undefined' && window.location.hash.includes('type=recovery')) {
      setIsRecoverySession(true);
      setStep('verify');
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoverySession(true);
        setStep('verify');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Таймер повторной отправки кода
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setInterval(() => {
      setResendCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCountdown]);

  async function handleRequestReset(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError('Введите email вашего аккаунта');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await requestPasswordReset(email);
      setStep('verify');
      setResendCountdown(60);
      setNotice(`Код сброса пароля отправлен на ${email}. Проверьте папку «Входящие» и «Спам»`);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось отправить код восстановления');
    } finally {
      setLoading(false);
    }
  }

  async function handleSetNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 6) {
      setError('Новый пароль должен содержать не менее 6 символов');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }

    setLoading(true);

    try {
      if (isRecoverySession) {
        // Пользователь перешёл по ссылке из письма с активной recovery-сессией
        await updateUserPassword(newPassword);
      } else {
        // Пользователь ввёл 6-значный OTP код из письма
        if (!code.trim()) {
          setError('Введите код подтверждения из письма');
          setLoading(false);
          return;
        }
        await verifyRecoveryCodeAndSetNewPassword(email, code, newPassword);
      }

      setNotice('✅ Пароль успешно изменён! Выполняем вход…');
      setTimeout(() => {
        router.push('/chats');
      }, 1500);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось сбросить пароль. Проверьте код и попробуйте снова');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-center">
      <div className="container-narrow">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <span className="brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <img
              src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/logo/icon.png`}
              alt=""
              width={26}
              height={26}
            />
            PixChats
          </span>
        </div>

        <div className="card">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 0 }}>
            Восстановление пароля
          </h1>

          <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: '0 0 16px', lineHeight: 1.5 }}>
            {step === 'request'
              ? 'Укажите email, привязанный к вашему аккаунту PixChats, и мы отправим код для сброса пароля.'
              : isRecoverySession
                ? 'Сессия подтверждена! Придумайте новый надёжный пароль для вашего аккаунта.'
                : `Введите 6-значный код из письма, отправленного на ${email || 'вашу почту'}, и задайте новый пароль.`}
          </p>

          {notice && (
            <div
              style={{
                background: 'rgba(255, 212, 0, 0.1)',
                border: '1px solid var(--accent)',
                color: 'var(--accent)',
                padding: '10px 14px',
                borderRadius: 10,
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {notice}
            </div>
          )}

          {step === 'request' ? (
            <form onSubmit={handleRequestReset}>
              <div className="field">
                <label>Ваш Email</label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  placeholder="name@example.com"
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              {error && <p className="error">{error}</p>}

              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Отправляем код…' : 'Отправить код сброса'}
              </button>

              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ width: 'auto', fontSize: 12.5 }}
                  onClick={() => {
                    setError(null);
                    setStep('verify');
                  }}
                >
                  У меня уже есть код из письма →
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSetNewPassword}>
              {!isRecoverySession && (
                <>
                  <div className="field">
                    <label>Email</label>
                    <input
                      className="input"
                      type="email"
                      value={email}
                      placeholder="name@example.com"
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div className="field">
                    <label>Код из письма (6 цифр)</label>
                    <input
                      className="input"
                      type="text"
                      inputMode="numeric"
                      maxLength={10}
                      placeholder="123456"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                </>
              )}

              <div className="field">
                <label>Новый пароль</label>
                <input
                  className="input"
                  type="password"
                  placeholder="Минимум 6 символов"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>

              <div className="field">
                <label>Повторите новый пароль</label>
                <input
                  className="input"
                  type="password"
                  placeholder="Повторите новый пароль"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              {error && <p className="error">{error}</p>}

              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Сохраняем…' : 'Сохранить новый пароль и войти'}
              </button>

              {!isRecoverySession && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 14,
                    fontSize: 12.5,
                  }}
                >
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ width: 'auto', padding: 0 }}
                    onClick={() => {
                      setError(null);
                      setStep('request');
                    }}
                  >
                    ← Изменить email
                  </button>

                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ width: 'auto', padding: 0 }}
                    disabled={resendCountdown > 0 || loading}
                    onClick={async () => {
                      if (!email.trim()) return;
                      setLoading(true);
                      try {
                        await requestPasswordReset(email);
                        setResendCountdown(60);
                        setNotice('Новый код отправлен на почту!');
                      } catch (err: any) {
                        setError(err.message ?? 'Не удалось отправить код повторно');
                      } finally {
                        setLoading(false);
                      }
                    }}
                  >
                    {resendCountdown > 0
                      ? `Отправить повторно (${resendCountdown}с)`
                      : 'Отправить код ещё раз'}
                  </button>
                </div>
              )}
            </form>
          )}

          <hr className="divider" />

          <div style={{ textAlign: 'center' }}>
            <Link href="/login" className="btn-ghost" style={{ display: 'inline-block', fontSize: 13 }}>
              ← Вернуться ко входу
            </Link>
          </div>
        </div>

        <p className="muted-link">
          Вспомнили пароль? <Link href="/login">Войти в аккаунт</Link>
        </p>
      </div>
    </main>
  );
}
