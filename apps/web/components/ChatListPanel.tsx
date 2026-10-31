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
} from '@pixchats/core';
import type { Chat, Profile, Message, SearchResult, MuteState } from '@pixchats/core';
import { NameWithBadges } from './NameBadges';
import { VerifiedBadge } from './VerifiedBadge';
import { ChatListSkeleton } from './Loading';
import { getChatListCache, setChatListCache, clearChatListCache } from '../lib/chatListCache';
import { SearchIcon, PlusIcon, ChatsIcon } from './Icons';

const TYPE_LABEL: Record<Chat['type'], string> = {
  direct: 'Личный чат',
  group: 'Группа',
  channel: 'Канал',
};

type Folder = 'all' | 'direct' | 'group' | 'channel';

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

function formatPreviewText(message: Message): string {
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
    default:
      return message.text;
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
  const [folder, setFolder] = useState<Folder>('all');
  const [loading, setLoading] = useState(!cache);
  // Каскадное появление строк — только при самой первой загрузке, а не при каждом переходе между чатами
  const [animateList] = useState(!cache);
  // Какой чат сейчас открыт (подсветка на ПК-раскладке)
  const [activeChatId] = useState<string | null>(() =>
    typeof window !== 'undefined' && window.location.pathname.includes('/chat/')
      ? new URLSearchParams(window.location.search).get('id')
      : null
  );
  // Чаты, в которые только что пришло сообщение — на секунду подсвечиваем строку
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
      // Кэш от другого аккаунта (выход/вход в одной вкладке) — не показываем чужое
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

  // Живые обновления: новое сообщение — обновляем превью/непрочитанные и пересортировываем;
  // прочитанное в открытом чате (в соседней панели на ПК) — сбрасываем счётчик тут же;
  // добавили в новый чат — перезагружаем список целиком.
  useEffect(() => {
    if (!profile) return;
    const supabase = getSupabaseClient();

    const messagesChannel = supabase
      .channel('chat-list-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload: any) => {
        const row = payload.new;
        if (!row) return;

        setPreviews((prev) => ({
          ...prev,
          [row.chat_id]: {
            id: row.id,
            chat_id: row.chat_id,
            sender_id: row.sender_id,
            text: (() => {
              try {
                return decodeURIComponent(escape(atob(row.ciphertext)));
              } catch {
                return '';
              }
            })(),
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
      .subscribe();

    const readStateChannel = supabase
      .channel('chat-list-read-state')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_read_state', filter: `user_id=eq.${profile.id}` },
        async (payload: any) => {
          const chatId = payload.new?.chat_id ?? payload.old?.chat_id;
          if (!chatId) return;
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

    return () => {
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(readStateChannel);
      supabase.removeChannel(membersChannel);
    };
  }, [profile]);

  // Любые изменения (в т.ч. живые) сразу пишем в кэш — следующий переход между страницами покажет актуальный список мгновенно
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

  if (loading || !profile) return <ChatListSkeleton />;

  const filtered = chats.filter((c) => folder === 'all' || c.type === folder);
  const sorted = [...filtered].sort((a, b) => {
    const ta = previews[a.id]?.sent_at ?? a.created_at;
    const tb = previews[b.id]?.sent_at ?? b.created_at;
    return new Date(tb).getTime() - new Date(ta).getTime();
  });

  const q = query.trim().toLowerCase();
  const matchedLocalChats = q
    ? chats.filter((c) => {
        const partner = c.type === 'direct' ? partners[c.id] : null;
        const titleMatch = c.title?.toLowerCase().includes(q);
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
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
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
        <Link
          href="/chats/new"
          className="btn btn-primary"
          style={{ width: 'auto', padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <PlusIcon size={16} />
          <span>Создать</span>
        </Link>
      </div>

      {!isSearchMode && (
        <div className="folder-tabs">
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
                const preview = previews[chat.id];
                const partner = chat.type === 'direct' ? partners[chat.id] : null;
                const displayName = partner ? partner.display_name : chat.title ?? TYPE_LABEL[chat.type];
                const avatarUrl = partner ? partner.avatar_url : chat.avatar_url;
                const isVerified = partner ? partner.is_verified : chat.is_verified;

                return (
                  <Link
                    key={`local-${chat.id}`}
                    href={`/chat/?id=${chat.id}`}
                    className={`chat-item-preview${activeChatId === chat.id ? ' active' : ''}`}
                  >
                    <div
                      className="avatar"
                      style={{
                        backgroundImage: avatarUrl ? `url(${avatarUrl})` : undefined,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }}
                    >
                      {!avatarUrl && displayName.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="chat-item-body">
                      <div className="chat-item-top-row">
                        <span className="chat-item-name">
                          {displayName}
                          {isVerified && <VerifiedBadge size={14} />}
                        </span>
                        {preview && <span className="chat-item-time">{formatTime(preview.sent_at)}</span>}
                      </div>
                      <div className="chat-item-preview-text">
                        {preview
                          ? formatPreviewText(preview)
                          : `${TYPE_LABEL[chat.type]}${chat.username ? ` · @${chat.username}` : ''}`}
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
                      className="avatar"
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
                      className="avatar"
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
        <div className="empty-state">Пока пусто в этой папке.</div>
      ) : (
        <div className={animateList ? 'stagger-list' : undefined}>
          {sorted.map((chat, index) => {
            const preview = previews[chat.id];
            const partner = chat.type === 'direct' ? partners[chat.id] : null;
            const displayName = partner ? partner.display_name : chat.title ?? TYPE_LABEL[chat.type];
            const avatarUrl = partner ? partner.avatar_url : chat.avatar_url;
            const isVerified = partner ? partner.is_verified : chat.is_verified;

            return (
              <Link
                key={chat.id}
                href={`/chat/?id=${chat.id}`}
                className={`chat-item-preview${activeChatId === chat.id ? ' active' : ''}${flashIds.has(chat.id) ? ' flash' : ''}`}
                style={{ '--i': index } as React.CSSProperties}
              >
                <div
                  className="avatar"
                  style={{
                    backgroundImage: avatarUrl ? `url(${avatarUrl})` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                >
                  {!avatarUrl && displayName.slice(0, 1).toUpperCase()}
                </div>
                <div className="chat-item-body">
                  <div className="chat-item-top-row">
                    <span className="chat-item-name">
                      {displayName}
                      {isVerified && <VerifiedBadge size={14} />}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      {preview && <span className="chat-item-time">{formatTime(preview.sent_at)}</span>}
                      {unreadCounts[chat.id] > 0 && (
                        <span
                          key={unreadCounts[chat.id]}
                          className={`unread-badge ${muteStates[chat.id]?.muted ? 'muted' : ''}`}
                        >
                          {unreadCounts[chat.id] > 99 ? '99+' : unreadCounts[chat.id]}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="chat-item-preview-text">
                    {preview
                      ? formatPreviewText(preview)
                      : `${TYPE_LABEL[chat.type]}${chat.visibility ? ` · ${chat.visibility === 'public' ? 'публичный' : 'приватный'}` : ''}`}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
