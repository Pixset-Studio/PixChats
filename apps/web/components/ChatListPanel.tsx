'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getSupabaseClient,
  getCurrentProfile,
  getLastMessagesForChats,
  getDirectChatPartners,
  globalSearch,
  joinPublicChat,
  getUnreadCounts,
  getMuteStates,
  decryptMessageE2EE,
  getOrCreateSavedMessagesChat,
  isSavedMessagesChat,
} from '@pixchats/core';
import type { Chat, Profile, Message, SearchResult, MuteState } from '@pixchats/core';
import { NameWithBadges } from './NameBadges';
import { VerifiedBadge } from './VerifiedBadge';
import { AvatarWithStatus } from './AvatarWithStatus';
import { ReadStatusTicks } from './ReadStatusTicks';
import { ChatListSkeleton } from './Loading';
import { getChatListCache, setChatListCache, clearChatListCache } from '../lib/chatListCache';
import { SearchIcon, PlusIcon, ChatsIcon } from './Icons';
import {
  getArchivedChatIds,
  getCustomFolders,
  createCustomFolder,
  deleteCustomFolder,
  toggleArchiveChat,
  type CustomChatFolder,
} from '../lib/chatFolders';
import { parsePollMessage, extractSelfDestructInfo } from './FormattedMessageText';
import { getHiddenChatIds, getAppLockConfig, lockSessionNow } from '../lib/appLock';
import { isStickerTagText } from '../lib/stickers';
import { extractTopicFromText } from '../lib/channelConfig';

const TYPE_LABEL: Record<Chat['type'], string> = {
  direct: 'Личный чат',
  group: 'Группа',
  channel: 'Канал',
};

type FolderFilter = 'all' | 'direct' | 'group' | 'channel' | 'archive' | string;

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

function isMessageRead(chatId: string, message: Message, partnerReadMap: Record<string, string>): boolean {
  const partnerReadAt = partnerReadMap[chatId];
  if (!partnerReadAt) return false;
  return new Date(partnerReadAt).getTime() >= new Date(message.sent_at).getTime();
}

function formatPreviewText(message: Message): string {
  if (message.is_deleted || message.text === 'Сообщение удалено') {
    return '';
  }
  if (message.caption === '__VIDEONOTE__' || message.text?.startsWith('__VIDEONOTE__')) {
    return '🎥 Видеосообщение (кружочек)';
  }
  switch (message.message_type) {
    case 'image':
      return '📷 Фото';
    case 'video':
      return '🎥 Видео';
    case 'audio':
      return '🎵 Аудио';
    case 'voice':
      return '🎤 Голосовое сообщение';
    case 'file':
      return `📎 ${message.text}`;
    default: {
      const { expiresAt, cleanText } = extractSelfDestructInfo(message.text || '');
      const { cleanText: topicCleaned } = extractTopicFromText(cleanText);
      if (isStickerTagText(topicCleaned)) {
        return '👾 Стикер';
      }
      const poll = parsePollMessage(topicCleaned);
      if (poll) {
        return `📊 Опрос: ${poll.question}`;
      }
      return expiresAt ? `🔥 ${topicCleaned}` : topicCleaned;
    }
  }
}

export function ChatListPanel() {
  const router = useRouter();
  const cache = getChatListCache();
  const [profile, setProfile] = useState<Profile | null>(cache?.profile ?? null);
  const [chats, setChats] = useState<Chat[]>(cache?.chats ?? []);
  const [previews, setPreviews] = useState<Record<string, Message>>(cache?.previews ?? {});
  const [partners, setPartners] = useState<Record<string, Profile>>(cache?.partners ?? {});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>(cache?.unreadCounts ?? {});
  const [muteStates, setMuteStates] = useState<Record<string, MuteState>>(cache?.muteStates ?? {});
  const [partnerLastRead, setPartnerLastRead] = useState<Record<string, string>>({});
  const [folder, setFolder] = useState<FolderFilter>('all');
  const [loading, setLoading] = useState(!cache);
  const [animateList] = useState(!cache);

  const [activeChatId, setActiveChatId] = useState<string | null>(() =>
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('id') : null
  );

  // Архив, скрытые чаты под PIN-кодом и кастомные папки (Пункты 6 и 8)
  const [archivedChatIds, setArchivedChatIds] = useState<string[]>([]);
  const [hiddenChatIds, setHiddenChatIds] = useState<string[]>([]);
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  const [appLockPin, setAppLockPin] = useState('');
  const [customFolders, setCustomFolders] = useState<CustomChatFolder[]>([]);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedForNewFolder, setSelectedForNewFolder] = useState<string[]>([]);
  const [liveActivities, setLiveActivities] = useState<Record<string, string>>({});

  useEffect(() => {
    const syncActiveChat = () => {
      if (typeof window !== 'undefined') {
        setActiveChatId(new URLSearchParams(window.location.search).get('id'));
      }
    };
    syncActiveChat();
    window.addEventListener('popstate', syncActiveChat);
    return () => window.removeEventListener('popstate', syncActiveChat);
  }, []);

  useEffect(() => {
    const syncFolders = () => {
      setArchivedChatIds(getArchivedChatIds());
      setHiddenChatIds(getHiddenChatIds());
      setCustomFolders(getCustomFolders());
      const lockCfg = getAppLockConfig();
      setAppLockEnabled(Boolean(lockCfg.enabled && lockCfg.pinCode));
      setAppLockPin(lockCfg.pinCode || '');
    };
    syncFolders();
    window.addEventListener('pixchats:folders_changed', syncFolders);
    window.addEventListener('pixchats:applock_changed', syncFolders);
    window.addEventListener('storage', syncFolders);
    return () => {
      window.removeEventListener('pixchats:folders_changed', syncFolders);
      window.removeEventListener('pixchats:applock_changed', syncFolders);
      window.removeEventListener('storage', syncFolders);
    };
  }, []);

  // Закреплённые чаты
  const [pinnedChatIds, setPinnedChatIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      return JSON.parse(localStorage.getItem('pixchats:pinned_chats') || '[]');
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const syncPinned = () => {
      try {
        setPinnedChatIds(JSON.parse(localStorage.getItem('pixchats:pinned_chats') || '[]'));
      } catch {}
    };
    window.addEventListener('pixchats:pinned_changed', syncPinned);
    window.addEventListener('storage', syncPinned);
    return () => {
      window.removeEventListener('pixchats:pinned_changed', syncPinned);
      window.removeEventListener('storage', syncPinned);
    };
  }, []);

  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());

  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  async function loadChats(me: Profile) {
    const supabase = getSupabaseClient();
    const { data: memberRows } = await supabase.from('chat_members').select('chat_id').eq('user_id', me.id);
    const chatIds = (memberRows ?? []).map((r) => r.chat_id);

    if (chatIds.length > 0) {
      const { data: chatRows } = await supabase.from('chats').select('*').in('id', chatIds);
      setChats(chatRows ?? []);
      setPreviews(await getLastMessagesForChats(chatIds));

      const directIds = (chatRows ?? []).filter((c) => c.type === 'direct').map((c) => c.id);
      setPartners(await getDirectChatPartners(directIds, me.id));

      setUnreadCounts(await getUnreadCounts(chatIds, me.id));
      setMuteStates(await getMuteStates(chatIds, me.id));

      try {
        const { data: readRows } = await supabase
          .from('chat_read_state')
          .select('chat_id, user_id, last_read_at')
          .in('chat_id', chatIds)
          .neq('user_id', me.id);
        if (readRows && readRows.length > 0) {
          const map: Record<string, string> = {};
          for (const r of readRows) {
            if (r.last_read_at) {
              if (!map[r.chat_id] || new Date(r.last_read_at).getTime() > new Date(map[r.chat_id]).getTime()) {
                map[r.chat_id] = r.last_read_at;
              }
            }
          }
          setPartnerLastRead(map);
        }
      } catch {}
    } else {
      setChats([]);
      setPreviews({});
      setPartners({});
      setUnreadCounts({});
      setMuteStates({});
    }
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      const me = await getCurrentProfile();
      if (!me) return;
      if (getChatListCache() && getChatListCache()!.profile.id !== me.id) {
        clearChatListCache();
        setChats([]);
        setPreviews({});
        setPartners({});
        setUnreadCounts({});
        setMuteStates({});
        setLoading(true);
      }
      setProfile(me);
      await loadChats(me);
    })();
  }, []);

  useEffect(() => {
    if (!profile) return;
    const supabase = getSupabaseClient();

    const messagesChannel = supabase
      .channel('chat-list-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload: any) => {
        const row = payload.new;
        if (!row || row.is_deleted) return;

        const decryptedText = await decryptMessageE2EE(row.chat_id, row.ciphertext);

        setPreviews((prev) => ({
          ...prev,
          [row.chat_id]: {
            id: row.id,
            chat_id: row.chat_id,
            sender_id: row.sender_id,
            text: decryptedText,
            message_type: row.message_type,
            media_path: row.media_path,
            caption: row.caption,
            caption_position: row.caption_position ?? 'below',
            sent_at: row.sent_at,
            reply_to_id: row.reply_to_id,
            edited_at: row.edited_at,
            is_deleted: row.is_deleted,
            forwarded_from_chat_id: row.forwarded_from_chat_id,
          },
        }));

        if (row.sender_id !== profile.id) {
          setFlashIds((prev) => new Set(prev).add(row.chat_id));
          setTimeout(() => {
            setFlashIds((prev) => {
              const next = new Set(prev);
              next.delete(row.chat_id);
              return next;
            });
          }, 1400);

          const isCurrentlyOpenChat =
            typeof window !== 'undefined' &&
            window.location.pathname.includes('/chat/') &&
            window.location.search.includes(String(row.chat_id));

          if (!isCurrentlyOpenChat) {
            setUnreadCounts((prev) => ({ ...prev, [row.chat_id]: (prev[row.chat_id] ?? 0) + 1 }));
          }
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, async (payload: any) => {
        const row = payload.new;
        if (!row?.chat_id) return;
        const updatedPreviews = await getLastMessagesForChats([row.chat_id]);
        setPreviews((prev) => {
          const next = { ...prev };
          if (updatedPreviews[row.chat_id]) {
            next[row.chat_id] = updatedPreviews[row.chat_id];
          } else {
            delete next[row.chat_id];
          }
          return next;
        });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, async () => {
        loadChats(profile);
      })
      .subscribe();

    const onLocalMessageDeleted = async (e: Event) => {
      const detail = (e as CustomEvent<{ messageId?: string; chatId?: string }>).detail;
      if (detail?.chatId) {
        const updatedPreviews = await getLastMessagesForChats([detail.chatId]);
        setPreviews((prev) => {
          const next = { ...prev };
          if (updatedPreviews[detail.chatId!]) {
            next[detail.chatId!] = updatedPreviews[detail.chatId!];
          } else {
            delete next[detail.chatId!];
          }
          return next;
        });
      } else {
        loadChats(profile);
      }
    };
    window.addEventListener('pixchats:message_deleted', onLocalMessageDeleted);

    const readStateChannel = supabase
      .channel('chat-list-read-state')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_read_state' },
        async (payload: any) => {
          const row = payload.new || payload.old;
          const chatId = row?.chat_id;
          if (!chatId) return;
          if (row?.user_id && row.user_id !== profile.id && row.last_read_at) {
            setPartnerLastRead((prev) => ({ ...prev, [chatId]: row.last_read_at }));
          }
          const counts = await getUnreadCounts([chatId], profile.id);
          setUnreadCounts((prev) => ({ ...prev, [chatId]: counts[chatId] ?? 0 }));
        }
      )
      .subscribe();

    const membersChannel = supabase
      .channel('chat-list-members')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_members', filter: `user_id=eq.${profile.id}` },
        () => {
          loadChats(profile);
        }
      )
      .subscribe();

    const typingGlobalChannel = supabase
      .channel('pixchats-typing-global')
      .on('broadcast', { event: 'activity' }, ({ payload }: any) => {
        if (!payload?.chatId || !payload?.userId || payload.userId === profile.id) return;
        const label =
          payload.status === 'recording_voice'
            ? `🎤 ${payload.name || 'Собеседник'} записывает голосовое…`
            : payload.status === 'recording_video'
              ? `🎥 ${payload.name || 'Собеседник'} записывает кружочек…`
              : `✍️ ${payload.name || 'Собеседник'} печатает…`;

        setLiveActivities((prev) => ({ ...prev, [payload.chatId]: label }));
        setTimeout(() => {
          setLiveActivities((prev) => {
            const copy = { ...prev };
            delete copy[payload.chatId];
            return copy;
          });
        }, 3800);
      })
      .subscribe();

    return () => {
      window.removeEventListener('pixchats:message_deleted', onLocalMessageDeleted);
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(readStateChannel);
      supabase.removeChannel(membersChannel);
      supabase.removeChannel(typingGlobalChannel);
    };
  }, [profile]);

  useEffect(() => {
    if (profile && !loading) {
      setChatListCache({ profile, chats, previews, partners, unreadCounts, muteStates });
    }
  }, [profile, loading, chats, previews, partners, unreadCounts, muteStates]);

  useEffect(() => {
    if (!profile) return;
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const timeout = setTimeout(async () => {
      try {
        setSearchResults(await globalSearch(query, profile.id));
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timeout);
  }, [query, profile]);

  async function handleOpenUser(userId: string) {
    router.push(`/user/?id=${userId}`);
  }

  async function handleOpenChat(chat: Chat) {
    try {
      await joinPublicChat(chat);
    } catch {
      // уже участник
    }
    router.push(`/chat/?id=${chat.id}`);
  }

  async function handleOpenSavedMessages() {
    if (!profile) return;
    try {
      const saved = await getOrCreateSavedMessagesChat(profile.id);
      if (!chats.some((c) => c.id === saved.id)) {
        setChats((prev) => [saved, ...prev]);
      }
      setActiveChatId(saved.id);
      router.push(`/chat/?id=${saved.id}`);
    } catch {}
  }

  function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    const created = createCustomFolder(newFolderName.trim(), selectedForNewFolder);
    setCustomFolders(getCustomFolders());
    setFolder(created.id);
    setNewFolderName('');
    setSelectedForNewFolder([]);
    setShowNewFolderModal(false);
  }

  if (loading || !profile) return <ChatListSkeleton />;

  const archivedCount = chats.filter((c) => archivedChatIds.includes(c.id) && !hiddenChatIds.includes(c.id)).length;

  const filtered = chats.filter((c) => {
    // Скрытые под PIN-кодом чаты не видны в обычном списке
    if (hiddenChatIds.includes(c.id)) return false;

    const isArch = archivedChatIds.includes(c.id);
    if (folder === 'archive') return isArch;
    // Кастомная папка
    const custom = customFolders.find((cf) => cf.id === folder);
    if (custom) {
      return custom.chatIds.includes(c.id);
    }
    // Стандартные папки скрывают заархивированные чаты
    if (isArch) return false;
    if (folder === 'all') return true;
    return c.type === folder;
  });

  const sorted = [...filtered].sort((a, b) => {
    const aSaved = isSavedMessagesChat(a, profile.id);
    const bSaved = isSavedMessagesChat(b, profile.id);
    const aPin = pinnedChatIds.includes(a.id) || aSaved;
    const bPin = pinnedChatIds.includes(b.id) || bSaved;
    if (aPin && !bPin) return -1;
    if (!aPin && bPin) return 1;
    const ta = previews[a.id]?.sent_at ?? a.created_at;
    const tb = previews[b.id]?.sent_at ?? b.created_at;
    return new Date(tb).getTime() - new Date(ta).getTime();
  });

  const q = query.trim().toLowerCase();
  const isSecretPinEntered = Boolean(appLockPin && query.trim() === appLockPin.trim());

  const matchedLocalChats = q
    ? chats.filter((c) => {
        const isHidden = hiddenChatIds.includes(c.id);
        // Если введён секретный PIN-код в строку поиска — показываем скрытые чаты!
        if (isSecretPinEntered) {
          return isHidden;
        }
        if (isHidden) return false;

        const isSaved = isSavedMessagesChat(c, profile.id);
        const partner = c.type === 'direct' && !isSaved ? partners[c.id] : null;
        const titleMatch = (isSaved ? 'избранное заметки' : c.title?.toLowerCase() ?? '').includes(q);
        const usernameMatch = c.username?.toLowerCase().includes(q);
        const partnerNameMatch = partner?.display_name.toLowerCase().includes(q);
        const partnerUserMatch = partner?.username.toLowerCase().includes(q);
        const previewMatch = previews[c.id]?.text?.toLowerCase().includes(q);
        return titleMatch || usernameMatch || partnerNameMatch || partnerUserMatch || previewMatch;
      })
    : [];

  const isSearchMode = query.trim().length > 0;

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <SearchIcon
            size={16}
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}
          />
          <input
            className="input"
            style={{ width: '100%', paddingLeft: 36 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по чатам, сообщениям или @username…"
          />
        </div>
        {appLockEnabled && (
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', padding: '0 11px', display: 'inline-flex', alignItems: 'center' }}
            onClick={() => lockSessionNow()}
            title="Заблокировать экран под PIN-код"
          >
            <span>🔒</span>
          </button>
        )}
        <button
          type="button"
          className="btn"
          style={{ width: 'auto', padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 5 }}
          onClick={handleOpenSavedMessages}
          title="Открыть «Избранное» (Сохранённые сообщения и заметки)"
        >
          <span>⭐</span>
        </button>
        <Link
          href="/chats/new"
          className="btn btn-primary"
          style={{ width: 'auto', padding: '0 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <PlusIcon size={16} />
          <span>Создать</span>
        </Link>
      </div>

      {!isSearchMode && (
        <div className="folder-tabs" style={{ flexWrap: 'wrap', gap: 6 }}>
          <button className={`folder-tab ${folder === 'all' ? 'active' : ''}`} onClick={() => setFolder('all')}>
            Все
          </button>
          <button className={`folder-tab ${folder === 'direct' ? 'active' : ''}`} onClick={() => setFolder('direct')}>
            Личные
          </button>
          <button className={`folder-tab ${folder === 'group' ? 'active' : ''}`} onClick={() => setFolder('group')}>
            Группы
          </button>
          <button className={`folder-tab ${folder === 'channel' ? 'active' : ''}`} onClick={() => setFolder('channel')}>
            Каналы
          </button>

          {customFolders.map((cf) => (
            <span key={cf.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button
                type="button"
                className={`folder-tab ${folder === cf.id ? 'active' : ''}`}
                onClick={() => setFolder(cf.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                <span>📁 {cf.name}</span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteCustomFolder(cf.id);
                    if (folder === cf.id) setFolder('all');
                  }}
                  title="Удалить папку"
                  style={{ opacity: 0.65, fontSize: 11, marginLeft: 2 }}
                >
                  ✕
                </span>
              </button>
            </span>
          ))}

          {archivedCount > 0 && (
            <button
              type="button"
              className={`folder-tab ${folder === 'archive' ? 'active' : ''}`}
              onClick={() => setFolder('archive')}
            >
              📦 Архив ({archivedCount})
            </button>
          )}

          <button
            type="button"
            className="folder-tab"
            onClick={() => setShowNewFolderModal(true)}
            title="Создать свою папку чатов"
          >
            + Папка
          </button>
        </div>
      )}

      {showNewFolderModal && (
        <div className="modal-overlay" onClick={() => setShowNewFolderModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <h3 style={{ marginTop: 0 }}>Создать папку чатов</h3>
            <form onSubmit={handleCreateFolder}>
              <div className="field">
                <label>Название папки</label>
                <input
                  className="input"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Например: Работа, Игры, Важное"
                  required
                />
              </div>

              {chats.length > 0 && (
                <div className="field">
                  <label>Выберите чаты для папки</label>
                  <div
                    style={{
                      maxHeight: 180,
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      padding: 6,
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                    }}
                  >
                    {chats.map((c) => {
                      const isSaved = isSavedMessagesChat(c, profile.id);
                      const partner = c.type === 'direct' && !isSaved ? partners[c.id] : null;
                      const label = isSaved
                        ? '⭐ Избранное'
                        : partner
                          ? partner.display_name
                          : c.title ?? TYPE_LABEL[c.type];
                      const checked = selectedForNewFolder.includes(c.id);
                      return (
                        <label
                          key={c.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 13,
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setSelectedForNewFolder((prev) =>
                                e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                              );
                            }}
                          />
                          <span>{label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="button" className="btn" style={{ width: 'auto' }} onClick={() => setShowNewFolderModal(false)}>
                  Отмена
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>
                  Создать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isSearchMode ? (
        <div>
          {matchedLocalChats.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div
                className="section-title"
                style={{
                  fontSize: 13,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--accent)',
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <ChatsIcon size={16} />
                <span>В ваших чатах ({matchedLocalChats.length})</span>
              </div>
              {matchedLocalChats.map((chat) => {
                const isSaved = isSavedMessagesChat(chat, profile.id);
                const preview = previews[chat.id];
                const partner = chat.type === 'direct' && !isSaved ? partners[chat.id] : null;
                const displayName = isSaved
                  ? 'Избранное'
                  : partner
                    ? partner.display_name
                    : chat.title ?? TYPE_LABEL[chat.type];
                const avatarUrl = isSaved ? null : partner ? partner.avatar_url : chat.avatar_url;
                const isVerified = isSaved ? false : partner ? partner.is_verified : chat.is_verified;

                return (
                  <Link
                    key={`local-${chat.id}`}
                    href={`/chat/?id=${chat.id}`}
                    onClick={() => setActiveChatId(chat.id)}
                    className={`chat-item-preview${activeChatId === chat.id ? ' active' : ''}`}
                  >
                    <AvatarWithStatus
                      avatarUrl={avatarUrl}
                      name={displayName}
                      size={40}
                      isSaved={isSaved}
                      statusType={
                        partner && (new Date().getTime() - new Date(partner.last_seen || 0).getTime() < 180000 || Boolean(liveActivities[chat.id]))
                          ? 'online'
                          : 'none'
                      }
                    />
                    <div className="chat-item-body">
                      <div className="chat-item-top-row">
                        <span className="chat-item-name">
                          {displayName}
                          {isVerified && <VerifiedBadge size={14} />}
                        </span>
                        {preview && <span className="chat-item-time">{formatTime(preview.sent_at)}</span>}
                      </div>
                      <div className="chat-item-preview-text" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {preview
                            ? formatPreviewText(preview)
                            : isSaved
                              ? 'Сохранённые сообщения и заметки'
                              : `${TYPE_LABEL[chat.type]}${chat.username ? ` · @${chat.username}` : ''}`}
                        </span>
                        {preview && preview.sender_id === profile.id && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                            <ReadStatusTicks
                              status={isMessageRead(chat.id, preview, partnerLastRead) ? 'read' : 'sent'}
                              size={13}
                            />
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {searching ? (
            <p style={{ color: 'var(--text-muted)' }}>Ищем в глобальном поиске…</p>
          ) : searchResults.length > 0 ? (
            <div>
              <div className="section-title" style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
                🌐 Глобальный поиск
              </div>
              {searchResults.map((result) =>
                result.kind === 'user' ? (
                  <div
                    key={`user-${result.profile.id}`}
                    className="chat-item-preview"
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleOpenUser(result.profile.id)}
                  >
                    <div
                      className={`avatar ${!result.profile.avatar_url ? 'avatar-fallback' : ''}`}
                      style={{
                        backgroundImage: result.profile.avatar_url ? `url(${result.profile.avatar_url})` : undefined,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }}
                    >
                      {!result.profile.avatar_url && result.profile.display_name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="chat-item-body">
                      <div className="chat-item-name">
                        <NameWithBadges
                          name={result.profile.display_name}
                          role={result.profile.role}
                          isVerified={result.profile.is_verified}
                          isPixsetEmployee={result.profile.is_pixset_employee}
                          isFrozen={result.profile.frozen}
                        />
                      </div>
                      <div className="chat-item-preview-text">@{result.profile.username} · пользователь</div>
                    </div>
                  </div>
                ) : (
                  <div
                    key={`chat-${result.chat.id}`}
                    className="chat-item-preview"
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleOpenChat(result.chat)}
                  >
                    <div
                      className={`avatar ${!result.chat.avatar_url ? 'avatar-fallback' : ''}`}
                      style={{
                        backgroundImage: result.chat.avatar_url ? `url(${result.chat.avatar_url})` : undefined,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }}
                    >
                      {!result.chat.avatar_url && (result.chat.title ?? '#').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="chat-item-body">
                      <div className="chat-item-name">
                        {result.chat.title}
                        {result.chat.is_verified && <VerifiedBadge size={14} />}
                      </div>
                      <div className="chat-item-preview-text">
                        {TYPE_LABEL[result.chat.type]}
                        {result.chat.username ? ` · @${result.chat.username}` : ''}
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>
          ) : matchedLocalChats.length === 0 ? (
            <div className="empty-state">Ничего не найдено ни в ваших чатах, ни глобально.</div>
          ) : null}
        </div>
      ) : sorted.length === 0 ? (
        <div className="empty-state">
          {folder === 'archive' ? 'В архиве пока нет чатов.' : 'Пока пусто в этой папке.'}
        </div>
      ) : (
        <div className={animateList ? 'stagger-list' : undefined}>
          {sorted.map((chat, index) => {
            const isSaved = isSavedMessagesChat(chat, profile.id);
            const preview = previews[chat.id];
            const partner = chat.type === 'direct' && !isSaved ? partners[chat.id] : null;
            const displayName = isSaved
              ? 'Избранное'
              : partner
                ? partner.display_name
                : chat.title ?? TYPE_LABEL[chat.type];
            const avatarUrl = isSaved ? null : partner ? partner.avatar_url : chat.avatar_url;
            const isVerified = isSaved ? false : partner ? partner.is_verified : chat.is_verified;

            const isPinned = pinnedChatIds.includes(chat.id) || isSaved;

            return (
              <Link
                key={chat.id}
                href={`/chat/?id=${chat.id}`}
                onClick={() => setActiveChatId(chat.id)}
                className={`chat-item-preview${activeChatId === chat.id ? ' active' : ''}${flashIds.has(chat.id) ? ' flash' : ''}${isPinned ? ' is-pinned' : ''}`}
                style={{ '--i': index } as React.CSSProperties}
              >
                <AvatarWithStatus
                  avatarUrl={avatarUrl}
                  name={displayName}
                  size={42}
                  isSaved={isSaved}
                  statusType={
                    partner && (new Date().getTime() - new Date(partner.last_seen || 0).getTime() < 180000 || Boolean(liveActivities[chat.id]))
                      ? 'online'
                      : 'none'
                  }
                />
                <div className="chat-item-body">
                  <div className="chat-item-top-row">
                    <span className="chat-item-name" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {isPinned && !isSaved && <span className="pinned-badge" title="Закреплённый чат">📌</span>}
                      <span>{displayName}</span>
                      {isVerified && <VerifiedBadge size={14} />}
                    </span>
                    {preview && <span className="chat-item-time">{formatTime(preview.sent_at)}</span>}
                  </div>
                  <div className="chat-item-preview-text" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: liveActivities[chat.id] ? 'var(--accent)' : undefined,
                        fontWeight: liveActivities[chat.id] ? 600 : undefined,
                      }}
                    >
                      {liveActivities[chat.id]
                        ? liveActivities[chat.id]
                        : preview
                          ? formatPreviewText(preview)
                          : isSaved
                            ? 'Личное облако заметок и файлов'
                            : `${TYPE_LABEL[chat.type]}${chat.visibility ? ` · ${chat.visibility === 'public' ? 'публичный' : 'приватный'}` : ''}`}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexShrink: 0 }}>
                      {preview && preview.sender_id === profile.id && (
                        <ReadStatusTicks
                          status={isMessageRead(chat.id, preview, partnerLastRead) ? 'read' : 'sent'}
                          size={13}
                        />
                      )}
                      {unreadCounts[chat.id] > 0 && (
                        <span
                          key={unreadCounts[chat.id]}
                          className={`unread-badge ${muteStates[chat.id]?.muted ? 'muted' : ''}`}
                        >
                          {unreadCounts[chat.id] > 99 ? '99+' : unreadCounts[chat.id]}
                        </span>
                      )}
                      {folder === 'archive' && (
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ width: 'auto', padding: '1px 6px', fontSize: 11, flexShrink: 0 }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleArchiveChat(chat.id);
                          }}
                          title="Вернуть из архива"
                        >
                          Вернуть
                        </button>
                      )}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <div style={{ height: 48, flexShrink: 0 }} aria-hidden="true" />
    </div>
  );
}

