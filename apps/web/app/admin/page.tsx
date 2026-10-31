'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCurrentProfile,
  getAdminStats,
  getSystemStatus,
  getErrorLogs,
  checkSystemStatusNow,
  searchProfilesByUsername,
  setUserRole,
  setUserVerification,
  setPixsetEmployeeBadge,
  banAccount,
  unbanAccount,
  setAccountFrozen,
  deleteAccount,
  banUsername,
  unbanUsername,
  listBannedUsernames,
} from '@pixchats/core';
import type { Profile, AdminStatsOverview, SystemStatusRow, ErrorLogRow, UserRole } from '@pixchats/core';
import { NameWithBadges } from '../../components/NameBadges';
import { BottomNav } from '../../components/BottomNav';
import { DesktopShell } from '../../components/DesktopShell';
import { isBanned } from '../../lib/ban';
import {
  getAllStickers,
  addCustomStickerFromFile,
  addCustomStickerFromBase64,
  removeCustomSticker,
  type StickerItem,
} from '../../lib/stickers';

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
  const [bannedUsernames, setBannedUsernames] = useState<string[]>([]);
  const [newBannedUsername, setNewBannedUsername] = useState('');

  // Стикеры (Base64 без Supabase Storage)
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [stickerTitle, setStickerTitle] = useState('');
  const [stickerPack, setStickerPack] = useState('Pixset Custom');
  const [stickerBase64Input, setStickerBase64Input] = useState('');
  const [stickerNotice, setStickerNotice] = useState<string | null>(null);
  const stickerFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const profile = await getCurrentProfile();
      if (!profile || profile.role === 'user') {
        router.push('/chats');
        return;
      }
      if (isBanned(profile)) {
        router.push('/banned');
        return;
      }
      setMe(profile);
      setStickers(getAllStickers());

      try {
        setStats(await getAdminStats());
      } catch (err: any) {
        setStatsError(err.message ?? 'Не удалось загрузить статистику');
      }

      if (profile.role === 'admin' || profile.role === 'developer') {
        try {
          await checkSystemStatusNow();
          setStatusRows(await getSystemStatus());
          setErrorLogs(await getErrorLogs());
          setBannedUsernames(await listBannedUsernames());
        } catch {
          // статус систем/логи опциональны — молча пропускаем, чтобы не рушить всю страницу
        }
      }
    })();
  }, [router]);

  async function handleStickerFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStickerNotice(null);
    try {
      const titleToUse = stickerTitle.trim() || file.name.replace(/\.[^.]+$/, '');
      const added = await addCustomStickerFromFile(file, titleToUse, stickerPack.trim() || 'Pixset Custom');
      setStickers(getAllStickers());
      setStickerTitle('');
      setStickerNotice(`Стикер «${added.title}» сжат и сохранён в Base64 (${Math.round(added.dataUrl.length / 1024)} КБ, без загрузки в Supabase Storage)`);
    } catch (err: any) {
      setStickerNotice(err.message ?? 'Ошибка загрузки стикера');
    } finally {
      if (stickerFileRef.current) stickerFileRef.current.value = '';
    }
  }

  function handleAddStickerByBase64() {
    setStickerNotice(null);
    if (!stickerBase64Input.trim()) return;
    try {
      const added = addCustomStickerFromBase64(
        stickerBase64Input.trim(),
        stickerTitle.trim() || 'Стикер',
        stickerPack.trim() || 'Pixset Custom'
      );
      setStickers(getAllStickers());
      setStickerBase64Input('');
      setStickerTitle('');
      setStickerNotice(`Стикер «${added.title}» добавлен в Base64 (${Math.round(added.dataUrl.length / 1024)} КБ)`);
    } catch (err: any) {
      setStickerNotice(err.message ?? 'Некорректная строка Base64');
    }
  }

  function handleDeleteSticker(id: string, title: string) {
    removeCustomSticker(id);
    setStickers(getAllStickers());
    setStickerNotice(`Стикер «${title}» удалён`);
  }

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

  async function handleTogglePixsetEmployee(userId: string, value: boolean) {
    if (!me) return;
    try {
      await setPixsetEmployeeBadge(userId, value, me);
      setNotice(value ? 'Бейдж "Сотрудник Pixset Studio" выдан' : 'Бейдж снят');
      setResults(await searchProfilesByUsername(query));
    } catch (err: any) {
      setNotice(err.message);
    }
  }

  async function handleBan(userId: string, days: number | 'forever') {
    if (!me) return;
    try {
      await banAccount(userId, days === 'forever' ? { permanent: true } : { durationDays: days }, me);
      setNotice(days === 'forever' ? 'Забанен навсегда' : `Забанен на ${days} дн.`);
      setResults(await searchProfilesByUsername(query));
    } catch (err: any) {
      setNotice(err.message);
    }
  }

  async function handleUnban(userId: string) {
    if (!me) return;
    try {
      await unbanAccount(userId, me);
      setNotice('Бан снят');
      setResults(await searchProfilesByUsername(query));
    } catch (err: any) {
      setNotice(err.message);
    }
  }

  async function handleToggleFreeze(userId: string, frozen: boolean) {
    if (!me) return;
    try {
      await setAccountFrozen(userId, frozen, me);
      setNotice(frozen ? 'Аккаунт заморожен' : 'Аккаунт разморожен');
      setResults(await searchProfilesByUsername(query));
    } catch (err: any) {
      setNotice(err.message);
    }
  }

  async function handleDeleteAccount(userId: string) {
    if (!me) return;
    if (!confirm('Удалить аккаунт безвозвратно? Это действие нельзя отменить.')) return;
    try {
      await deleteAccount(userId, me);
      setNotice('Аккаунт удалён');
      setResults(await searchProfilesByUsername(query));
    } catch (err: any) {
      setNotice(err.message);
    }
  }

  async function handleBanUsername() {
    if (!me || !newBannedUsername.trim()) return;
    try {
      await banUsername(newBannedUsername.trim(), me);
      setNewBannedUsername('');
      setBannedUsernames(await listBannedUsernames());
    } catch (err: any) {
      setNotice(err.message);
    }
  }

  async function handleUnbanUsername(username: string) {
    await unbanUsername(username);
    setBannedUsernames(await listBannedUsernames());
  }

  if (!me) return null;

  return (
    <DesktopShell>
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
          <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Статус систем
            <button
              className="btn"
              style={{ width: 'auto', padding: '4px 10px', fontSize: 12 }}
              onClick={async () => {
                await checkSystemStatusNow();
                setStatusRows(await getSystemStatus());
              }}
            >
              Проверить сейчас
            </button>
          </div>
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
              <NameWithBadges
                name={user.display_name}
                role={user.role}
                isVerified={user.is_verified}
                isPixsetEmployee={user.is_pixset_employee}
                isFrozen={user.frozen}
              />{' '}
              <span style={{ color: 'var(--text-muted)' }}>(@{user.username})</span>
            </div>
            <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className="btn"
                style={{ width: 'auto', padding: '6px 12px' }}
                onClick={() => handleToggleVerification(user.id, !user.is_verified)}
              >
                {user.is_verified ? 'Снять галочку' : 'Выдать галочку'}
              </button>
              <button
                className="btn"
                style={{ width: 'auto', padding: '6px 12px' }}
                onClick={() => handleTogglePixsetEmployee(user.id, !user.is_pixset_employee)}
              >
                {user.is_pixset_employee ? 'Снять "Сотрудник"' : 'Выдать "Сотрудник"'}
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

            <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {user.banned_permanently || (user.banned_until && new Date(user.banned_until) > new Date()) ? (
                <button className="btn" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => handleUnban(user.id)}>
                  Снять бан
                </button>
              ) : (
                <>
                  <button className="btn" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => handleBan(user.id, 1)}>
                    Бан на 1 день
                  </button>
                  <button className="btn" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => handleBan(user.id, 7)}>
                    на 7 дней
                  </button>
                  <button className="btn" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => handleBan(user.id, 30)}>
                    на 30 дней
                  </button>
                  <button
                    className="btn"
                    style={{ width: 'auto', padding: '6px 12px', color: 'var(--danger)' }}
                    onClick={() => handleBan(user.id, 'forever')}
                  >
                    Навсегда
                  </button>
                </>
              )}
              <button
                className="btn"
                style={{ width: 'auto', padding: '6px 12px' }}
                onClick={() => handleToggleFreeze(user.id, !user.frozen)}
              >
                {user.frozen ? 'Разморозить' : 'Заморозить'}
              </button>
              <button
                className="btn"
                style={{ width: 'auto', padding: '6px 12px', color: 'var(--danger)' }}
                onClick={() => handleDeleteAccount(user.id)}
              >
                🗑 Удалить аккаунт
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="section-title">Запрещённые юзернеймы</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          className="input"
          value={newBannedUsername}
          onChange={(e) => setNewBannedUsername(e.target.value)}
          placeholder="username без @"
        />
        <button className="btn" style={{ width: 'auto' }} onClick={handleBanUsername}>
          Запретить
        </button>
      </div>
      {bannedUsernames.length === 0 ? (
        <div className="empty-state">Список пуст.</div>
      ) : (
        <ul className="list-plain">
          {bannedUsernames.map((u) => (
            <li key={u} className="list-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
              {u}
              <button className="btn" style={{ width: 'auto', padding: '4px 10px' }} onClick={() => handleUnbanUsername(u)}>
                Разрешить обратно
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="section-title">Управление стикерами (Base64 — без хранения в Supabase)</div>
      <div className="card" style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 12 }}>
          Стикеры хранятся в формате сжатых изображений Base64 (Data URL) и не занимают место в бакетах Supabase Storage.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 12 }}>
          <div>
            <label className="label">Название стикера</label>
            <input
              className="input"
              value={stickerTitle}
              onChange={(e) => setStickerTitle(e.target.value)}
              placeholder="Напр.: Кибер Кот"
            />
          </div>
          <div>
            <label className="label">Набор стикеров</label>
            <input
              className="input"
              value={stickerPack}
              onChange={(e) => setStickerPack(e.target.value)}
              placeholder="Pixset Custom"
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <input
            ref={stickerFileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleStickerFileChange}
          />
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: 'auto' }}
            onClick={() => stickerFileRef.current?.click()}
          >
            + Загрузить картинку (конвертация в Base64)
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            className="input"
            value={stickerBase64Input}
            onChange={(e) => setStickerBase64Input(e.target.value)}
            placeholder="Или вставьте готовую строку data:image/...;base64,..."
          />
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', flexShrink: 0 }}
            onClick={handleAddStickerByBase64}
          >
            Добавить Base64
          </button>
        </div>

        {stickerNotice && <p className="notice" style={{ marginBottom: 12 }}>{stickerNotice}</p>}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: 10,
            marginTop: 12,
          }}
        >
          {stickers.map((stk) => {
            const isCustom = stk.id.startsWith('custom-');
            const sizeKb = Math.max(1, Math.round(stk.dataUrl.length / 1024));
            return (
              <div
                key={stk.id}
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <img
                  src={stk.dataUrl}
                  alt={stk.title}
                  style={{ width: 64, height: 64, objectFit: 'contain' }}
                />
                <div style={{ fontSize: 12, fontWeight: 600, textAlign: 'center' }}>{stk.title}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {stk.pack} · {sizeKb} КБ
                </div>
                {isCustom ? (
                  <button
                    type="button"
                    className="btn"
                    style={{ width: '100%', padding: '4px 8px', fontSize: 11, color: 'var(--danger)' }}
                    onClick={() => handleDeleteSticker(stk.id, stk.title)}
                  >
                    Удалить
                  </button>
                ) : (
                  <span style={{ fontSize: 10, color: 'var(--accent)' }}>Базовый Base64</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </main>
    <BottomNav />
    </DesktopShell>
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
