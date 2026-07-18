'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
import { BottomNav } from '../../components/BottomNav';

export default function AdminPage() {
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [stats, setStats] = useState<AdminStatsOverview | null>(null);
  const [statusRows, setStatusRows] = useState<SystemStatusRow[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLogRow[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const profile = await getCurrentProfile();
      if (!profile || profile.role === 'user') {
        router.push('/chats');
        return;
      }
      setMe(profile);

      try {
        setStats(await getAdminStats());
      } catch (err: any) {
        setStatsError(err.message ?? 'Не удалось загрузить статистику');
      }

      if (profile.role === 'admin' || profile.role === 'developer') {
        try {
          setStatusRows(await getSystemStatus());
          setErrorLogs(await getErrorLogs());
        } catch {
          // статус систем/логи опциональны — молча пропускаем, чтобы не рушить всю страницу
        }
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
    <>
    <main className="container-wide with-bottom-nav">
      <header className="app-header">
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: 0 }}>Панель управления</h1>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{me.role}</span>
        </div>
        <Link href="/chats/" className="btn btn-ghost" style={{ width: 'auto' }}>
          ← К чатам
        </Link>
      </header>

      <div className="section-title">Обзор</div>
      {stats ? (
        <div className="stats-grid">
          <Stat label="Пользователей" value={stats.total_users} />
          <Stat label="DAU" value={stats.dau} />
          <Stat label="MAU" value={stats.mau} />
          <Stat label="Личных чатов" value={stats.total_direct_chats} />
          <Stat label="Групп" value={stats.total_groups} />
          <Stat label="Каналов" value={stats.total_channels} />
          <Stat label="Сообщений сегодня" value={stats.messages_today} />
          <Stat label="Звонков сегодня" value={stats.calls_today} />
        </div>
      ) : statsError ? (
        <p className="error">{statsError}</p>
      ) : (
        <p style={{ color: 'var(--text-muted)' }}>Загрузка…</p>
      )}

      {(me.role === 'admin' || me.role === 'developer') && (
        <>
          <div className="section-title">Статус систем</div>
          {statusRows.length === 0 ? (
            <div className="empty-state">Проверок пока нет (настраивается через Edge Function по расписанию)</div>
          ) : (
            <ul className="list-plain">
              {statusRows.map((row) => (
                <li key={row.id} className="list-row">
                  {row.service}: <strong>{row.status}</strong> ({row.latency_ms ?? '—'} мс)
                </li>
              ))}
            </ul>
          )}

          <div className="section-title">Последние ошибки</div>
          {errorLogs.length === 0 ? (
            <div className="empty-state">Ошибок не зафиксировано</div>
          ) : (
            <ul className="list-plain">
              {errorLogs.map((log) => (
                <li key={log.id} className="list-row">
                  [{log.source}] {log.message} — {new Date(log.created_at).toLocaleString('ru-RU')}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="section-title">Пользователи</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="@username"
        />
        <button className="btn" style={{ width: 'auto' }} onClick={handleSearch}>
          Найти
        </button>
      </div>

      {notice && <p className="notice">{notice}</p>}

      <ul className="list-plain">
        {results.map((user) => (
          <li key={user.id} className="list-row">
            <div>
              @{user.username}
              <NameBadges role={user.role} isVerified={user.is_verified} />
            </div>
            <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className="btn"
                style={{ width: 'auto', padding: '6px 12px' }}
                onClick={() => handleToggleVerification(user.id, !user.is_verified)}
              >
                {user.is_verified ? 'Снять галочку' : 'Выдать галочку'}
              </button>
              {me.role === 'developer' && (
                <select
                  className="input"
                  style={{ width: 'auto' }}
                  value={user.role}
                  onChange={(e) => handleSetRole(user.id, e.target.value as UserRole)}
                >
                  <option value="user">user</option>
                  <option value="partner">partner</option>
                  <option value="moderator">moderator</option>
                  <option value="admin">admin</option>
                  <option value="developer">developer</option>
                </select>
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
    <BottomNav />
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
