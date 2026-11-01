'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCurrentProfile,
  getAdminStats,
  getSystemStatus,
  getErrorLogs,
  checkSystemStatusNow,
  listProfilesForAdmin,
  listGroupAndChannelChatsForAdmin,
  getAuditLogsForAdmin,
  setUserRole,
  setUserVerification,
  setPixsetEmployeeBadge,
  setChatVerification,
  banAccount,
  unbanAccount,
  setAccountFrozen,
  deleteAccount,
  banUsername,
  unbanUsername,
  listBannedUsernames,
  getMessageReportsForAdmin,
} from '@pixchats/core';
import type {
  Profile,
  Chat,
  AdminStatsOverview,
  SystemStatusRow,
  ErrorLogRow,
  UserRole,
  AdminUserFilter,
  AdminAuditLogRow,
  MessageReport,
} from '@pixchats/core';
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
import {
  loadActiveStories,
  deleteStoryById,
  type StoryItem,
} from '../../lib/stories';
import {
  getUserEmojiStatus,
  setUserEmojiStatus,
  PRESET_EMOJI_STATUSES,
} from '../../lib/emojiStatus';

type AdminTab = 'overview' | 'users' | 'chats' | 'stories' | 'moderation' | 'content';

const USER_FILTER_OPTIONS: { id: AdminUserFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'developer', label: '👑 Разработчики' },
  { id: 'admin', label: '⚡ Админы' },
  { id: 'moderator', label: '🛡️ Модераторы' },
  { id: 'partner', label: '🤝 Партнёры' },
  { id: 'verified', label: '✓ Верифицированные' },
  { id: 'employee', label: '💠 Сотрудники Pixset' },
  { id: 'frozen', label: '❄️ Замороженные' },
  { id: 'banned', label: '🚫 Забаненные' },
];

export default function AdminPage() {
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

  const [stats, setStats] = useState<AdminStatsOverview | null>(null);
  const [statusRows, setStatusRows] = useState<SystemStatusRow[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLogRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogRow[]>([]);

  // Пользователи и фильтрация
  const [query, setQuery] = useState('');
  const [userFilter, setUserFilter] = useState<AdminUserFilter>('all');
  const [results, setResults] = useState<Profile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [editingEmojiUserId, setEditingEmojiUserId] = useState<string | null>(null);
  const [customAdminEmoji, setCustomAdminEmoji] = useState('');

  // Группы и каналы
  const [chatQuery, setChatQuery] = useState('');
  const [managedChats, setManagedChats] = useState<Chat[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);

  // Активные истории
  const [activeStories, setActiveStories] = useState<StoryItem[]>([]);
  const [loadingStories, setLoadingStories] = useState(false);
  // Жалобы и Модерация
  const [messageReports, setMessageReports] = useState<MessageReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);

  const refreshMessageReports = useCallback(async () => {
    setLoadingReports(true);
    try {
      const reports = await getMessageReportsForAdmin();
      setMessageReports(reports);
    } catch {
      // ignore
    } finally {
      setLoadingReports(false);
    }
  }, []);

  // Системное объявление
  const [announcementText, setAnnouncementText] = useState('');

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

  const loadUsersList = useCallback(async (filterToUse: AdminUserFilter, queryToUse: string) => {
    setLoadingUsers(true);
    try {
      const list = await listProfilesForAdmin({
        filter: filterToUse,
        query: queryToUse,
        limit: 50,
      });
      setResults(list);
    } catch (err: any) {
      setNotice(err.message ?? 'Не удалось загрузить пользователей');
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const loadChatsList = useCallback(async (queryToUse: string) => {
    setLoadingChats(true);
    try {
      const list = await listGroupAndChannelChatsForAdmin(queryToUse, 50);
      setManagedChats(list);
    } catch (err: any) {
      setNotice(err.message ?? 'Не удалось загрузить группы и каналы');
    } finally {
      setLoadingChats(false);
    }
  }, []);

  const refreshStoriesModeration = useCallback(async () => {
    setLoadingStories(true);
    try {
      const items = await loadActiveStories();
      setActiveStories(items);
    } catch {
      // ignore
    } finally {
      setLoadingStories(false);
    }
  }, []);

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
      if (typeof window !== 'undefined') {
        setAnnouncementText(localStorage.getItem('pixchats_system_announcement') || '');
      }

      loadUsersList('all', '');
      loadChatsList('');
      refreshStoriesModeration();
      refreshMessageReports();

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
          setAuditLogs(await getAuditLogsForAdmin(40));
          setBannedUsernames(await listBannedUsernames());
        } catch {
          // статус систем/логи опциональны — молча пропускаем, чтобы не рушить всю страницу
        }
      }
    })();
  }, [router, loadUsersList, loadChatsList, refreshStoriesModeration]);

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
    await loadUsersList(userFilter, query);
  }

  async function handleSelectFilter(nextFilter: AdminUserFilter) {
    setUserFilter(nextFilter);
    await loadUsersList(nextFilter, query);
  }

  async function handleSetRole(userId: string, role: UserRole) {
    if (!me) return;
    try {
      await setUserRole(userId, role, me);
      setNotice(`Роль обновлена: ${role}`);
      await loadUsersList(userFilter, query);
    } catch (err: any) {
      setNotice(err.message);
    }
  }

  async function handleToggleVerification(userId: string, verified: boolean) {
    if (!me) return;
    try {
      await setUserVerification(userId, verified, me);
      setNotice(verified ? 'Галочка выдана' : 'Галочка снята');
      await loadUsersList(userFilter, query);
    } catch (err: any) {
      setNotice(err.message);
    }
  }

  async function handleTogglePixsetEmployee(userId: string, value: boolean) {
    if (!me) return;
    try {
      await setPixsetEmployeeBadge(userId, value, me);
      setNotice(value ? 'Бейдж "Сотрудник Pixset Studio" выдан' : 'Бейдж снят');
      await loadUsersList(userFilter, query);
    } catch (err: any) {
      setNotice(err.message);
    }
  }

  async function handleSetUserEmoji(user: Profile, emoji: string | null) {
    try {
      await setUserEmojiStatus(user.id, emoji, user.username);
      setNotice(emoji ? `Эмодзи-статус ${emoji} установлен для @${user.username}` : `Эмодзи-статус снят у @${user.username}`);
      setEditingEmojiUserId(null);
      setCustomAdminEmoji('');
      setResults((prev) => [...prev]);
    } catch (err: any) {
      setNotice(err.message ?? 'Не удалось обновить эмодзи-статус');
    }
  }

  async function handleBan(userId: string, days: number | 'forever') {
    if (!me) return;
    try {
      await banAccount(userId, days === 'forever' ? { permanent: true } : { durationDays: days }, me);
      setNotice(days === 'forever' ? 'Забанен навсегда' : `Забанен на ${days} дн.`);
      await loadUsersList(userFilter, query);
    } catch (err: any) {
      setNotice(err.message);
    }
  }

  async function handleUnban(userId: string) {
    if (!me) return;
    try {
      await unbanAccount(userId, me);
      setNotice('Бан снят');
      await loadUsersList(userFilter, query);
    } catch (err: any) {
      setNotice(err.message);
    }
  }

  async function handleToggleFreeze(userId: string, frozen: boolean) {
    if (!me) return;
    try {
      await setAccountFrozen(userId, frozen, me);
      setNotice(frozen ? 'Аккаунт заморожен' : 'Аккаунт разморожен');
      await loadUsersList(userFilter, query);
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
      await loadUsersList(userFilter, query);
    } catch (err: any) {
      setNotice(err.message);
    }
  }

  async function handleToggleChatVerification(chat: Chat) {
    if (!me) return;
    try {
      await setChatVerification(chat.id, !chat.is_verified, me);
      setNotice(!chat.is_verified ? `Галочка выдана для «${chat.title}»` : `Галочка снята у «${chat.title}»`);
      await loadChatsList(chatQuery);
    } catch (err: any) {
      setNotice(err.message);
    }
  }

  async function handleAdminDeleteStory(story: StoryItem) {
    try {
      await deleteStoryById(story.id);
      setNotice(`История от ${story.userName} удалена модератором`);
      await refreshStoriesModeration();
    } catch (err: any) {
      setNotice(err.message ?? 'Ошибка удаления истории');
    }
  }

  function handleSaveAnnouncement() {
    if (typeof window === 'undefined') return;
    const trimmed = announcementText.trim();
    if (trimmed) {
      localStorage.setItem('pixchats_system_announcement', trimmed);
      setNotice('Глобальное объявление сохранено');
    } else {
      localStorage.removeItem('pixchats_system_announcement');
      setNotice('Глобальное объявление сброшено');
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
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: 0 }}>
              🛡️ Центр управления PixChats
            </h1>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Ваша роль: <strong style={{ color: 'var(--accent)' }}>{me.role}</strong> (@{me.username})
            </span>
          </div>
          <Link href="/chats/" className="btn btn-ghost" style={{ width: 'auto' }}>
            ← К чатам
          </Link>
        </header>

        {/* Быстрая статистика сверху */}
        {stats ? (
          <div className="stats-grid" style={{ marginBottom: 16 }}>
            <Stat label="Пользователей" value={stats.total_users} />
            <Stat label="DAU (сутки)" value={stats.dau} />
            <Stat label="MAU (месяц)" value={stats.mau} />
            <Stat label="Личных чатов" value={stats.total_direct_chats} />
            <Stat label="Групп" value={stats.total_groups} />
            <Stat label="Каналов" value={stats.total_channels} />
            <Stat label="Сообщений сегодня" value={stats.messages_today} />
            <Stat label="Активных историй" value={activeStories.length} />
          </div>
        ) : statsError ? (
          <p className="error">{statsError}</p>
        ) : null}

        {/* Навигация по вкладкам админки */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            paddingBottom: 8,
            marginBottom: 16,
            borderBottom: '1px solid var(--border)',
          }}
        >
          {(
            [
              { id: 'users', label: `👥 Пользователи (${results.length})` },
              { id: 'chats', label: `📢 Группы и Каналы (${managedChats.length})` },
              { id: 'stories', label: `✨ Истории (${activeStories.length})` },
              { id: 'moderation', label: `🚨 Жалобы и Модерация (${messageReports.length})` },
              { id: 'overview', label: '📊 Системы и Аудит' },
              { id: 'content', label: `🎨 Стикеры и Стоп-лист` },
            ] as { id: AdminTab; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? 'btn btn-primary' : 'btn'}
              style={{
                width: 'auto',
                padding: '8px 14px',
                fontSize: 13,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {notice && (
          <div
            className="notice"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 14,
            }}
          >
            <span>{notice}</span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: 'auto', padding: '2px 8px', fontSize: 12 }}
              onClick={() => setNotice(null)}
            >
              ✕
            </button>
          </div>
        )}

        {/* ВКЛАДКА 1: ПОЛЬЗОВАТЕЛИ И РОЛИ */}
        {activeTab === 'users' && (
          <section>
            <div className="section-title" style={{ marginTop: 0 }}>
              Каталог пользователей, роли, галочки и эмодзи-статусы
            </div>

            {/* Фильтры по ролям и статусу */}
            <div
              style={{
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
                marginBottom: 12,
              }}
            >
              {USER_FILTER_OPTIONS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => handleSelectFilter(f.id)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border:
                      userFilter === f.id
                        ? '1px solid var(--accent)'
                        : '1px solid var(--border)',
                    background:
                      userFilter === f.id
                        ? 'rgba(124, 92, 255, 0.2)'
                        : 'var(--bg-elevated)',
                    color: 'var(--text)',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Поле поиска */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch();
                }}
                placeholder="Поиск по @username или отображаемому имени…"
              />
              <button className="btn btn-primary" style={{ width: 'auto' }} onClick={handleSearch}>
                Найти
              </button>
              {query && (
                <button
                  className="btn"
                  style={{ width: 'auto' }}
                  onClick={() => {
                    setQuery('');
                    loadUsersList(userFilter, '');
                  }}
                >
                  Сбросить
                </button>
              )}
            </div>

            {loadingUsers ? (
              <div className="empty-state">Загрузка списка пользователей…</div>
            ) : results.length === 0 ? (
              <div className="empty-state">Пользователи по выбранному фильтру не найдены</div>
            ) : (
              <ul className="list-plain">
                {results.map((user) => {
                  const currentEmoji = getUserEmojiStatus(user.id, user.username);
                  const isBannedNow =
                    user.banned_permanently ||
                    Boolean(user.banned_until && new Date(user.banned_until) > new Date());

                  return (
                    <li
                      key={user.id}
                      className="list-row"
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        padding: 14,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 8,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div
                            style={{
                              width: 38,
                              height: 38,
                              borderRadius: '50%',
                              background: 'var(--accent)',
                              display: 'grid',
                              placeItems: 'center',
                              overflow: 'hidden',
                              fontWeight: 700,
                              color: '#fff',
                              flexShrink: 0,
                            }}
                          >
                            {user.avatar_url ? (
                              <img
                                src={user.avatar_url}
                                alt=""
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            ) : (
                              (user.display_name || user.username || '?').slice(0, 1).toUpperCase()
                            )}
                          </div>
                          <div>
                            <div>
                              <NameWithBadges
                                name={user.display_name}
                                userId={user.id}
                                username={user.username}
                                role={user.role}
                                isVerified={user.is_verified}
                                isPixsetEmployee={user.is_pixset_employee}
                                isFrozen={user.frozen}
                              />{' '}
                              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                                (@{user.username})
                              </span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                              ID: {user.id.slice(0, 8)}… · Регистрация:{' '}
                              {new Date(user.created_at).toLocaleDateString('ru-RU')}
                              {isBannedNow && (
                                <span style={{ color: 'var(--danger)', marginLeft: 8, fontWeight: 700 }}>
                                  • ЗАБАНЕН
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <Link
                          href={`/user?id=${encodeURIComponent(user.id)}`}
                          className="btn"
                          style={{ width: 'auto', padding: '5px 10px', fontSize: 12 }}
                        >
                          Профиль →
                        </Link>
                      </div>

                      {/* Управление верификацией, сотрудником, ролью и эмодзи-статусом */}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          className="btn"
                          style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
                          onClick={() => handleToggleVerification(user.id, !user.is_verified)}
                        >
                          {user.is_verified ? '✓ Снять галочку' : '+ Выдать галочку'}
                        </button>
                        <button
                          className="btn"
                          style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
                          onClick={() => handleTogglePixsetEmployee(user.id, !user.is_pixset_employee)}
                        >
                          {user.is_pixset_employee ? '💠 Снять "Сотрудник"' : '+ Выдать "Сотрудник"'}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
                          onClick={() =>
                            setEditingEmojiUserId(editingEmojiUserId === user.id ? null : user.id)
                          }
                        >
                          {currentEmoji
                            ? `Эмодзи-статус: ${currentEmoji}`
                            : '✨ Задать эмодзи-статус'}
                        </button>

                        {me.role === 'developer' && (
                          <select
                            className="input"
                            style={{ width: 'auto', padding: '5px 10px', fontSize: 12 }}
                            value={user.role}
                            onChange={(e) => handleSetRole(user.id, e.target.value as UserRole)}
                          >
                            <option value="user">Роль: user</option>
                            <option value="partner">Роль: partner</option>
                            <option value="moderator">Роль: moderator</option>
                            <option value="admin">Роль: admin</option>
                            <option value="developer">Роль: developer</option>
                          </select>
                        )}
                      </div>

                      {/* Панель выбора эмодзи-статуса для конкретного пользователя */}
                      {editingEmojiUserId === user.id && (
                        <div
                          style={{
                            padding: 10,
                            borderRadius: 10,
                            background: 'var(--bg)',
                            border: '1px solid var(--border)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 600 }}>
                            Выберите эмодзи-статус для @{user.username} (отображается справа от ника):
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {PRESET_EMOJI_STATUSES.map((item) => (
                              <button
                                key={item.emoji}
                                type="button"
                                className="btn"
                                style={{ width: 'auto', padding: '4px 8px', fontSize: 14 }}
                                title={item.label}
                                onClick={() => handleSetUserEmoji(user, item.emoji)}
                              >
                                {item.emoji}
                              </button>
                            ))}
                            {currentEmoji && (
                              <button
                                type="button"
                                className="btn"
                                style={{
                                  width: 'auto',
                                  padding: '4px 10px',
                                  fontSize: 12,
                                  color: 'var(--danger)',
                                }}
                                onClick={() => handleSetUserEmoji(user, null)}
                              >
                                Сбросить
                              </button>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input
                              className="input"
                              style={{ maxWidth: 180, padding: '4px 8px', fontSize: 13 }}
                              placeholder="Любой эмодзи / флаг…"
                              value={customAdminEmoji}
                              onChange={(e) => setCustomAdminEmoji(e.target.value)}
                            />
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ width: 'auto', padding: '4px 12px', fontSize: 12 }}
                              onClick={() => {
                                if (customAdminEmoji.trim()) {
                                  handleSetUserEmoji(user, customAdminEmoji.trim());
                                }
                              }}
                            >
                              Сохранить
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Санкции: Бан / Заморозка / Удаление */}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {isBannedNow ? (
                          <button
                            className="btn"
                            style={{ width: 'auto', padding: '5px 10px', fontSize: 12 }}
                            onClick={() => handleUnban(user.id)}
                          >
                            Разбанить
                          </button>
                        ) : (
                          <>
                            <button
                              className="btn"
                              style={{ width: 'auto', padding: '5px 10px', fontSize: 12 }}
                              onClick={() => handleBan(user.id, 1)}
                            >
                              Бан 1 дн.
                            </button>
                            <button
                              className="btn"
                              style={{ width: 'auto', padding: '5px 10px', fontSize: 12 }}
                              onClick={() => handleBan(user.id, 7)}
                            >
                              7 дн.
                            </button>
                            <button
                              className="btn"
                              style={{ width: 'auto', padding: '5px 10px', fontSize: 12 }}
                              onClick={() => handleBan(user.id, 30)}
                            >
                              30 дн.
                            </button>
                            <button
                              className="btn"
                              style={{
                                width: 'auto',
                                padding: '5px 10px',
                                fontSize: 12,
                                color: 'var(--danger)',
                              }}
                              onClick={() => handleBan(user.id, 'forever')}
                            >
                              Навсегда
                            </button>
                          </>
                        )}
                        <button
                          className="btn"
                          style={{ width: 'auto', padding: '5px 10px', fontSize: 12 }}
                          onClick={() => handleToggleFreeze(user.id, !user.frozen)}
                        >
                          {user.frozen ? '☀️ Разморозить' : '❄️ Заморозить'}
                        </button>
                        <button
                          className="btn"
                          style={{
                            width: 'auto',
                            padding: '5px 10px',
                            fontSize: 12,
                            color: 'var(--danger)',
                          }}
                          onClick={() => handleDeleteAccount(user.id)}
                        >
                          🗑 Удалить аккаунт
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {/* ВКЛАДКА 2: ГРУППЫ И КАНАЛЫ (ВЕРИФИКАЦИЯ И МОДЕРАЦИЯ) */}
        {activeTab === 'chats' && (
          <section>
            <div className="section-title" style={{ marginTop: 0 }}>
              Управление группами и каналами (Верификация ✓)
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                value={chatQuery}
                onChange={(e) => setChatQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') loadChatsList(chatQuery);
                }}
                placeholder="Название группы/канала или @public_username…"
              />
              <button
                className="btn btn-primary"
                style={{ width: 'auto' }}
                onClick={() => loadChatsList(chatQuery)}
              >
                Найти
              </button>
            </div>

            {loadingChats ? (
              <div className="empty-state">Загрузка групп и каналов…</div>
            ) : managedChats.length === 0 ? (
              <div className="empty-state">Группы и каналы не найдены</div>
            ) : (
              <ul className="list-plain">
                {managedChats.map((chat) => (
                  <li
                    key={chat.id}
                    className="list-row"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 10,
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            fontSize: 11,
                            padding: '2px 8px',
                            borderRadius: 6,
                            background:
                              chat.type === 'channel'
                                ? 'rgba(124, 92, 255, 0.2)'
                                : 'rgba(56, 189, 248, 0.18)',
                            color: 'var(--text)',
                            fontWeight: 600,
                          }}
                        >
                          {chat.type === 'channel' ? '📢 Канал' : '👥 Группа'}
                        </span>
                        <NameWithBadges
                          name={chat.title || 'Без названия'}
                          isVerified={chat.is_verified}
                        />
                        {chat.username && (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            (@{chat.username})
                          </span>
                        )}
                      </div>
                      {chat.description && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                          {chat.description}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
                        onClick={() => handleToggleChatVerification(chat)}
                      >
                        {chat.is_verified ? '✓ Снять галочку' : '+ Выдать галочку ✓'}
                      </button>
                      <Link
                        href={`/chat-info?id=${encodeURIComponent(chat.id)}`}
                        className="btn btn-ghost"
                        style={{ width: 'auto', padding: '6px 10px', fontSize: 12 }}
                      >
                        Инфо →
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ВКЛАДКА 3: МОДЕРАЦИЯ ИСТОРИЙ */}
        {activeTab === 'stories' && (
          <section>
            <div
              className="section-title"
              style={{
                marginTop: 0,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>Активные истории пользователей и каналов ({activeStories.length})</span>
              <button
                type="button"
                className="btn"
                style={{ width: 'auto', padding: '5px 12px', fontSize: 12 }}
                onClick={refreshStoriesModeration}
              >
                🔄 Обновить
              </button>
            </div>

            {loadingStories ? (
              <div className="empty-state">Загрузка активных историй…</div>
            ) : activeStories.length === 0 ? (
              <div className="empty-state">Сейчас нет активных историй</div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 12,
                }}
              >
                {activeStories.map((story) => (
                  <div
                    key={story.id}
                    className="card"
                    style={{
                      padding: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        width: '100%',
                        height: 220,
                        borderRadius: 10,
                        overflow: 'hidden',
                        background: '#090912',
                        position: 'relative',
                      }}
                    >
                      {story.mediaType === 'video' && story.mediaUrl ? (
                        <video
                          src={story.mediaUrl}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          controls
                          muted
                          playsInline
                        />
                      ) : story.mediaUrl ? (
                        <img
                          src={story.mediaUrl}
                          alt={story.text || 'Story'}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '100%',
                            height: '100%',
                            background: story.bgGradient,
                            display: 'grid',
                            placeItems: 'center',
                            padding: 12,
                            color: '#fff',
                            fontWeight: 700,
                            textAlign: 'center',
                          }}
                        >
                          {story.text || story.overlayText || 'История'}
                        </div>
                      )}
                      {story.isChannelStory && (
                        <span
                          style={{
                            position: 'absolute',
                            top: 8,
                            left: 8,
                            background: 'rgba(124, 92, 255, 0.9)',
                            color: '#fff',
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: 999,
                          }}
                        >
                          📢 КАНАЛ
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      {story.userName}{' '}
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                        (@{story.userUsername})
                      </span>
                    </div>
                    {story.text && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        «{story.text}»
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      👁 {story.viewers.length} просм. · ❤️{' '}
                      {Object.values(story.reactions || {}).reduce((acc, r) => acc + r.length, 0)}{' '}
                      реакц.
                    </div>
                    <button
                      type="button"
                      className="btn"
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        color: 'var(--danger)',
                      }}
                      onClick={() => handleAdminDeleteStory(story)}
                    >
                      🗑 Удалить историю
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ВКЛАДКА 3.5: МОДЕРАЦИЯ И ЖАЛОБЫ */}
        {activeTab === 'moderation' && (
          <section>
            <div
              className="section-title"
              style={{
                marginTop: 0,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>🚨 Жалобы пользователей и замороженные аккаунты ({messageReports.length})</span>
              <button
                type="button"
                className="btn"
                style={{ width: 'auto', padding: '5px 12px', fontSize: 12 }}
                onClick={refreshMessageReports}
              >
                🔄 Обновить
              </button>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              При получении 3+ жалоб от разных людей или при срабатывании автомодерации в публичных каналах аккаунт пользователя автоматически замораживается. На этой панели администратор видит причину жалоб и принимает решение: разморозить или забанить навсегда.
            </p>

            {loadingReports ? (
              <div className="empty-state">Загрузка жалоб модерации…</div>
            ) : messageReports.length === 0 ? (
              <div className="empty-state">Пока нет активных жалоб от пользователей или автоблокировок</div>
            ) : (
              <ul className="list-plain">
                {messageReports.map((report) => (
                  <li
                    key={report.id}
                    className="list-row"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                      padding: 16,
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 14,
                      marginBottom: 12,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span>🚨 Нарушитель:</span>
                          <span style={{ color: 'var(--accent)' }}>
                            {report.reported_user?.display_name || 'Пользователь'} (@{report.reported_user?.username || 'user'})
                          </span>
                          {report.reported_user?.frozen && (
                            <span style={{ fontSize: 11, background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>
                              ❄️ ЗАМОРОЖЕН
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                          📩 Жалобу подал(а): <strong>{report.reporter?.display_name || 'Заявитель'}</strong> (@{report.reporter?.username || 'user'}) · {new Date(report.created_at).toLocaleString('ru-RU')}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {report.reported_user?.frozen ? (
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ width: 'auto', padding: '6px 12px', fontSize: 12, background: '#16a34a', borderColor: '#22c55e' }}
                            onClick={() => handleToggleFreeze(report.reported_user_id, false)}
                          >
                            ☀️ Разморозить аккаунт
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn"
                            style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
                            onClick={() => handleToggleFreeze(report.reported_user_id, true)}
                          >
                            ❄️ Заморозить аккаунт
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn"
                          style={{ width: 'auto', padding: '6px 12px', fontSize: 12, background: '#dc2626', color: '#fff', fontWeight: 700 }}
                          onClick={() => handleBan(report.reported_user_id, 'forever')}
                        >
                          ⛔ Забанить навсегда
                        </button>
                      </div>
                    </div>

                    <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--border)', fontSize: 13 }}>
                      <div style={{ fontWeight: 700, color: 'var(--danger)', marginBottom: 4 }}>
                        Категория жалобы: {report.reason}
                      </div>
                      {report.details && (
                        <div style={{ color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
                          «{report.details}»
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ВКЛАДКА 4: СИСТЕМЫ, ОБЪЯВЛЕНИЯ И ЖУРНАЛ АУДИТА */}
        {activeTab === 'overview' && (
          <section>
            <div className="section-title" style={{ marginTop: 0 }}>
              📢 Системное объявление для пользователей
            </div>
            <div className="card" style={{ marginBottom: 18 }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>
                Позволяет закрепить информационное уведомление об обновлении или техработах.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  value={announcementText}
                  onChange={(e) => setAnnouncementText(e.target.value)}
                  placeholder="Текст системного объявления (оставьте пустым для отключения)…"
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: 'auto' }}
                  onClick={handleSaveAnnouncement}
                >
                  Сохранить
                </button>
              </div>
            </div>

            {(me.role === 'admin' || me.role === 'developer') && (
              <>
                <div
                  className="section-title"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
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
                  <div className="empty-state">
                    Проверок пока нет (настраивается через Edge Function по расписанию)
                  </div>
                ) : (
                  <ul className="list-plain">
                    {statusRows.map((row) => (
                      <li key={row.id} className="list-row">
                        {row.service}: <strong>{row.status}</strong> ({row.latency_ms ?? '—'} мс)
                      </li>
                    ))}
                  </ul>
                )}

                <div className="section-title">Журнал действий администрации (Audit Log)</div>
                {auditLogs.length === 0 ? (
                  <div className="empty-state">Записей аудита пока нет</div>
                ) : (
                  <ul className="list-plain">
                    {auditLogs.map((item) => (
                      <li key={item.id} className="list-row" style={{ fontSize: 13 }}>
                        <strong>{item.action}</strong> → [{item.target_type}:{' '}
                        {item.target_id.slice(0, 10)}…] —{' '}
                        <span style={{ color: 'var(--text-muted)' }}>
                          {new Date(item.created_at).toLocaleString('ru-RU')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="section-title">Последние ошибки клиентов</div>
                {errorLogs.length === 0 ? (
                  <div className="empty-state">Ошибок не зафиксировано</div>
                ) : (
                  <ul className="list-plain">
                    {errorLogs.map((log) => (
                      <li key={log.id} className="list-row">
                        [{log.source}] {log.message} —{' '}
                        {new Date(log.created_at).toLocaleString('ru-RU')}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        )}

        {/* ВКЛАДКА 5: СТИКЕРЫ И ЗАПРЕЩЁННЫЕ ЮЗЕРНЕЙМЫ */}
        {activeTab === 'content' && (
          <section>
            <div className="section-title" style={{ marginTop: 0 }}>
              Запрещённые юзернеймы
            </div>
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
                  <li
                    key={u}
                    className="list-row"
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    @{u}
                    <button
                      className="btn"
                      style={{ width: 'auto', padding: '4px 10px' }}
                      onClick={() => handleUnbanUsername(u)}
                    >
                      Разрешить обратно
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="section-title">
              Управление стикерами (Base64 — без хранения в Supabase)
            </div>
            <div className="card" style={{ marginBottom: 20 }}>
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--text-muted)',
                  marginTop: 0,
                  marginBottom: 12,
                }}
              >
                Стикеры хранятся в формате сжатых изображений Base64 (Data URL) и не занимают место
                в бакетах Supabase Storage.
              </p>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 10,
                  marginBottom: 12,
                }}
              >
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

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 10,
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
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

              {stickerNotice && (
                <p className="notice" style={{ marginBottom: 12 }}>
                  {stickerNotice}
                </p>
              )}

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
                      <div style={{ fontSize: 12, fontWeight: 600, textAlign: 'center' }}>
                        {stk.title}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {stk.pack} · {sizeKb} КБ
                      </div>
                      {isCustom ? (
                        <button
                          type="button"
                          className="btn"
                          style={{
                            width: '100%',
                            padding: '4px 8px',
                            fontSize: 11,
                            color: 'var(--danger)',
                          }}
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
          </section>
        )}
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
