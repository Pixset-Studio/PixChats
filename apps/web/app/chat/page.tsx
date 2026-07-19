'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { resolveLastSeenLabel } from '../../lib/lastSeen';
import { isBanned } from '../../lib/ban';
import { DesktopShell } from '../../components/DesktopShell';
import { buildAppUrl } from '../../lib/url';
import { VerifiedBadge } from '../../components/VerifiedBadge';
import { NameWithBadges } from '../../components/NameBadges';
import {
  getSupabaseClient,
  getCurrentProfile,
  getMessages,
  getMessageById,
  sendMessage,
  subscribeToMessages,
  getChatMemberCount,
  editMessage,
  deleteMessage,
  pinMessage,
  unpinMessage,
  forwardMessage,
  uploadMessageFile,
  getDirectChatPartners,
  isUserBlockedByMe,
  joinPublicChat,
  leaveChat,
  getMyChatRole,
  markChatAsRead,
} from '@pixchats/core';
import type { Message, Chat, Profile } from '@pixchats/core';

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDateDivider(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === now.toDateString()) return 'Сегодня';
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function ChatWindowInner() {
  const searchParams = useSearchParams();
  const chatId = searchParams.get('id') ?? '';
  const highlightMsgId = searchParams.get('msg');
  const router = useRouter();

  const [me, setMe] = useState<Profile | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [otherProfile, setOtherProfile] = useState<Profile | null>(null);
  const [otherLastSeen, setOtherLastSeen] = useState('');
  const [blockedEitherWay, setBlockedEitherWay] = useState(false);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [pinnedMessage, setPinnedMessage] = useState<Message | null>(null);
  const [canModerate, setCanModerate] = useState(false); // owner/admin этого чата

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [canWrite, setCanWrite] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [forwardTarget, setForwardTarget] = useState<Message | null>(null);
  const [myChats, setMyChats] = useState<Chat[]>([]);
  const [forwardPartners, setForwardPartners] = useState<Record<string, Profile>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [captionPosition, setCaptionPosition] = useState<'above' | 'below'>('below');
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const EMOJI_LIST = ['😀','😂','😍','😢','😡','👍','👎','🔥','🎉','❤️','🙏','😎','🤔','😭','👏','💀','✨','😴','🤝','😱'];

  function insertEmoji(emoji: string) {
    setDraft((prev) => prev + emoji);
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
        setUploading(true);
        try {
          const { url } = await uploadMessageFile(chatId, file);
          await sendMessage(chatId, 'Голосовое сообщение', { messageType: 'voice', mediaPath: url });
        } catch (err: any) {
          setNotice(err.message ?? 'Не удалось отправить голосовое');
          setTimeout(() => setNotice(null), 2000);
        } finally {
          setUploading(false);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch {
      setNotice('Нет доступа к микрофону');
      setTimeout(() => setNotice(null), 2000);
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }

  async function handleUnsubscribe() {
    if (!me) return;
    await leaveChat(chatId, me.id);
    router.push('/chats');
  }

  function detectMessageType(file: File): 'image' | 'video' | 'audio' | 'file' {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    return 'file';
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSendPendingFile() {
    if (!pendingFile) return;
    setUploading(true);
    try {
      const { url, name } = await uploadMessageFile(chatId, pendingFile);
      await sendMessage(chatId, name, {
        messageType: detectMessageType(pendingFile),
        mediaPath: url,
        caption: draft.trim() || undefined,
        captionPosition,
      });
      setPendingFile(null);
      setDraft('');
    } catch (err: any) {
      setNotice(err.message ?? 'Не удалось загрузить файл');
      setTimeout(() => setNotice(null), 2000);
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    if (!chatId) {
      router.push('/chats');
      return;
    }
    let unsubscribe: (() => void) | undefined;

    // Сброс состояния предыдущего чата — иначе, например, закреплённое сообщение
    // или профиль собеседника "утекали" в следующий открытый чат до завершения загрузки.
    setPinnedMessage(null);
    setOtherProfile(null);
    setOtherLastSeen('');
    setBlockedEitherWay(false);
    setMemberCount(0);
    setMyRole(null);
    setCanWrite(true);
    setCanModerate(false);
    setMessages([]);

    (async () => {
      const profile = await getCurrentProfile();
      if (!profile) {
        router.push('/login');
        return;
      }
      if (isBanned(profile)) {
        router.push('/banned');
        return;
      }
      setMe(profile);

      const supabase = getSupabaseClient();
      const { data: chatRow } = await supabase.from('chats').select('*').eq('id', chatId).single();
      setChat(chatRow);

      if (chatRow?.pinned_message_id) {
        setPinnedMessage(await getMessageById(chatRow.pinned_message_id));
      }

      if (chatRow?.type === 'direct') {
        const { data: memberRows } = await supabase.from('chat_members').select('user_id').eq('chat_id', chatId);
        const otherId = (memberRows ?? []).map((r) => r.user_id).find((id) => id !== profile.id);
        if (otherId) {
          const { data: otherRow } = await supabase.from('profiles').select('*').eq('id', otherId).single();
          setOtherProfile(otherRow);
          if (otherRow) {
            const iBlockedThem = await isUserBlockedByMe(profile.id, otherId);
            const theyBlockedMe = await isUserBlockedByMe(otherId, profile.id);
            const blocked = iBlockedThem || theyBlockedMe;
            setBlockedEitherWay(blocked);
            setOtherLastSeen(blocked ? 'был(а) давно' : await resolveLastSeenLabel(otherRow, profile.id));
          }
        }
      } else {
        setMemberCount(await getChatMemberCount(chatId));
      }

      const { data: memberRow } = await supabase
        .from('chat_members')
        .select('member_role')
        .eq('chat_id', chatId)
        .eq('user_id', profile.id)
        .maybeSingle();
      setMyRole(memberRow?.member_role ?? null);
      setCanWrite(memberRow?.member_role !== 'subscriber');
      setCanModerate(memberRow?.member_role === 'owner' || memberRow?.member_role === 'admin');

      setMessages(await getMessages(chatId));
      await markChatAsRead(profile.id, chatId);

      // Заморозка = никаких новых сообщений в реальном времени, только то, что уже было
      // загружено при открытии чата (перечитать историю можно, обновляясь вручную).
      if (!profile.frozen) {
        unsubscribe = subscribeToMessages(
          chatId,
          (msg) => {
            setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
            markChatAsRead(profile.id, chatId);
          },
          (msg) => setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)))
        );
      }
    })();

    return () => unsubscribe?.();
  }, [chatId, router]);

  // Прокрутка и подсветка при переходе по ссылке на конкретное сообщение
  useEffect(() => {
    if (highlightMsgId && messages.length > 0) {
      const el = messageRefs.current[highlightMsgId];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('message-highlight');
        setTimeout(() => el.classList.remove('message-highlight'), 2000);
      }
    } else {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, highlightMsgId]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();

    if (pendingFile) {
      await handleSendPendingFile();
      return;
    }

    if (!draft.trim()) return;
    const text = draft.trim();

    if (editingMessage) {
      await editMessage(editingMessage.id, text);
      setMessages((prev) =>
        prev.map((m) => (m.id === editingMessage.id ? { ...m, text, edited_at: new Date().toISOString() } : m))
      );
      setEditingMessage(null);
      setDraft('');
      return;
    }

    setDraft('');
    await sendMessage(chatId, text, { replyToId: replyingTo?.id });
    setReplyingTo(null);
  }

  async function handlePin(message: Message) {
    await pinMessage(chatId, message.id);
    setPinnedMessage(message);
    setOpenMenuId(null);
  }

  async function handleUnpin() {
    await unpinMessage(chatId);
    setPinnedMessage(null);
    setOpenMenuId(null);
  }

  async function handleDelete(message: Message) {
    await deleteMessage(message.id);
    setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, is_deleted: true, text: 'Сообщение удалено' } : m)));
    setOpenMenuId(null);
  }

  async function handleCopy(message: Message) {
    await navigator.clipboard.writeText(message.text);
    setOpenMenuId(null);
    setNotice('Скопировано');
    setTimeout(() => setNotice(null), 1500);
  }

  async function handleCopyLink(message: Message) {
    const url = buildAppUrl(`/chat/?id=${chatId}&msg=${message.id}`);
    await navigator.clipboard.writeText(url);
    setOpenMenuId(null);
    setNotice('Ссылка скопирована');
    setTimeout(() => setNotice(null), 1500);
  }

  async function openForwardModal(message: Message) {
    setOpenMenuId(null);
    if (me) {
      const supabase = getSupabaseClient();
      const { data: memberRows } = await supabase
        .from('chat_members')
        .select('chat_id, member_role')
        .eq('user_id', me.id)
        .neq('member_role', 'subscriber'); // нельзя пересылать в чаты, куда сам не можешь писать
      const ids = (memberRows ?? []).map((r) => r.chat_id).filter((id) => id !== chatId);
      if (ids.length > 0) {
        const { data: chatRows } = await supabase.from('chats').select('*').in('id', ids);
        setMyChats(chatRows ?? []);
        const directIds = (chatRows ?? []).filter((c) => c.type === 'direct').map((c) => c.id);
        setForwardPartners(await getDirectChatPartners(directIds, me.id));
      } else {
        setMyChats([]);
        setForwardPartners({});
      }
    }
    setForwardTarget(message);
  }

  async function handleForwardTo(targetChatId: string) {
    if (!forwardTarget) return;
    await forwardMessage(forwardTarget, targetChatId);
    setForwardTarget(null);
    setNotice('Переслано');
    setTimeout(() => setNotice(null), 1500);
  }

  if (!chat || !me) return <p style={{ padding: 24, color: 'var(--text-muted)' }}>Загрузка…</p>;

  const isGroupOrChannel = chat.type !== 'direct';
  const canPin = !isGroupOrChannel || myRole === 'owner';

  return (
    <main className="chat-shell">
      <header className="chat-header">
        <Link href="/chats/" style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none' }}>
          ← Назад
        </Link>

        {chat.type === 'direct' && otherProfile ? (
          <Link
            href={`/user/?id=${otherProfile.id}`}
            style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'inherit', textDecoration: 'none' }}
          >
            <div
              className="avatar"
              style={{
                width: 40,
                height: 40,
                fontSize: 15,
                flexShrink: 0,
                backgroundImage: !blockedEitherWay && otherProfile.avatar_url ? `url(${otherProfile.avatar_url})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              {(blockedEitherWay || !otherProfile.avatar_url) && otherProfile.display_name.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <h2 style={{ fontSize: 15 }}>
                <NameWithBadges
                  name={otherProfile.display_name}
                  role={otherProfile.role}
                  isVerified={otherProfile.is_verified}
                  isPixsetEmployee={otherProfile.is_pixset_employee}
                  isFrozen={otherProfile.frozen}
                />
              </h2>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{otherLastSeen}</div>
            </div>
          </Link>
        ) : (
          <Link
            href={`/chat-info/?id=${chat.id}`}
            style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'inherit', textDecoration: 'none' }}
          >
            <div
              className="avatar"
              style={{
                width: 40,
                height: 40,
                fontSize: 15,
                flexShrink: 0,
                backgroundImage: chat.avatar_url ? `url(${chat.avatar_url})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              {!chat.avatar_url && (chat.title ?? '#').slice(0, 1).toUpperCase()}
            </div>
            <div>
              <h2 style={{ fontSize: 15 }}>
                {chat.title ?? 'Чат'}
                {chat.is_verified && <VerifiedBadge size={14} />}
              </h2>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {memberCount} {chat.type === 'channel' ? 'подписчиков' : 'участников'}
              </div>
            </div>
          </Link>
        )}
      </header>

      {me.frozen && (
        <div className="frozen-banner">❄️ Ваш аккаунт заморожен — доступно только чтение сообщений</div>
      )}

      {pinnedMessage && (
        <div className="pinned-bar">
          <span>📌 {pinnedMessage.text}</span>
          {canPin && (
            <button className="btn-ghost" style={{ width: 'auto', padding: '2px 8px' }} onClick={handleUnpin}>
              ✕
            </button>
          )}
        </div>
      )}

      {notice && <div className="toast">{notice}</div>}

      <div className="chat-messages" onClick={() => setOpenMenuId(null)}>
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const showDateDivider = !prev || new Date(prev.sent_at).toDateString() !== new Date(m.sent_at).toDateString();
          const isMine = m.sender_id === me.id;
          const replySource = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : null;

          return (
            <div key={m.id}>
              {showDateDivider && <div className="date-divider">{formatDateDivider(m.sent_at)}</div>}
              <div
                className={`bubble-row ${isMine ? 'mine' : ''}`}
                ref={(el) => {
                  messageRefs.current[m.id] = el;
                }}
              >
                <div style={{ position: 'relative', maxWidth: '70%' }}>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!m.is_deleted) setOpenMenuId(openMenuId === m.id ? null : m.id);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    {replySource && <div className="reply-preview-inline">↩ {replySource.text}</div>}
                    {m.forwarded_from_chat_id && <div className="forwarded-label">Переслано</div>}

                    {m.caption && m.caption_position === 'above' && <div className="media-caption">{m.caption}</div>}

                    {m.message_type === 'image' && m.media_path ? (
                      <img
                        src={m.media_path}
                        alt={m.text}
                        className="media-image"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : m.message_type === 'video' && m.media_path ? (
                      <video src={m.media_path} controls className="media-video" onClick={(e) => e.stopPropagation()} />
                    ) : (m.message_type === 'audio' || m.message_type === 'voice') && m.media_path ? (
                      <audio src={m.media_path} controls className="media-audio" onClick={(e) => e.stopPropagation()} />
                    ) : m.message_type === 'file' && m.media_path ? (
                      <a
                        href={m.media_path}
                        target="_blank"
                        rel="noreferrer"
                        className="bubble file-attachment"
                        onClick={(e) => e.stopPropagation()}
                      >
                        📎 {m.text}
                      </a>
                    ) : (
                      <span className="bubble message-text">
                        {m.text}
                        {m.edited_at && !m.is_deleted && <span className="edited-label"> (изменено)</span>}
                      </span>
                    )}

                    {m.caption && m.caption_position === 'below' && <div className="media-caption">{m.caption}</div>}

                    <div className="bubble-time-standalone">{formatMessageTime(m.sent_at)}</div>
                  </div>

                  {openMenuId === m.id && !m.is_deleted && (
                    <div className={`message-menu ${isMine ? 'mine' : ''}`}>
                      {!isMine && (
                        <button onClick={() => { setReplyingTo(m); setOpenMenuId(null); }}>Ответить</button>
                      )}
                      <button onClick={() => handleCopy(m)}>Копировать</button>
                      <button onClick={() => openForwardModal(m)}>Переслать</button>
                      {canPin &&
                        (pinnedMessage?.id === m.id ? (
                          <button onClick={handleUnpin}>Открепить</button>
                        ) : (
                          <button onClick={() => handlePin(m)}>Закрепить</button>
                        ))}
                      {isGroupOrChannel && <button onClick={() => handleCopyLink(m)}>Скопировать ссылку</button>}
                      {isMine && (
                        <button onClick={() => { setEditingMessage(m); setDraft(m.text); setOpenMenuId(null); }}>
                          Изменить
                        </button>
                      )}
                      {(isMine || canModerate) && (
                        <button className="danger" onClick={() => handleDelete(m)}>
                          🗑 Удалить у всех
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {me.frozen ? (
        <p className="subscriber-notice error">
          ❄️ Ваш аккаунт заморожен — вы можете только читать сообщения, отправка недоступна
        </p>
      ) : blockedEitherWay ? (
        <p className="subscriber-notice error">Вы не можете писать этому пользователю — общение заблокировано</p>
      ) : canWrite ? (
        <>
          {(replyingTo || editingMessage) && (
            <div className="composer-context">
              <span>{editingMessage ? '✎ Редактирование' : `↩ Ответ: ${replyingTo?.text}`}</span>
              <button
                className="btn-ghost"
                style={{ width: 'auto' }}
                onClick={() => {
                  setReplyingTo(null);
                  setEditingMessage(null);
                  setDraft('');
                }}
              >
                ✕
              </button>
            </div>
          )}
          {pendingFile && (
            <div className="composer-context" style={{ flexWrap: 'wrap', gap: 8 }}>
              <span>📎 {pendingFile.name} — подпись необязательна</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 12 }}>Подпись:</span>
                <button
                  type="button"
                  className="btn"
                  style={{
                    width: 'auto',
                    padding: '4px 10px',
                    fontSize: 12,
                    borderColor: captionPosition === 'above' ? 'var(--accent)' : undefined,
                  }}
                  onClick={() => setCaptionPosition('above')}
                >
                  Сверху
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{
                    width: 'auto',
                    padding: '4px 10px',
                    fontSize: 12,
                    borderColor: captionPosition === 'below' ? 'var(--accent)' : undefined,
                  }}
                  onClick={() => setCaptionPosition('below')}
                >
                  Снизу
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ width: 'auto' }}
                  onClick={() => {
                    setPendingFile(null);
                    setDraft('');
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          )}
          <form onSubmit={handleSend} className="chat-composer">
            <button
              type="button"
              className="btn"
              style={{ width: 'auto', padding: '10px 14px' }}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              📎
            </button>
            <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileSelected} />

            <div style={{ position: 'relative', flex: 1 }}>
              <textarea
                className="input composer-textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(e as any);
                  }
                }}
                placeholder={pendingFile ? 'Подпись к файлу (необязательно)…' : 'Сообщение… (Shift+Enter — новая строка)'}
                rows={1}
              />
              {showEmoji && (
                <div className="emoji-panel">
                  {EMOJI_LIST.map((emoji) => (
                    <button key={emoji} type="button" onClick={() => insertEmoji(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              className="btn"
              style={{ width: 'auto', padding: '10px 14px' }}
              onClick={() => setShowEmoji((v) => !v)}
            >
              😊
            </button>

            {draft.trim() || editingMessage || pendingFile ? (
              <button type="submit" className="btn btn-primary" style={{ width: 'auto', padding: '10px 20px' }}>
                {editingMessage ? 'Сохранить' : 'Отправить'}
              </button>
            ) : (
              <button
                type="button"
                className={`btn ${isRecording ? 'btn-primary' : ''}`}
                style={{ width: 'auto', padding: '10px 14px' }}
                onClick={isRecording ? stopRecording : startRecording}
                disabled={uploading}
              >
                {isRecording ? '⏹' : '🎙'}
              </button>
            )}
          </form>
        </>
      ) : (
        <div className="subscriber-notice" style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <span>Вы подписчик канала — писать могут только владелец и администраторы</span>
          <button className="btn" style={{ width: 'auto' }} onClick={handleUnsubscribe}>
            Отписаться
          </button>
        </div>
      )}

      {forwardTarget && (
        <div className="modal-overlay" onClick={() => setForwardTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Переслать в…</h3>
            {myChats.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>Нет других чатов для пересылки.</p>
            ) : (
              <ul className="list-plain">
                {myChats.map((c) => (
                  <li key={c.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => handleForwardTo(c.id)}>
                    {c.type === 'direct' ? forwardPartners[c.id]?.display_name ?? 'Личный чат' : c.title}
                  </li>
                ))}
              </ul>
            )}
            <button className="btn" style={{ width: 'auto', marginTop: 12 }} onClick={() => setForwardTarget(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

/**
 * useSearchParams требует Suspense-границу при статическом экспорте (output: 'export') —
 * иначе сборка упадёт с предупреждением о деоптимизации в CSR bailout.
 */
export default function ChatWindowPage() {
  return (
    <DesktopShell>
      <Suspense fallback={<p style={{ padding: 24, color: 'var(--text-muted)' }}>Загрузка…</p>}>
        <ChatWindowInner />
      </Suspense>
    </DesktopShell>
  );
}
