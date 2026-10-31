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
  toggleMessageReaction,
  getChatReactions,
  getChatSafetyFingerprint,
  getChatCustomPassphrase,
  setChatCustomPassphrase,
} from '@pixchats/core';
import type { Message, Chat, Profile, ReactionPayload, ChatSafetyFingerprint } from '@pixchats/core';
import { Loading } from '../../components/Loading';
import { EmojiPicker } from '../../components/EmojiPicker';
import {
  BackIcon,
  PaperclipIcon,
  SmileIcon,
  SendIcon,
  MicIcon,
  StopIcon,
  ReplyIcon,
  CopyIcon,
  ForwardIcon,
  PinIcon,
  TrashIcon,
  EditIcon,
  LinkIcon,
} from '../../components/Icons';

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

const QUICK_REACTIONS = ['👍', '❤️', '🔥', '😂', '😮', '😢', '👏', '🎉'];

function ChatWindowInner() {
  const searchParams = useSearchParams();
  const chatId = searchParams.get('id') ?? '';
  const highlightMsgId = searchParams.get('msg');
  const router = useRouter();

  const [me, setMe] = useState<Profile | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [chatNotFound, setChatNotFound] = useState(false);
  const [otherProfile, setOtherProfile] = useState<Profile | null>(null);
  const [otherLastSeen, setOtherLastSeen] = useState('');
  const [blockedEitherWay, setBlockedEitherWay] = useState(false);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [pinnedMessage, setPinnedMessage] = useState<Message | null>(null);
  const [canModerate, setCanModerate] = useState(false); // owner/admin этого чата

  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Record<string, Record<string, string[]>>>({});
  const [senderProfiles, setSenderProfiles] = useState<Record<string, Profile>>({});
  const initialIdsRef = useRef<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [canWrite, setCanWrite] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [activeReactionPickerMsgId, setActiveReactionPickerMsgId] = useState<string | null>(null);
  const [fullEmojiPickerMsgId, setFullEmojiPickerMsgId] = useState<string | null>(null);
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

  // Сквозное шифрование (E2EE)
  const [showE2EEModal, setShowE2EEModal] = useState(false);
  const [e2eeFingerprint, setE2eeFingerprint] = useState<ChatSafetyFingerprint | null>(null);
  const [customPassInput, setCustomPassInput] = useState('');

  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const lastBroadcastTypingRef = useRef<number>(0);

  const EMOJI_LIST = ['😀','😂','😍','😢','😡','👍','👎','🔥','🎉','❤️','🙏','😎','🤔','😭','👏','💀','✨','😴','🤝','😱'];

  function insertEmoji(emoji: string) {
    setDraft((prev) => prev + emoji);
  }

  function handleDraftChange(text: string) {
    setDraft(text);
    if (!chatId || !me) return;
    const now = Date.now();
    if (now - lastBroadcastTypingRef.current > 2500) {
      lastBroadcastTypingRef.current = now;
      try {
        const supabase = getSupabaseClient();
        const ch = supabase.channel(`typing:${chatId}`);
        ch.send({
          type: 'broadcast',
          event: 'typing',
          payload: { userId: me.id, name: me.display_name },
        });
      } catch {}
    }
  }

  async function handleSendMedia(mediaUrl: string, caption?: string) {
    setShowEmoji(false);
    if (!chatId) return;
    try {
      await sendMessage(chatId, caption || 'Стикер', {
        messageType: 'image',
        mediaPath: mediaUrl,
      });
    } catch (err: any) {
      setNotice('Не удалось отправить стикер/GIF');
      setTimeout(() => setNotice(null), 2000);
    }
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
    setChatNotFound(false);
    initialIdsRef.current = new Set();

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
      const { data: chatRow } = await supabase.from('chats').select('*').eq('id', chatId).maybeSingle();
      if (!chatRow) {
        setChatNotFound(true);
        return;
      }
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

      const initialMessages = await getMessages(chatId);
      initialIdsRef.current = new Set(initialMessages.map((m) => m.id));
      setMessages(initialMessages);
      await markChatAsRead(profile.id, chatId);

      // Загружаем статус сквозного шифрования (E2EE) и отпечаток безопасности
      try {
        setCustomPassInput(getChatCustomPassphrase(chatId));
        const fp = await getChatSafetyFingerprint(chatId, profile.id);
        setE2eeFingerprint(fp);
      } catch {}

      if (initialMessages.length > 0) {
        try {
          const initialReactions = await getChatReactions(chatId, initialMessages.map((m) => m.id));
          setReactions(initialReactions);
        } catch {}
      }

      if (chatRow.type !== 'direct') {
        const uniqueSenderIds = Array.from(new Set(initialMessages.map((m) => m.sender_id))).filter((id) => id !== profile.id);
        if (uniqueSenderIds.length > 0) {
          const { data: senders } = await supabase.from('profiles').select('*').in('id', uniqueSenderIds);
          const map: Record<string, Profile> = {};
          for (const s of senders ?? []) map[s.id] = s as Profile;
          setSenderProfiles(map);
        }
      }

      // Заморозка = никаких новых сообщений в реальном времени, только то, что уже было
      // загружено при открытии чата (перечитать историю можно, обновляясь вручную).
      if (!profile.frozen) {
        unsubscribe = subscribeToMessages(
          chatId,
          async (msg) => {
            setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
            markChatAsRead(profile.id, chatId);

            if (chatRow.type !== 'direct' && msg.sender_id !== profile.id) {
              setSenderProfiles((prev) => {
                if (prev[msg.sender_id]) return prev;
                supabase
                  .from('profiles')
                  .select('*')
                  .eq('id', msg.sender_id)
                  .maybeSingle()
                  .then(({ data }) => {
                    if (data) setSenderProfiles((p) => ({ ...p, [msg.sender_id]: data as Profile }));
                  });
                return prev;
              });
            }
          },
          (msg) => setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m))),
          (reactionPayload) => {
            setReactions((prev) => {
              const msgReactions = { ...(prev[reactionPayload.messageId] ?? {}) };
              const currentUsers = msgReactions[reactionPayload.emoji] ?? [];
              if (reactionPayload.action === 'add') {
                if (!currentUsers.includes(reactionPayload.userId)) {
                  msgReactions[reactionPayload.emoji] = [...currentUsers, reactionPayload.userId];
                }
              } else {
                msgReactions[reactionPayload.emoji] = currentUsers.filter((id) => id !== reactionPayload.userId);
                if (msgReactions[reactionPayload.emoji].length === 0) {
                  delete msgReactions[reactionPayload.emoji];
                }
              }
              return { ...prev, [reactionPayload.messageId]: msgReactions };
            });
          }
        );
      }
    })();

    return () => unsubscribe?.();
  }, [chatId, router]);

  useEffect(() => {
    if (!chatId || !me) return;
    const supabase = getSupabaseClient();
    const typingChannel = supabase.channel(`typing:${chatId}`);

    typingChannel
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload && payload.userId && payload.userId !== me.id) {
          const userName = payload.name || 'Пользователь';
          setTypingUsers((prev) => ({ ...prev, [payload.userId]: userName }));
          setTimeout(() => {
            setTypingUsers((prev) => {
              const copy = { ...prev };
              delete copy[payload.userId];
              return copy;
            });
          }, 3500);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(typingChannel);
    };
  }, [chatId, me?.id]);

  async function handleToggleReaction(messageId: string, emoji: string) {
    if (!me) return;
    try {
      const payload = await toggleMessageReaction(chatId, messageId, emoji, me.id);
      setReactions((prev) => {
        const msgReactions = { ...(prev[payload.messageId] ?? {}) };
        const currentUsers = msgReactions[payload.emoji] ?? [];
        if (payload.action === 'add') {
          if (!currentUsers.includes(me.id)) {
            msgReactions[payload.emoji] = [...currentUsers, me.id];
          }
        } else {
          msgReactions[payload.emoji] = currentUsers.filter((id) => id !== me.id);
          if (msgReactions[payload.emoji].length === 0) {
            delete msgReactions[payload.emoji];
          }
        }
        return { ...prev, [payload.messageId]: msgReactions };
      });
    } catch {}
  }

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

  if (chatNotFound) {
    return (
      <main className="page-center">
        <div className="container-narrow card" style={{ textAlign: 'center' }}>
          <h2 style={{ fontFamily: 'var(--font-display)' }}>Этот чат не существует</h2>
          <p style={{ color: 'var(--text-muted)' }}>Возможно, он был удалён владельцем.</p>
          <Link href="/chats" className="btn btn-primary" style={{ marginTop: 12 }}>
            К списку чатов
          </Link>
        </div>
      </main>
    );
  }

  if (!chat || !me) return <Loading />;

  const isGroupOrChannel = chat.type !== 'direct';
  const canPin = !isGroupOrChannel || myRole === 'owner';

  return (
    <main className="chat-shell">
      <header className="chat-header">
        <Link
          href="/chats/"
          style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <BackIcon size={18} />
          <span>Назад</span>
        </Link>

        {chat.type === 'direct' && otherProfile ? (
          <Link
            href={`/user/?id=${otherProfile.id}`}
            style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'inherit', textDecoration: 'none' }}
          >
            <div
              className={`avatar ${blockedEitherWay || !otherProfile.avatar_url ? 'avatar-fallback' : ''}`}
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
              className={`avatar ${!chat.avatar_url ? 'avatar-fallback' : ''}`}
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

        <button
          type="button"
          className="e2ee-badge-btn"
          onClick={async () => {
            if (me) {
              const fp = await getChatSafetyFingerprint(chatId, me.id, otherProfile?.id);
              setE2eeFingerprint(fp);
            }
            setCustomPassInput(getChatCustomPassphrase(chatId));
            setShowE2EEModal(true);
          }}
          title="Сквозное шифрование (AES-256-GCM) активно. Нажмите для проверки отпечатка ключей."
        >
          <span>🔒</span>
          <span>E2EE</span>
        </button>
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
          const sender = isGroupOrChannel && !isMine ? senderProfiles[m.sender_id] : null;
          const showSenderHeader = sender && (!prev || prev.sender_id !== m.sender_id || showDateDivider);

          return (
            <div key={m.id}>
              {showDateDivider && <div className="date-divider">{formatDateDivider(m.sent_at)}</div>}
              <div
                className={`bubble-row ${isMine ? 'mine' : ''} ${initialIdsRef.current.has(m.id) ? '' : 'is-new'}`}
                ref={(el) => {
                  messageRefs.current[m.id] = el;
                }}
              >
                {showSenderHeader ? (
                  <Link href={`/user/?id=${sender!.id}`} className="sender-avatar-link">
                    <div
                      className={`avatar ${!sender!.avatar_url ? 'avatar-fallback' : ''}`}
                      style={{
                        width: 32,
                        height: 32,
                        fontSize: 13,
                        backgroundImage: sender!.avatar_url ? `url(${sender!.avatar_url})` : undefined,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }}
                    >
                      {!sender!.avatar_url && sender!.display_name.slice(0, 1).toUpperCase()}
                    </div>
                  </Link>
                ) : (
                  isGroupOrChannel && !isMine && <div style={{ width: 32, flexShrink: 0 }} />
                )}
                <div style={{ position: 'relative', maxWidth: '70%' }}>
                  {showSenderHeader && (
                    <Link href={`/user/?id=${sender!.id}`} className="sender-name-link">
                      {sender!.display_name}
                    </Link>
                  )}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveReactionPickerMsgId(null);
                      setFullEmojiPickerMsgId(null);
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
                        className={
                          m.text?.startsWith('Стикер:') || m.media_path.startsWith('data:image/svg+xml')
                            ? 'media-sticker'
                            : 'media-image'
                        }
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

                  {reactions[m.id] && Object.keys(reactions[m.id]).length > 0 && (
                    <div className={`reactions-row ${isMine ? 'mine' : ''}`}>
                      {Object.entries(reactions[m.id]).map(([emoji, userIds]) => {
                        if (!userIds || userIds.length === 0) return null;
                        const hasReacted = me ? userIds.includes(me.id) : false;
                        return (
                          <button
                            key={emoji}
                            type="button"
                            className={`reaction-pill ${hasReacted ? 'active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleReaction(m.id, emoji);
                            }}
                            title={hasReacted ? 'Нажмите, чтобы снять реакцию' : 'Нажмите, чтобы отреагировать'}
                          >
                            <span>{emoji}</span>
                            <span className="reaction-count">{userIds.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Всплывающий выбор реакции (открывается ТОЛЬКО по кнопке реакции) */}
                  {activeReactionPickerMsgId === m.id && !m.is_deleted && (
                    <div className={`reaction-picker-popover ${isMine ? 'mine' : ''}`} onClick={(e) => e.stopPropagation()}>
                      {QUICK_REACTIONS.map((emoji) => {
                        const hasReacted = me && reactions[m.id]?.[emoji]?.includes(me.id);
                        return (
                          <button
                            key={emoji}
                            type="button"
                            className={`reaction-popover-item ${hasReacted ? 'active' : ''}`}
                            onClick={() => {
                              handleToggleReaction(m.id, emoji);
                              setActiveReactionPickerMsgId(null);
                            }}
                            title={emoji}
                          >
                            {emoji}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className="reaction-popover-more"
                        title="Все эмодзи"
                        onClick={() => {
                          setFullEmojiPickerMsgId(m.id);
                          setActiveReactionPickerMsgId(null);
                        }}
                      >
                        +
                      </button>
                    </div>
                  )}

                  {/* Полный каталог абсолютно всех эмодзи для реакций */}
                  {fullEmojiPickerMsgId === m.id && !m.is_deleted && (
                    <div className={`message-full-emoji-popover ${isMine ? 'mine' : ''}`} onClick={(e) => e.stopPropagation()}>
                      <EmojiPicker
                        onSelect={(emoji) => {
                          handleToggleReaction(m.id, emoji);
                          setFullEmojiPickerMsgId(null);
                        }}
                        onClose={() => setFullEmojiPickerMsgId(null)}
                        title="Все реакции"
                      />
                    </div>
                  )}

                  {/* Меню действий сообщения (открывается ТОЛЬКО по клику на сообщение) */}
                  {openMenuId === m.id && !m.is_deleted && (
                    <div className={`message-menu ${isMine ? 'mine' : ''}`}>
                      {!isMine && (
                        <button onClick={() => { setReplyingTo(m); setOpenMenuId(null); }}>
                          <ReplyIcon size={15} /> Ответить
                        </button>
                      )}
                      <button onClick={() => handleCopy(m)}>
                        <CopyIcon size={15} /> Копировать
                      </button>
                      <button onClick={() => openForwardModal(m)}>
                        <ForwardIcon size={15} /> Переслать
                      </button>
                      {canPin &&
                        (pinnedMessage?.id === m.id ? (
                          <button onClick={handleUnpin}>
                            <PinIcon size={15} /> Открепить
                          </button>
                        ) : (
                          <button onClick={() => handlePin(m)}>
                            <PinIcon size={15} /> Закрепить
                          </button>
                        ))}
                      {isGroupOrChannel && (
                        <button onClick={() => handleCopyLink(m)}>
                          <LinkIcon size={15} /> Скопировать ссылку
                        </button>
                      )}
                      {isMine && (
                        <button onClick={() => { setEditingMessage(m); setDraft(m.text); setOpenMenuId(null); }}>
                          <EditIcon size={15} /> Изменить
                        </button>
                      )}
                      {(isMine || canModerate) && (
                        <button className="danger" onClick={() => handleDelete(m)}>
                          <TrashIcon size={15} /> Удалить у всех
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {!m.is_deleted && (
                  <button
                    type="button"
                    className="reaction-quick-trigger"
                    title="Отреагировать"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(null);
                      setFullEmojiPickerMsgId(null);
                      setActiveReactionPickerMsgId(activeReactionPickerMsgId === m.id ? null : m.id);
                    }}
                  >
                    <SmileIcon size={15} />
                  </button>
                )}
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
          {Object.keys(typingUsers).length > 0 && (
            <div className="chat-typing-indicator">
              <span className="typing-dots">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </span>
              <span>{Object.values(typingUsers).join(', ')} печатает...</span>
            </div>
          )}

          <div style={{ position: 'relative' }}>
            {showEmoji && (
              <div className="composer-emoji-popover">
                <EmojiPicker
                  onSelect={(emoji) => insertEmoji(emoji)}
                  onSelectMedia={handleSendMedia}
                  onClose={() => setShowEmoji(false)}
                  title="Эмодзи, стикеры и GIF"
                  enableMedia
                />
              </div>
            )}

            <form onSubmit={handleSend} className="chat-composer-unified-bar">
              <button
                type="button"
                className="composer-inner-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Прикрепить файл"
              >
                <PaperclipIcon size={18} />
              </button>
              <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileSelected} />

              <textarea
                className="composer-unified-textarea"
                value={draft}
                onChange={(e) => handleDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(e as any);
                  }
                }}
                placeholder={pendingFile ? 'Подпись к файлу…' : 'Сообщение…'}
                rows={1}
              />

              <button
                type="button"
                className={`composer-inner-btn ${showEmoji ? 'active' : ''}`}
                onClick={() => setShowEmoji((v) => !v)}
                title="Эмодзи, стикеры и GIF"
              >
                <SmileIcon size={18} />
              </button>

              {draft.trim() || editingMessage || pendingFile ? (
                <button
                  type="submit"
                  className="composer-send-btn"
                  title={editingMessage ? 'Сохранить' : 'Отправить'}
                >
                  <SendIcon size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  className={`composer-inner-btn ${isRecording ? 'recording' : ''}`}
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={uploading}
                  title={isRecording ? 'Остановить запись' : 'Голосовое сообщение'}
                >
                  {isRecording ? <StopIcon size={18} /> : <MicIcon size={18} />}
                </button>
              )}
            </form>
          </div>
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

      {showE2EEModal && (
        <div className="modal-overlay" onClick={() => setShowE2EEModal(false)}>
          <div className="modal-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🔒</span>
              <span>Сквозное шифрование (E2EE)</span>
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.45 }}>
              Сообщения в этом чате шифруются на вашем устройстве по стандарту{' '}
              <strong style={{ color: 'var(--text)' }}>AES-256-GCM (Web Crypto API)</strong> перед отправкой на сервер.
            </p>

            {e2eeFingerprint && (
              <div
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 14,
                  marginBottom: 14,
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                  Контрольные эмодзи канала
                </div>
                <div style={{ fontSize: 28, letterSpacing: 10, marginBottom: 10 }}>
                  {e2eeFingerprint.emojis.join(' ')}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                  Отпечаток безопасности SHA-256
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 13,
                    color: 'var(--accent)',
                    letterSpacing: 1.5,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: 6,
                  }}
                >
                  {e2eeFingerprint.hexBlocks.map((blk, idx) => (
                    <span key={idx}>{blk}</span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label className="label">Дополнительный секретный пароль чата (опционально)</label>
              <input
                type="password"
                className="input"
                value={customPassInput}
                onChange={(e) => setCustomPassInput(e.target.value)}
                placeholder="Оставьте пустым для автоматического ключа чата"
              />
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Если задать секретный пароль, прочитать сообщения сможет только собеседник, введший точно такой же пароль.
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn"
                style={{ width: 'auto' }}
                onClick={() => setShowE2EEModal(false)}
              >
                Закрыть
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: 'auto' }}
                onClick={async () => {
                  setChatCustomPassphrase(chatId, customPassInput);
                  const refreshed = await getMessages(chatId);
                  setMessages(refreshed);
                  if (me) {
                    setE2eeFingerprint(await getChatSafetyFingerprint(chatId, me.id, otherProfile?.id));
                  }
                  setShowE2EEModal(false);
                  setNotice(customPassInput.trim() ? 'Личный ключ E2EE применён' : 'Включён стандартный ключ E2EE');
                  setTimeout(() => setNotice(null), 2000);
                }}
              >
                Сохранить ключ
              </button>
            </div>
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
      <Suspense fallback={<Loading />}>
        <ChatWindowInner />
      </Suspense>
    </DesktopShell>
  );
}
