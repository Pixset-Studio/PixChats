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

  return (
    <main style={{ maxWidth: 400, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <h1>Ещё один шаг</h1>
      <p>Вы вошли через внешний аккаунт — осталось выбрать юзернейм и имя.</p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label>Юзернейм</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>@</span>
            <input value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))} required />
          </div>
          {usernameStatus !== 'idle' && (
            <small style={{ color: usernameStatus === 'ok' ? 'green' : usernameStatus === 'checking' ? 'gray' : 'crimson' }}>
              {{ checking: 'Проверяем...', ok: '✓ Свободен', taken: '✗ Занят', invalid: '✗ 5-32 символа: латиница, цифры, _' }[usernameStatus]}
            </small>
          )}
        </div>

        <div>
          <label>Отображаемое имя</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </div>

        {error && <p style={{ color: 'crimson' }}>{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Сохраняем...' : 'Продолжить'}
        </button>
      </form>
    </main>
  );
}
