'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getCurrentProfile,
  getAdminStats,
  getSystemStatus,
  getErrorLogs,
  searchProfilesByUsername,
  setUserRole,
  setUserVerification,
} from '@pixchats/core';
import type { Profile, AdminStatsOverview, SystemStatusRow, ErrorLogRow, UserRole } from '@pixchats/core';
import { NameBadges } from '../../components/NameBadges';

export default function AdminPage() {
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [stats, setStats] = useState<AdminStatsOverview | null>(null);
  const [statusRows, setStatusRows] = useState<SystemStatusRow[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLogRow[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const profile = await getCurrentProfile();
      if (!profile || profile.role === 'user') {
        router.push('/chats');
        return;
      }
      setMe(profile);
      setStats(await getAdminStats());

      // Статус систем и логи ошибок видны только admin/developer (moderator — нет, по вашей схеме прав)
      if (profile.role === 'admin' || profile.role === 'developer') {
        setStatusRows(await getSystemStatus());
        setErrorLogs(await getErrorLogs());
      }
    })();
  }, [router]);

  async function handleSearch() {
    if (!query) return;
    setResults(await searchProfilesByUsername(query));
  }

  async function handleSetRole(userId: string, role: UserRole) {
    if (!me) return;
    try {
      await setUserRole(userId, role, me);
      setNotice(`Роль обновлена: ${role}`);
      setResults(await searchProfilesByUsername(query));
    } catch (err: any) {
      setNotice(err.message);
    }
  }

  async function handleToggleVerification(userId: string, verified: boolean) {
    if (!me) return;
    try {
      await setUserVerification(userId, verified, me);
      setNotice(verified ? 'Галочка выдана' : 'Галочка снята');
      setResults(await searchProfilesByUsername(query));
    } catch (err: any) {
      setNotice(err.message);
    }
  }

  if (!me) return null;

  return (
    <main style={{ maxWidth: 800, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <h1>
        Панель управления <small style={{ color: '#888' }}>({me.role})</small>
      </h1>

      <section style={{ marginTop: 24 }}>
        <h2>Обзор</h2>
        {stats ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <Stat label="Пользователей" value={stats.total_users} />
            <Stat label="DAU" value={stats.dau} />
            <Stat label="MAU" value={stats.mau} />
            <Stat label="Личных чатов" value={stats.total_direct_chats} />
            <Stat label="Групп" value={stats.total_groups} />
            <Stat label="Каналов" value={stats.total_channels} />
            <Stat label="Сообщений сегодня" value={stats.messages_today} />
            <Stat label="Звонков сегодня" value={stats.calls_today} />
          </div>
        ) : (
          <p>Загрузка...</p>
        )}
      </section>

      {(me.role === 'admin' || me.role === 'developer') && (
        <>
          <section style={{ marginTop: 24 }}>
            <h2>Статус систем</h2>
            {statusRows.length === 0 ? (
              <p style={{ color: '#888' }}>Проверок пока нет (настраивается через Edge Function по расписанию)</p>
            ) : (
              <ul>
                {statusRows.map((row) => (
                  <li key={row.id}>
                    {row.service}: <b>{row.status}</b> ({row.latency_ms ?? '—'} мс)
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section style={{ marginTop: 24 }}>
            <h2>Последние ошибки</h2>
            {errorLogs.length === 0 ? (
              <p style={{ color: '#888' }}>Ошибок не зафиксировано</p>
            ) : (
              <ul>
                {errorLogs.map((log) => (
                  <li key={log.id}>
                    [{log.source}] {log.message} — {new Date(log.created_at).toLocaleString('ru-RU')}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section style={{ marginTop: 24 }}>
        <h2>Пользователи</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="@username" />
          <button onClick={handleSearch}>Найти</button>
        </div>

        {notice && <p style={{ color: '#2b8aef' }}>{notice}</p>}

        <ul style={{ listStyle: 'none', padding: 0, marginTop: 12 }}>
          {results.map((user) => (
            <li key={user.id} style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
              @{user.username}
              <NameBadges role={user.role} isVerified={user.is_verified} />
              <div style={{ marginTop: 4, display: 'flex', gap: 8 }}>
                <button onClick={() => handleToggleVerification(user.id, !user.is_verified)}>
                  {user.is_verified ? 'Снять галочку' : 'Выдать галочку'}
                </button>
                {me.role === 'developer' && (
                  <select value={user.role} onChange={(e) => handleSetRole(user.id, e.target.value as UserRole)}>
                    <option value="user">user</option>
                    <option value="moderator">moderator</option>
                    <option value="admin">admin</option>
                    <option value="developer">developer</option>
                  </select>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 12, textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#888' }}>{label}</div>
    </div>
  );
}
