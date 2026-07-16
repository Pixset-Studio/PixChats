'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { hasActiveSession, checkUsernameAvailable, completeOAuthProfile } from '@pixchats/core';

export default function CompleteProfilePage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const active = await hasActiveSession();
      if (!active) router.push('/login');
    })();
  }, [router]);

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
      await completeOAuthProfile({ username, displayName });
      router.push('/chats');
    } catch (err: any) {
      setError(err.message ?? 'Не удалось завершить регистрацию');
    } finally {
      setLoading(false);
    }
  }

  const usernameHintClass =
    usernameStatus === 'ok' ? 'hint hint-ok' : usernameStatus === 'checking' ? 'hint hint-checking' : 'hint hint-error';
  const usernameHintText: Record<typeof usernameStatus, string> = {
    idle: '',
    checking: 'Проверяем…',
    ok: '✓ Свободен',
    taken: '✗ Занят',
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
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 0 }}>Ещё один шаг</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: -8 }}>
            Вы вошли через внешний аккаунт — осталось выбрать юзернейм и имя.
          </p>

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Юзернейм</label>
              <div className="input-prefix">
                <span>@</span>
                <input
                  className="input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
                  required
                />
              </div>
              {usernameStatus !== 'idle' && <p className={usernameHintClass}>{usernameHintText[usernameStatus]}</p>}
            </div>

            <div className="field">
              <label>Отображаемое имя</label>
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            </div>

            {error && <p className="error">{error}</p>}

            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Сохраняем…' : 'Продолжить'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
