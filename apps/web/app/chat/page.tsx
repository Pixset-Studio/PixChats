'use client';

import { useEffect, useRef, useState, useMemo, Suspense } from 'react';
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
  leaveChat,
  markChatAsRead,
  toggleMessageReaction,
  getChatReactions,
  getChatSafetyFingerprint,
  getChatCustomPassphrase,
  setChatCustomPassphrase,
  getOrCreateSavedMessagesChat,
  isSavedMessagesChat,
} from '@pixchats/core';
import type { Message, Chat, Profile, ChatSafetyFingerprint } from '@pixchats/core';
import { Loading } from '../../components/Loading';
import { EmojiPicker } from '../../components/EmojiPicker';
import {
  FormattedMessageText,
  encodePollMessage,
  encodeSelfDestructPrefix,
  extractSelfDestructInfo,
} from '../../components/FormattedMessageText';
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
  SearchIcon,
} from '../../components/Icons';

interface ScheduledMessageItem {
  id: string;
  text: string;
  sendAt: number; // timestamp ms
}

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

const TTL_OPTIONS = [
  { label: 'Выкл', seconds: 0 },
  { label: '15 сек', seconds: 15 },
  { label: '1 мин', seconds: 60 },
  { label: '1 час', seconds: 3600 },
  { label: '24 часа', seconds: 86400 },
];

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
  const [canModerate, setCanModerate] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Record<string, Record<string, string[]>>>({});
  const [senderProfiles, setSenderProfiles] = useState<Record<string, Profile>>({});
  const initialIdsRef = useRef<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [canWrite, setCanWrite] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const [audioRates, setAudioRates] = useState<Record<string, number>>({});

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

  // Пункт 5: Панель быстрого форматирования текста (Markdown + Спойлер)
  const [showFormatToolbar, setShowFormatToolbar] = useState(false);

  // Пункт 4: Модальное окно создания опроса (Polls)
  const [showPollModal, setShowPollModal] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollMulti, setPollMulti] = useState(false);

  // Пункт 6: Поиск по сообщениям внутри открытого чата
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatSearchIndex, setChatSearchIndex] = useState(0);

  // Пункт 9: Таймер автоудаления (Self-Destructing) и отложенные сообщения (Scheduled)
  const [showTimerPopover, setShowTimerPopover] = useState(false);
  const [ttlSeconds, setTtlSeconds] = useState<number>(0);
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessageItem[]>([]);
  const [customScheduleInput, setCustomScheduleInput] = useState('');

  // Пункт 10: Lightbox для просмотра фото с зумом и Drag-and-Drop файлов
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [lightboxZoom, setLightboxZoom] = useState<number>(1);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Сквозное шифрование (E2EE)
  const [showE2EEModal, setShowE2EEModal] = useState(false);
  const [e2eeFingerprint, setE2eeFingerprint] = useState<ChatSafetyFingerprint | null>(null);
  const [customPassInput, setCustomPassInput] = useState('');

  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const lastBroadcastTypingRef = useRef<number>(0);

  function insertEmoji(emoji: string) {
    setDraft((prev) => prev + emoji);
  }

  function applyMarkdownWrap(prefix: string, suffix = prefix, placeholder = 'текст') {
    setDraft((prev) => {
      if (!prev.trim()) return `${prefix}${placeholder}${suffix}`;
      return `${prev} ${prefix}${placeholder}${suffix}`;
    });
  }

  // Загрузка и проверка очереди отложенных сообщений для этого чата (Пункт 9)
  useEffect(() => {
    if (!chatId) return;
    const storageKey = `pixchats:scheduled_msgs:${chatId}`;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setScheduledMessages(parsed);
      } else {
        setScheduledMessages([]);
      }
    } catch {
      setScheduledMessages([]);
    }
  }, [chatId]);

  useEffect(() => {
    if (!chatId || scheduledMessages.length === 0) return;
    const storageKey = `pixchats:scheduled_msgs:${chatId}`;

    const timer = setInterval(async () => {
      const now = Date.now();
      const due = scheduledMessages.filter((item) => item.sendAt <= now);
      if (due.length === 0) return;

      const remaining = scheduledMessages.filter((item) => item.sendAt > now);
      setScheduledMessages(remaining);
      localStorage.setItem(storageKey, JSON.stringify(remaining));

      for (const item of due) {
        try {
          await sendMessage(chatId, item.text);
        } catch {}
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [chatId, scheduledMessages]);

  function scheduleCurrentDraft(delayMs: number) {
    if (!draft.trim() || !chatId) return;
    const textToSend = ttlSeconds > 0 ? encodeSelfDestructPrefix(ttlSeconds, draft.trim()) : draft.trim();
    const item: ScheduledMessageItem = {
      id: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: textToSend,
      sendAt: Date.now() + delayMs,
    };
    const next = [...scheduledMessages, item].sort((a, b) => a.sendAt - b.sendAt);
    setScheduledMessages(next);
    localStorage.setItem(`pixchats:scheduled_msgs:${chatId}`, JSON.stringify(next));
    setDraft('');
    setShowTimerPopover(false);
    setNotice(
      `⏰ Сообщение запланировано на ${new Date(item.sendAt).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      })}`
    );
    setTimeout(() => setNotice(null), 2500);
  }

  function removeScheduledMessage(id: string) {
    const next = scheduledMessages.filter((x) => x.id !== id);
    setScheduledMessages(next);
    localStorage.setItem(`pixchats:scheduled_msgs:${chatId}`, JSON.stringify(next));
  }

  async function sendScheduledNow(item: ScheduledMessageItem) {
    removeScheduledMessage(item.id);
    await sendMessage(chatId, item.text);
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
    } catch {
      setNotice('Не удалось отправить стикер/GIF');
      setTimeout(() => setNotice(null), 2000);
    }
  }

  async function handleCreatePoll(e: React.FormEvent) {
    e.preventDefault();
    const q = pollQuestion.trim();
    const opts = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (!q || opts.length < 2) {
      setNotice('Укажите вопрос и минимум 2 варианта ответа');
      setTimeout(() => setNotice(null), 2000);
      return;
    }
    const encoded = encodePollMessage({
      question: q,
      options: opts,
      multi: pollMulti,
    });
    const finalPayload = ttlSeconds > 0 ? encodeSelfDestructPrefix(ttlSeconds, encoded) : encoded;
    await sendMessage(chatId, finalPayload);
    setShowPollModal(false);
    setPollQuestion('');
    setPollOptions(['', '']);
    setPollMulti(false);
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

  function cycleAudioSpeed(messageId: string) {
    const current = audioRates[messageId] || 1;
    const nextRate = current === 1 ? 1.5 : current === 1.5 ? 2 : 1;
    setAudioRates((prev) => ({ ...prev, [messageId]: nextRate }));
    const audioEl = audioRefs.current[messageId];
    if (audioEl) {
      audioEl.playbackRate = nextRate;
    }
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

      if (chatRow?.type === 'direct' && !isSavedMessagesChat(chatRow, profile.id)) {
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
      } else if (chatRow?.type !== 'direct') {
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

  // Поиск внутри чата (Пункт 6)
  const searchMatchedMessageIds = useMemo(() => {
    const q = chatSearchQuery.trim().toLowerCase();
    if (!q) return [];
    return messages
      .filter((m) => !m.is_deleted && m.text?.toLowerCase().includes(q))
      .map((m) => m.id);
  }, [messages, chatSearchQuery]);

  function scrollToMessageById(msgId: string) {
    const el = messageRefs.current[msgId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('message-highlight');
      setTimeout(() => el.classList.remove('message-highlight'), 2000);
    }
  }

  function jumpSearchMatch(delta: number) {
    if (searchMatchedMessageIds.length === 0) return;
    const nextIdx =
      (chatSearchIndex + delta + searchMatchedMessageIds.length) % searchMatchedMessageIds.length;
    setChatSearchIndex(nextIdx);
    scrollToMessageById(searchMatchedMessageIds[nextIdx]);
  }

  useEffect(() => {
    if (searchMatchedMessageIds.length > 0) {
      const idx = searchMatchedMessageIds.length - 1;
      setChatSearchIndex(idx);
      scrollToMessageById(searchMatchedMessageIds[idx]);
    }
  }, [chatSearchQuery]);

  useEffect(() => {
    if (highlightMsgId && messages.length > 0) {
      scrollToMessageById(highlightMsgId);
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
    const rawDraft = draft.trim();

    if (editingMessage) {
      await editMessage(editingMessage.id, rawDraft);
      setMessages((prev) =>
        prev.map((m) => (m.id === editingMessage.id ? { ...m, text: rawDraft, edited_at: new Date().toISOString() } : m))
      );
      setEditingMessage(null);
      setDraft('');
      return;
    }

    const finalText = ttlSeconds > 0 ? encodeSelfDestructPrefix(ttlSeconds, rawDraft) : rawDraft;
    setDraft('');
    await sendMessage(chatId, finalText, { replyToId: replyingTo?.id });
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

  async function handleSelfDestructExpired(messageId: string) {
    try {
      await deleteMessage(messageId);
    } catch {}
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, is_deleted: true, text: '🔥 Исчезающее сообщение удалено по таймеру' } : m
      )
    );
  }

  async function handleCopy(message: Message) {
    const { cleanText } = extractSelfDestructInfo(message.text);
    await navigator.clipboard.writeText(cleanText);
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

  async function handleSaveToFavorites(message: Message) {
    if (!me) return;
    setOpenMenuId(null);
    try {
      const savedChat = await getOrCreateSavedMessagesChat(me.id);
      await forwardMessage(message, savedChat.id);
      setNotice('⭐ Сохранено в «Избранное»');
      setTimeout(() => setNotice(null), 1800);
    } catch {
      setNotice('Не удалось сохранить в Избранное');
      setTimeout(() => setNotice(null), 1800);
    }
  }

  async function openForwardModal(message: Message) {
    setOpenMenuId(null);
    if (me) {
      const supabase = getSupabaseClient();
      const { data: memberRows } = await supabase
        .from('chat_members')
        .select('chat_id, member_role')
        .eq('user_id', me.id)
        .neq('member_role', 'subscriber');
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

  const isSavedChat = isSavedMessagesChat(chat, me.id);
  const isGroupOrChannel = chat.type !== 'direct';
  const canPin = !isGroupOrChannel || myRole === 'owner';

  return (
    <main
      className="chat-shell"
      onDragOver={(e) => {
        e.preventDefault();
        if (!isDraggingOver) setIsDraggingOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDraggingOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingOver(false);
        const file = e.dataTransfer?.files?.[0];
        if (file) {
          setPendingFile(file);
        }
      }}
    >
      {isDraggingOver && (
        <div
          style={{
            position: 'fixed',
            inset: 16,
            zIndex: 9998,
            background: 'rgba(9, 9, 11, 0.85)',
            border: '2px dashed var(--accent)',
            borderRadius: 16,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            color: 'var(--accent)',
            fontSize: 18,
            fontWeight: 700,
            pointerEvents: 'none',
          }}
        >
          <span style={{ fontSize: 42 }}>📎</span>
          <span>Отпустите файл здесь, чтобы прикрепить его к сообщению</span>
        </div>
      )}

      <header className="chat-header">
        <Link
          href="/chats/"
          style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <BackIcon size={18} />
          <span>Назад</span>
        </Link>

        {isSavedChat ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              className="avatar avatar-fallback"
              style={{ width: 40, height: 40, fontSize: 18, flexShrink: 0 }}
            >
              ⭐
            </div>
            <div>
              <h2 style={{ fontSize: 15, margin: 0 }}>Избранное</h2>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Сохранённые сообщения и личные заметки
              </div>
            </div>
          </div>
        ) : chat.type === 'direct' && otherProfile ? (
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className="e2ee-badge-btn"
            onClick={() => {
              setShowChatSearch((v) => !v);
              if (showChatSearch) setChatSearchQuery('');
            }}
            title="Поиск по сообщениям в этом чате"
          >
            <SearchIcon size={14} />
          </button>

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
        </div>
      </header>

      {showChatSearch && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 14px',
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <SearchIcon size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            type="text"
            className="input"
            style={{ flex: 1, height: 34, fontSize: 13 }}
            placeholder="Найти текст в этом чате…"
            value={chatSearchQuery}
            onChange={(e) => setChatSearchQuery(e.target.value)}
            autoFocus
          />
          {chatSearchQuery.trim() && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>
              {searchMatchedMessageIds.length > 0
                ? `${chatSearchIndex + 1} из ${searchMatchedMessageIds.length}`
                : '0 совпадений'}
            </span>
          )}
          <button
            type="button"
            className="btn-ghost"
            style={{ width: 'auto', padding: '4px 8px' }}
            onClick={() => jumpSearchMatch(-1)}
            disabled={searchMatchedMessageIds.length === 0}
            title="Предыдущее совпадение"
          >
            ↑
          </button>
          <button
            type="button"
            className="btn-ghost"
            style={{ width: 'auto', padding: '4px 8px' }}
            onClick={() => jumpSearchMatch(1)}
            disabled={searchMatchedMessageIds.length === 0}
            title="Следующее совпадение"
          >
            ↓
          </button>
          <button
            type="button"
            className="btn-ghost"
            style={{ width: 'auto', padding: '4px 8px' }}
            onClick={() => {
              setShowChatSearch(false);
              setChatSearchQuery('');
            }}
            title="Закрыть поиск"
          >
            ✕
          </button>
        </div>
      )}

      {me.frozen && (
        <div className="frozen-banner">❄️ Ваш аккаунт заморожен — доступно только чтение сообщений</div>
      )}

      {pinnedMessage && (
        <div
          className="pinned-bar"
          style={{ cursor: 'pointer' }}
          onClick={() => scrollToMessageById(pinnedMessage.id)}
        >
          <span>📌 {extractSelfDestructInfo(pinnedMessage.text).cleanText}</span>
          {canPin && (
            <button
              className="btn-ghost"
              style={{ width: 'auto', padding: '2px 8px' }}
              onClick={(e) => {
                e.stopPropagation();
                handleUnpin();
              }}
            >
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

          // Отделяем служебные голоса опросов (📊1, 📊2...) от обычных эмодзи-реакций
          const msgReactions = reactions[m.id] || {};
          const regularReactionsEntries = Object.entries(msgReactions).filter(
            ([emoji]) => !emoji.startsWith('📊')
          );

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
                <div style={{ position: 'relative', maxWidth: '72%' }}>
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
                    {replySource && (
                      <div
                        className="reply-preview-inline"
                        onClick={(e) => {
                          e.stopPropagation();
                          scrollToMessageById(replySource.id);
                        }}
                      >
                        ↩ {extractSelfDestructInfo(replySource.text).cleanText}
                      </div>
                    )}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!m.text?.startsWith('Стикер:')) {
                            setLightboxZoom(1);
                            setLightboxImage(m.media_path!);
                          }
                        }}
                        title="Нажмите для полноэкранного просмотра"
                      />
                    ) : m.message_type === 'video' && m.media_path ? (
                      <video src={m.media_path} controls className="media-video" onClick={(e) => e.stopPropagation()} />
                    ) : (m.message_type === 'audio' || m.message_type === 'voice') && m.media_path ? (
                      <div
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <audio
                          ref={(el) => {
                            audioRefs.current[m.id] = el;
                          }}
                          src={m.media_path}
                          controls
                          className="media-audio"
                        />
                        <button
                          type="button"
                          className="btn"
                          style={{
                            width: 'auto',
                            padding: '4px 8px',
                            fontSize: 11,
                            fontWeight: 700,
                            borderRadius: 6,
                          }}
                          onClick={() => cycleAudioSpeed(m.id)}
                          title="Скорость воспроизведения голосового сообщения"
                        >
                          {audioRates[m.id] || 1}x
                        </button>
                      </div>
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
                      <FormattedMessageText
                        messageId={m.id}
                        rawText={m.text}
                        editedAt={m.edited_at}
                        isDeleted={m.is_deleted}
                        myUserId={me.id}
                        reactions={msgReactions}
                        onVotePollOption={(optIndex) => handleToggleReaction(m.id, `📊${optIndex + 1}`)}
                        onSelfDestructExpired={handleSelfDestructExpired}
                      />
                    )}

                    {m.caption && m.caption_position === 'below' && <div className="media-caption">{m.caption}</div>}

                    <div className="bubble-time-standalone">{formatMessageTime(m.sent_at)}</div>
                  </div>

                  {regularReactionsEntries.length > 0 && (
                    <div className={`reactions-row ${isMine ? 'mine' : ''}`}>
                      {regularReactionsEntries.map(([emoji, userIds]) => {
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

                  {openMenuId === m.id && !m.is_deleted && (
                    <div className={`message-menu ${isMine ? 'mine' : ''}`}>
                      <button onClick={() => { setReplyingTo(m); setOpenMenuId(null); }}>
                        <ReplyIcon size={15} /> Ответить
                      </button>
                      <button onClick={() => handleCopy(m)}>
                        <CopyIcon size={15} /> Копировать
                      </button>
                      <button onClick={() => openForwardModal(m)}>
                        <ForwardIcon size={15} /> Переслать
                      </button>
                      {!isSavedChat && (
                        <button onClick={() => handleSaveToFavorites(m)}>
                          <span>⭐</span> В Избранное
                        </button>
                      )}
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
                        <button onClick={() => { setEditingMessage(m); setDraft(extractSelfDestructInfo(m.text).cleanText); setOpenMenuId(null); }}>
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
          {scheduledMessages.length > 0 && (
            <div
              className="composer-context"
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                ⏰ Запланированные сообщения ({scheduledMessages.length})
              </div>
              {scheduledMessages.map((sm) => (
                <div
                  key={sm.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    fontSize: 12,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    [
                    {new Date(sm.sendAt).toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    ] {extractSelfDestructInfo(sm.text).cleanText}
                  </span>
                  <span style={{ display: 'inline-flex', gap: 6, flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ width: 'auto', padding: '2px 6px', fontSize: 11, color: 'var(--accent)' }}
                      onClick={() => sendScheduledNow(sm)}
                    >
                      Отправить сейчас
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ width: 'auto', padding: '2px 6px', fontSize: 11 }}
                      onClick={() => removeScheduledMessage(sm.id)}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {(replyingTo || editingMessage) && (
            <div className="composer-context">
              <span>
                {editingMessage
                  ? '✎ Редактирование'
                  : `↩ Ответ: ${extractSelfDestructInfo(replyingTo?.text || '').cleanText}`}
              </span>
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

          {showFormatToolbar && (
            <div
              className="composer-context"
              style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
            >
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 4 }}>Формат:</span>
              <button
                type="button"
                className="btn"
                style={{ width: 'auto', padding: '3px 8px', fontSize: 12, fontWeight: 700 }}
                onClick={() => applyMarkdownWrap('**', '**', 'жирный')}
              >
                B
              </button>
              <button
                type="button"
                className="btn"
                style={{ width: 'auto', padding: '3px 8px', fontSize: 12, fontStyle: 'italic' }}
                onClick={() => applyMarkdownWrap('*', '*', 'курсив')}
              >
                I
              </button>
              <button
                type="button"
                className="btn"
                style={{ width: 'auto', padding: '3px 8px', fontSize: 12, textDecoration: 'line-through' }}
                onClick={() => applyMarkdownWrap('~~', '~~', 'зачёркнутый')}
              >
                S
              </button>
              <button
                type="button"
                className="btn"
                style={{ width: 'auto', padding: '3px 8px', fontSize: 12, fontFamily: 'monospace' }}
                onClick={() => applyMarkdownWrap('`', '`', 'код')}
              >
                {'</>'}
              </button>
              <button
                type="button"
                className="btn"
                style={{ width: 'auto', padding: '3px 8px', fontSize: 12 }}
                onClick={() => applyMarkdownWrap('||', '||', 'скрытый спойлер')}
              >
                || Спойлер ||
              </button>
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

            {showTimerPopover && (
              <div
                className="card"
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 8px)',
                  right: 12,
                  zIndex: 80,
                  width: 300,
                  padding: 14,
                  boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--accent)' }}>
                  🔥 Таймер исчезающих сообщений
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                  {TTL_OPTIONS.map((opt) => (
                    <button
                      key={opt.seconds}
                      type="button"
                      className="btn"
                      style={{
                        width: 'auto',
                        padding: '4px 9px',
                        fontSize: 11.5,
                        borderColor: ttlSeconds === opt.seconds ? 'var(--accent)' : undefined,
                        color: ttlSeconds === opt.seconds ? 'var(--accent)' : undefined,
                      }}
                      onClick={() => setTtlSeconds(opt.seconds)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--accent)' }}>
                  ⏰ Отложенная отправка текущего текста
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  <button
                    type="button"
                    className="btn"
                    style={{ width: 'auto', padding: '4px 9px', fontSize: 11.5 }}
                    onClick={() => scheduleCurrentDraft(60 * 1000)}
                    disabled={!draft.trim()}
                  >
                    Через 1 мин
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{ width: 'auto', padding: '4px 9px', fontSize: 11.5 }}
                    onClick={() => scheduleCurrentDraft(10 * 60 * 1000)}
                    disabled={!draft.trim()}
                  >
                    Через 10 мин
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{ width: 'auto', padding: '4px 9px', fontSize: 11.5 }}
                    onClick={() => scheduleCurrentDraft(60 * 60 * 1000)}
                    disabled={!draft.trim()}
                  >
                    Через 1 час
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="datetime-local"
                    className="input"
                    style={{ flex: 1, fontSize: 11.5, height: 32 }}
                    value={customScheduleInput}
                    onChange={(e) => setCustomScheduleInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: 'auto', padding: '4px 10px', fontSize: 11.5 }}
                    disabled={!draft.trim() || !customScheduleInput}
                    onClick={() => {
                      const targetMs = new Date(customScheduleInput).getTime();
                      if (targetMs > Date.now()) {
                        scheduleCurrentDraft(targetMs - Date.now());
                        setCustomScheduleInput('');
                      }
                    }}
                  >
                    OK
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={handleSend} className="chat-composer-unified-bar">
              <button
                type="button"
                className="composer-inner-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Прикрепить файл (или перетащите файл в чат)"
              >
                <PaperclipIcon size={18} />
              </button>
              <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileSelected} />

              <button
                type="button"
                className="composer-inner-btn"
                onClick={() => setShowPollModal(true)}
                title="Создать опрос / голосование"
                style={{ fontSize: 15 }}
              >
                📊
              </button>

              <button
                type="button"
                className={`composer-inner-btn ${showFormatToolbar ? 'active' : ''}`}
                onClick={() => setShowFormatToolbar((v) => !v)}
                title="Форматирование текста (Жирный, Курсив, Код, Спойлер)"
                style={{ fontSize: 12, fontWeight: 800 }}
              >
                Aa
              </button>

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
                placeholder={
                  pendingFile
                    ? 'Подпись к файлу…'
                    : ttlSeconds > 0
                      ? `🔥 Исчезающее сообщение (${ttlSeconds}с)…`
                      : 'Сообщение…'
                }
                rows={1}
              />

              <button
                type="button"
                className={`composer-inner-btn ${showTimerPopover || ttlSeconds > 0 ? 'active' : ''}`}
                onClick={() => setShowTimerPopover((v) => !v)}
                title="Таймер исчезающих сообщений и отложенная отправка"
                style={{ fontSize: 14 }}
              >
                {ttlSeconds > 0 ? '🔥' : '⏱️'}
              </button>

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

      {/* Модальное окно создания опроса (Пункт 4) */}
      {showPollModal && (
        <div className="modal-overlay" onClick={() => setShowPollModal(false)}>
          <div className="modal-card" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>📊 Создать опрос</h3>
            <form onSubmit={handleCreatePoll}>
              <div className="field">
                <label>Вопрос опроса</label>
                <input
                  className="input"
                  value={pollQuestion}
                  onChange={(e) => setPollQuestion(e.target.value)}
                  placeholder="О чём хотите спросить участников?"
                  required
                />
              </div>

              <div className="field">
                <label>Варианты ответа</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {pollOptions.map((opt, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 6 }}>
                      <input
                        className="input"
                        value={opt}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPollOptions((prev) => prev.map((item, i) => (i === idx ? val : item)));
                        }}
                        placeholder={`Вариант ${idx + 1}`}
                        required={idx < 2}
                      />
                      {pollOptions.length > 2 && (
                        <button
                          type="button"
                          className="btn"
                          style={{ width: 'auto', padding: '0 10px' }}
                          onClick={() => setPollOptions((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {pollOptions.length < 8 && (
                  <button
                    type="button"
                    className="btn"
                    style={{ width: 'auto', marginTop: 8, fontSize: 12 }}
                    onClick={() => setPollOptions((prev) => [...prev, ''])}
                  >
                    + Добавить вариант
                  </button>
                )}
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={pollMulti}
                  onChange={(e) => setPollMulti(e.target.checked)}
                />
                <span>Разрешить выбор нескольких вариантов</span>
              </label>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn" style={{ width: 'auto' }} onClick={() => setShowPollModal(false)}>
                  Отмена
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>
                  Отправить опрос
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Полноэкранный просмотрщик изображений (Lightbox) с зумом (Пункт 10) */}
      {lightboxImage && (
        <div
          className="modal-overlay"
          onClick={() => setLightboxImage(null)}
          style={{ zIndex: 9999, background: 'rgba(0,0,0,0.9)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
              maxWidth: '94vw',
              maxHeight: '92vh',
            }}
          >
            <div style={{ overflow: 'auto', maxWidth: '92vw', maxHeight: '78vh', borderRadius: 12 }}>
              <img
                src={lightboxImage}
                alt="Просмотр фото"
                style={{
                  maxWidth: '88vw',
                  maxHeight: '76vh',
                  transform: `scale(${lightboxZoom})`,
                  transformOrigin: 'center center',
                  transition: 'transform 0.2s ease',
                  display: 'block',
                  borderRadius: 10,
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button
                type="button"
                className="btn"
                style={{ width: 'auto' }}
                onClick={() => setLightboxZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
              >
                🔍 −
              </button>
              <button
                type="button"
                className="btn"
                style={{ width: 'auto' }}
                onClick={() => setLightboxZoom(1)}
              >
                {Math.round(lightboxZoom * 100)}%
              </button>
              <button
                type="button"
                className="btn"
                style={{ width: 'auto' }}
                onClick={() => setLightboxZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
              >
                🔍 +
              </button>
              <a
                href={lightboxImage}
                download="pixchats-photo"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
                style={{ width: 'auto' }}
              >
                ⬇ Скачать
              </a>
              <button
                type="button"
                className="btn"
                style={{ width: 'auto' }}
                onClick={() => setLightboxImage(null)}
              >
                ✕ Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {forwardTarget && (
        <div className="modal-overlay" onClick={() => setForwardTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Переслать в…</h3>
            <ul className="list-plain">
              <li
                className="list-row"
                style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--accent)' }}
                onClick={() => {
                  const targetMsg = forwardTarget;
                  setForwardTarget(null);
                  if (targetMsg) void handleSaveToFavorites(targetMsg);
                }}
              >
                ⭐ Избранное (Сохранённые сообщения)
              </li>
              {myChats.map((c) => {
                const isSaved = isSavedMessagesChat(c, me.id);
                if (isSaved) return null;
                return (
                  <li key={c.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => handleForwardTo(c.id)}>
                    {c.type === 'direct' ? forwardPartners[c.id]?.display_name ?? 'Личный чат' : c.title}
                  </li>
                );
              })}
            </ul>
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

export default function ChatWindowPage() {
  return (
    <DesktopShell>
      <Suspense fallback={<Loading />}>
        <ChatWindowInner />
      </Suspense>
    </DesktopShell>
  );
}
