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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [previews, setPreviews] = useState<Record<string, Message>>({});
  const [partners, setPartners] = useState<Record<string, Profile>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [muteStates, setMuteStates] = useState<Record<string, MuteState>>({});
  const [folder, setFolder] = useState<Folder>('all');
  const [loading, setLoading] = useState(true);

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
    }
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      const me = await getCurrentProfile();
      if (!me) return;
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

  if (loading || !profile) return <p style={{ padding: 16, color: 'var(--text-muted)' }}>Загрузка…</p>;

  const filtered = chats.filter((c) => folder === 'all' || c.type === folder);
  const sorted = [...filtered].sort((a, b) => {
    const ta = previews[a.id]?.sent_at ?? a.created_at;
    const tb = previews[b.id]?.sent_at ?? b.created_at;
    return new Date(tb).getTime() - new Date(ta).getTime();
  });

  const isSearchMode = query.trim().length > 0;

  return (
    <div>
      <input
        className="input"
        style={{ marginBottom: 12 }}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск: @юзернейм или имя/название…"
      />

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
        searching ? (
          <p style={{ color: 'var(--text-muted)' }}>Ищем…</p>
        ) : searchResults.length === 0 ? (
          <div className="empty-state">Ничего не найдено.</div>
        ) : (
          <div>
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
        )
      ) : sorted.length === 0 ? (
        <div className="empty-state">Пока пусто в этой папке.</div>
      ) : (
        <div>
          {sorted.map((chat) => {
            const preview = previews[chat.id];
            const partner = chat.type === 'direct' ? partners[chat.id] : null;
            const displayName = partner ? partner.display_name : chat.title ?? TYPE_LABEL[chat.type];
            const avatarUrl = partner ? partner.avatar_url : chat.avatar_url;
            const isVerified = partner ? partner.is_verified : chat.is_verified;

            return (
              <Link key={chat.id} href={`/chat/?id=${chat.id}`} className="chat-item-preview">
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
                        <span className={`unread-badge ${muteStates[chat.id]?.muted ? 'muted' : ''}`}>
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
