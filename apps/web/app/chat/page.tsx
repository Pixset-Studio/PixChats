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
import { startPixChatsCall, startPixChatsGroupCall } from '../../components/CallManager';
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
  updateChatInfo,
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
import {
  encodeStickerTag,
  resolveStickerFromText,
} from '../../lib/stickers';
import {
  parseChatDescriptionAndConfig,
  encodeChatDescriptionWithConfig,
  encodeTopicPrefix,
  extractTopicFromText,
  encodePostCommentPayload,
  extractPostCommentsFromReactions,
  DEFAULT_CHANNEL_GROUP_CONFIG,
  type ChannelGroupConfig,
} from '../../lib/channelConfig';
import { exportChatHistory } from '../../lib/chatExport';
import { processZeroStorageFileAttachment } from '../../lib/fileStorage';
import { isChatHidden, toggleHiddenChat } from '../../lib/appLock';
import { ReactionParticles } from '../../components/ReactionParticles';
import { translateText, detectLanguage, getAutoTranslatePref } from '../../lib/translator';
import { AvatarWithStatus } from '../../components/AvatarWithStatus';

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
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [captionPosition, setCaptionPosition] = useState<'above' | 'below'>('below');
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Пункт 1: Видеосообщения в кружочках (Video Notes)
  const [showVideoNoteModal, setShowVideoNoteModal] = useState(false);
  const [videoNoteRecording, setVideoNoteRecording] = useState(false);
  const [videoNoteSeconds, setVideoNoteSeconds] = useState(0);
  const videoNotePreviewRef = useRef<HTMLVideoElement | null>(null);
  const videoNoteStreamRef = useRef<MediaStream | null>(null);
  const videoNoteRecorderRef = useRef<MediaRecorder | null>(null);
  const videoNoteChunksRef = useRef<Blob[]>([]);
  const [expandedVideoNoteIds, setExpandedVideoNoteIds] = useState<Record<string, boolean>>({});

  // Пункт 2: Живые статусы набора текста / записи аудио / записи видеокружка
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const lastBroadcastTypingRef = useRef<number>(0);
  const typingChannelRef = useRef<any>(null);
  const globalTypingChannelRef = useRef<any>(null);

  // Пункт 3: Статусы прочтения (✓ и ✓✓)
  const [partnerLastReadAt, setPartnerLastReadAt] = useState<string | null>(null);

  // Пункт 8: Темы (Топики) в группах/каналах и Комментарии к постам в каналах
  const [channelGroupCfg, setChannelGroupCfg] = useState<ChannelGroupConfig>(DEFAULT_CHANNEL_GROUP_CONFIG);
  const [activeTopicId, setActiveTopicId] = useState<string>('all');
  const [activeCommentsPost, setActiveCommentsPost] = useState<Message | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [showNewTopicQuickModal, setShowNewTopicQuickModal] = useState(false);
  const [quickTopicName, setQuickTopicName] = useState('');

  // Пункт 5: Панель быстрого форматирования текста (Markdown + Спойлер)
  const [showFormatToolbar, setShowFormatToolbar] = useState(false);

  // Пункт 4: Модальное окно создания опроса (Polls)
  const [showPollModal, setShowPollModal] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollMulti, setPollMulti] = useState(false);

  // Поиск по сообщениям и Меню «Три точки» ⋮
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatSearchIndex, setChatSearchIndex] = useState(0);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);

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

  // Пункт 1: Прямой эфир (Live Stream) в каналах с функцией «Поднять руку ✋»
  const [liveStreamActive, setLiveStreamActive] = useState(false);
  const [raisedHands, setRaisedHands] = useState<{ userId: string; userName: string }[]>([]);
  const [hasRaisedHand, setHasRaisedHand] = useState(false);

  // Пункт 2: Частицы реакций (Reaction Particles)
  const [particleMsgId, setParticleMsgId] = useState<string | null>(null);
  const [particleEmoji, setParticleEmoji] = useState<string>('❤️');

  // Пункт 9: Умный автопереводчик сообщений
  const [translatedMessages, setTranslatedMessages] = useState<Record<string, string>>({});

  function insertEmoji(emoji: string) {
    setDraft((prev) => prev + emoji);
  }

  function applyMarkdownWrap(prefix: string, suffix = prefix, placeholder = 'текст') {
    setDraft((prev) => {
      if (!prev.trim()) return `${prefix}${placeholder}${suffix}`;
      return `${prev} ${prefix}${placeholder}${suffix}`;
    });
  }

  function broadcastLiveActivity(status: 'typing' | 'recording_voice' | 'recording_video') {
    if (!chatId || !me) return;
    const now = Date.now();
    if (status === 'typing' && now - lastBroadcastTypingRef.current < 2200) return;
    lastBroadcastTypingRef.current = now;

    try {
      typingChannelRef.current?.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: me.id, name: me.display_name, status },
      });
      globalTypingChannelRef.current?.send({
        type: 'broadcast',
        event: 'activity',
        payload: { chatId, userId: me.id, name: me.display_name, status },
      });
    } catch {}
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
    const baseText =
      channelGroupCfg.structureMode === 'topics' && activeTopicId !== 'all'
        ? encodeTopicPrefix(activeTopicId, draft.trim())
        : draft.trim();
    const textToSend = ttlSeconds > 0 ? encodeSelfDestructPrefix(ttlSeconds, baseText) : baseText;
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
    if (text.trim()) {
      broadcastLiveActivity('typing');
    }
  }

  // Пункт 10: Отправка стикера с дедупликацией по ID ([STICKER:id]) или GIF
  async function handleSendMedia(mediaUrl: string, caption?: string, stickerId?: string) {
    setShowEmoji(false);
    if (!chatId) return;
    try {
      if (stickerId) {
        // Вместо записи 30 КБ base64 в каждую строку messages, сохраняем только тег [STICKER:id] (~35 байт!)
        const stickerTag = encodeStickerTag(stickerId, caption || 'Стикер');
        const payload =
          channelGroupCfg.structureMode === 'topics' && activeTopicId !== 'all'
            ? encodeTopicPrefix(activeTopicId, stickerTag)
            : stickerTag;
        await sendMessage(chatId, payload, { messageType: 'text' });
      } else {
        await sendMessage(chatId, caption || 'GIF', {
          messageType: 'image',
          mediaPath: mediaUrl,
        });
      }
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
    const withTopic =
      channelGroupCfg.structureMode === 'topics' && activeTopicId !== 'all'
        ? encodeTopicPrefix(activeTopicId, encoded)
        : encoded;
    const finalPayload = ttlSeconds > 0 ? encodeSelfDestructPrefix(ttlSeconds, withTopic) : withTopic;
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
      broadcastLiveActivity('recording_voice');
    } catch {
      setNotice('Нет доступа к микрофону');
      setTimeout(() => setNotice(null), 2000);
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }

  // Пункт 1: Запись круглого видеосообщения (Video Note)
  async function openVideoNoteRecorder() {
    setShowVideoNoteModal(true);
    setVideoNoteSeconds(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 360 }, height: { ideal: 360 }, facingMode: 'user' },
        audio: true,
      });
      videoNoteStreamRef.current = stream;
      setTimeout(() => {
        if (videoNotePreviewRef.current) {
          videoNotePreviewRef.current.srcObject = stream;
        }
      }, 60);

      const recorder = new MediaRecorder(stream);
      videoNoteChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) videoNoteChunksRef.current.push(e.data);
      };
      recorder.start();
      videoNoteRecorderRef.current = recorder;
      setVideoNoteRecording(true);
      broadcastLiveActivity('recording_video');
    } catch {
      setShowVideoNoteModal(false);
      setNotice('Нет доступа к камере и микрофону для записи видеокружка');
      setTimeout(() => setNotice(null), 2500);
    }
  }

  useEffect(() => {
    if (!videoNoteRecording) return;
    const t = setInterval(() => {
      setVideoNoteSeconds((prev) => {
        if (prev >= 59) {
          void finishAndSendVideoNote();
          return 60;
        }
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [videoNoteRecording]);

  function cleanupVideoNoteStream() {
    if (videoNoteStreamRef.current) {
      videoNoteStreamRef.current.getTracks().forEach((t) => t.stop());
      videoNoteStreamRef.current = null;
    }
    videoNoteRecorderRef.current = null;
    setVideoNoteRecording(false);
    setShowVideoNoteModal(false);
    setVideoNoteSeconds(0);
  }

  async function finishAndSendVideoNote() {
    const rec = videoNoteRecorderRef.current;
    if (!rec) {
      cleanupVideoNoteStream();
      return;
    }
    rec.onstop = async () => {
      const blob = new Blob(videoNoteChunksRef.current, { type: 'video/webm' });
      cleanupVideoNoteStream();
      if (blob.size < 200) return;

      const file = new File([blob], `videonote-${Date.now()}.webm`, { type: 'video/webm' });
      setUploading(true);
      try {
        const { url } = await uploadMessageFile(chatId, file);
        await sendMessage(chatId, '__VIDEONOTE__:Видеосообщение', {
          messageType: 'video',
          mediaPath: url,
          caption: '__VIDEONOTE__',
        });
      } catch (err: any) {
        setNotice(err.message ?? 'Не удалось отправить видеокружок');
        setTimeout(() => setNotice(null), 2000);
      } finally {
        setUploading(false);
      }
    };
    try {
      rec.stop();
    } catch {
      cleanupVideoNoteStream();
    }
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
    setShowToolsMenu(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSendPendingFile() {
    if (!pendingFile) return;
    setUploading(true);
    try {
      const processed = await processZeroStorageFileAttachment(pendingFile);
      await sendMessage(chatId, processed.name, {
        messageType: detectMessageType(pendingFile),
        mediaPath: processed.url,
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

  // Пункт 8: Добавление новой темы (Топика) прямо из чата для создателя
  async function handleQuickAddTopic(e: React.FormEvent) {
    e.preventDefault();
    const clean = quickTopicName.trim();
    if (!clean || !chat) return;
    const newTopic = { id: `topic-${Date.now().toString(36)}`, title: clean, icon: '📌' };
    const nextTopics = [...channelGroupCfg.topics, newTopic];
    const nextCfg: ChannelGroupConfig = {
      ...channelGroupCfg,
      structureMode: 'topics',
      topics: nextTopics,
    };
    setChannelGroupCfg(nextCfg);
    setActiveTopicId(newTopic.id);
    setQuickTopicName('');
    setShowNewTopicQuickModal(false);

    try {
      const { cleanDescription } = parseChatDescriptionAndConfig(chat.description);
      const encoded = encodeChatDescriptionWithConfig(cleanDescription, nextCfg);
      await updateChatInfo(chat.id, { description: encoded });
      setChat({ ...chat, description: encoded });
    } catch {}
  }

  // Пункт 8: Отправка комментария к посту в канале (работает и для подписчиков!)
  async function handleSendPostComment(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCommentsPost || !me || !commentDraft.trim()) return;
    const payloadStr = encodePostCommentPayload({
      id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userName: me.display_name,
      text: commentDraft.trim(),
      createdAt: new Date().toISOString(),
    });
    setCommentDraft('');
    await handleToggleReaction(activeCommentsPost.id, payloadStr);
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
    setPartnerLastReadAt(null);
    setActiveTopicId('all');
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
      const parsedCfg = parseChatDescriptionAndConfig(chatRow.description);
      setChannelGroupCfg(parsedCfg.config);

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

      // Пункт 3: Загружаем время последнего прочтения собеседником/участниками из chat_read_state
      try {
        const { data: readRows } = await supabase
          .from('chat_read_state')
          .select('user_id, last_read_at')
          .eq('chat_id', chatId)
          .neq('user_id', profile.id);
        if (readRows && readRows.length > 0) {
          const latest = readRows
            .map((r: any) => r.last_read_at)
            .filter(Boolean)
            .sort()
            .pop();
          if (latest) setPartnerLastReadAt(latest);
        }
      } catch {}

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
            await markChatAsRead(profile.id, chatId);
            // Мгновенно оповещаем собеседника о прочтении (✓✓)
            try {
              typingChannelRef.current?.send({
                type: 'broadcast',
                event: 'read-receipt',
                payload: { userId: profile.id, readAt: new Date().toISOString() },
              });
            } catch {}

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

  // Пункты 2 и 3: Канал живого набора текста / записи голосового и мгновенного статуса прочтения (✓✓)
  useEffect(() => {
    if (!chatId || !me) return;
    const supabase = getSupabaseClient();
    const typingChannel = supabase.channel(`typing:${chatId}`);
    const globalTypingCh = supabase.channel('pixchats-typing-global');
    typingChannelRef.current = typingChannel;
    globalTypingChannelRef.current = globalTypingCh;

    typingChannel
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload && payload.userId && payload.userId !== me.id) {
          const userName = payload.name || 'Собеседник';
          const label =
            payload.status === 'recording_voice'
              ? `${userName} записывает голосовое…`
              : payload.status === 'recording_video'
                ? `${userName} записывает кружочек…`
                : `${userName} печатает…`;
          setTypingUsers((prev) => ({ ...prev, [payload.userId]: label }));
          setTimeout(() => {
            setTypingUsers((prev) => {
              const copy = { ...prev };
              delete copy[payload.userId];
              return copy;
            });
          }, 3600);
        }
      })
      .on('broadcast', { event: 'read-receipt' }, ({ payload }) => {
        if (payload && payload.userId && payload.userId !== me.id && payload.readAt) {
          setPartnerLastReadAt(payload.readAt);
        }
      })
      .subscribe((st) => {
        if (st === 'SUBSCRIBED') {
          // Сообщаем собеседнику, что мы открыли чат и прочитали сообщения
          typingChannel.send({
            type: 'broadcast',
            event: 'read-receipt',
            payload: { userId: me.id, readAt: new Date().toISOString() },
          });
        }
      });

    globalTypingCh.subscribe();

    const readDbChannel = supabase
      .channel(`read-db:${chatId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_read_state', filter: `chat_id=eq.${chatId}` },
        (payload: any) => {
          const row = payload.new;
          if (row && row.user_id !== me.id && row.last_read_at) {
            setPartnerLastReadAt(row.last_read_at);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(typingChannel);
      supabase.removeChannel(globalTypingCh);
      supabase.removeChannel(readDbChannel);
      typingChannelRef.current = null;
      globalTypingChannelRef.current = null;
    };
  }, [chatId, me?.id]);

  async function handleToggleReaction(messageId: string, emoji: string) {
    if (!me) return;
    if (!emoji.startsWith('💬:')) {
      setParticleMsgId(messageId);
      setParticleEmoji(emoji.replace(/📊\d+/, '👍'));
    }
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

  // Фильтрация сообщений по выбранной теме (Топику), если включён режим с темами (Пункт 8)
  const visibleMessages = useMemo(() => {
    if (channelGroupCfg.structureMode !== 'topics' || activeTopicId === 'all') {
      return messages;
    }
    return messages.filter((m) => {
      const { cleanText } = extractSelfDestructInfo(m.text || '');
      const { topicId } = extractTopicFromText(cleanText);
      if (!topicId) {
        return activeTopicId === channelGroupCfg.topics[0]?.id || activeTopicId === 'general';
      }
      return topicId === activeTopicId;
    });
  }, [messages, channelGroupCfg, activeTopicId]);

  // Поиск внутри чата (Пункт 6)
  const searchMatchedMessageIds = useMemo(() => {
    const q = chatSearchQuery.trim().toLowerCase();
    if (!q) return [];
    return visibleMessages
      .filter((m) => !m.is_deleted && m.text?.toLowerCase().includes(q))
      .map((m) => m.id);
  }, [visibleMessages, chatSearchQuery]);

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

    const withTopic =
      channelGroupCfg.structureMode === 'topics' && activeTopicId !== 'all'
        ? encodeTopicPrefix(activeTopicId, rawDraft)
        : rawDraft;
    const finalText = ttlSeconds > 0 ? encodeSelfDestructPrefix(ttlSeconds, withTopic) : withTopic;
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
    const { cleanText: withoutTopic } = extractTopicFromText(cleanText);
    await navigator.clipboard.writeText(withoutTopic);
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
  const liveHeaderActivity = Object.values(typingUsers)[0] || null;

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
            <AvatarWithStatus
              avatarUrl={blockedEitherWay ? null : otherProfile.avatar_url}
              name={otherProfile.display_name}
              size={40}
              statusType={otherLastSeen?.includes('в сети') || Boolean(liveHeaderActivity) ? 'online' : 'none'}
            />
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
              <div
                style={{
                  fontSize: 12,
                  color: liveHeaderActivity ? 'var(--accent)' : 'var(--text-muted)',
                  fontWeight: liveHeaderActivity ? 600 : 400,
                }}
              >
                {liveHeaderActivity ? `✍️ ${liveHeaderActivity}` : otherLastSeen}
              </div>
            </div>
          </Link>
        ) : (
          <Link
            href={`/chat-info/?id=${chat.id}`}
            style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'inherit', textDecoration: 'none' }}
          >
            <AvatarWithStatus
              avatarUrl={chat.avatar_url}
              name={chat.title || 'Чат'}
              size={40}
              statusType={chat.type === 'channel' && liveStreamActive ? 'live' : 'none'}
            />
            <div>
              <h2 style={{ fontSize: 15 }}>
                {chat.title ?? 'Чат'}
                {chat.is_verified && <VerifiedBadge size={14} />}
              </h2>
              <div
                style={{
                  fontSize: 12,
                  color: liveHeaderActivity ? 'var(--accent)' : 'var(--text-muted)',
                  fontWeight: liveHeaderActivity ? 600 : 400,
                }}
              >
                {liveHeaderActivity
                  ? `✍️ ${liveHeaderActivity}`
                  : `${memberCount} ${chat.type === 'channel' ? 'подписчиков' : 'участников'}`}
              </div>
            </div>
          </Link>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
          {/* Обычный звонок — стоит ЛЕВЕЕ трёх точек и не входит в меню */}
          {chat.type === 'direct' && otherProfile && !isSavedChat && !blockedEitherWay && (
            <button
              type="button"
              className="e2ee-badge-btn"
              onClick={() =>
                startPixChatsCall({
                  targetUserId: otherProfile.id,
                  targetName: otherProfile.display_name,
                  targetAvatar: otherProfile.avatar_url,
                  chatId: chat.id,
                  mode: 'audio',
                })
              }
              title="Позвонить собеседнику"
            >
              <span>📞</span>
              <span>Звонок</span>
            </button>
          )}

          {chat.type === 'group' && (
            <button
              type="button"
              className="e2ee-badge-btn"
              onClick={() =>
                startPixChatsGroupCall({
                  chatId: chat.id,
                  chatTitle: chat.title || 'Группа',
                  chatAvatar: chat.avatar_url,
                  mode: 'audio',
                })
              }
              title="Начать голосовой чат группы"
            >
              <span>🔊</span>
              <span>Голосовой чат</span>
            </button>
          )}

          {/* Пункт 1: Прямой эфир в каналах */}
          {chat.type === 'channel' && canModerate && (
            <button
              type="button"
              className="e2ee-badge-btn"
              style={{ background: liveStreamActive ? 'var(--danger)' : undefined, color: liveStreamActive ? '#fff' : undefined }}
              onClick={() => {
                setLiveStreamActive((v) => !v);
                setNotice(liveStreamActive ? 'Прямой эфир завершён' : '🔴 Прямой эфир запущен! Подписчики могут поднять руку ✋');
                setTimeout(() => setNotice(null), 2000);
              }}
              title="Запустить/завершить прямой эфир канала"
            >
              <span>🎙️</span>
              <span>{liveStreamActive ? 'Завершить эфир' : 'Прямой эфир'}</span>
            </button>
          )}

          {/* Единая кнопка «Три точки» ⋮ */}
          <button
            type="button"
            className="e2ee-badge-btn"
            style={{ fontSize: 18, padding: '4px 10px', lineHeight: 1 }}
            onClick={() => setShowHeaderMenu((prev) => !prev)}
            title="Ещё опции"
          >
            ⋮
          </button>

          {/* Выпадающее меню трех точек «⋮» */}
          {showHeaderMenu && (
            <div
              className="tools-dropdown-menu"
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 6,
                zIndex: 500,
                width: 230,
                background: 'var(--surface-raised)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
                padding: '6px 0',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <button
                type="button"
                style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', textAlign: 'left', fontSize: 13 }}
                onClick={() => {
                  setShowHeaderMenu(false);
                  setShowChatSearch(true);
                }}
              >
                <SearchIcon size={16} />
                <span>Поиск по сообщениям</span>
              </button>

              <button
                type="button"
                style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', textAlign: 'left', fontSize: 13 }}
                onClick={async () => {
                  setShowHeaderMenu(false);
                  if (me) {
                    const fp = await getChatSafetyFingerprint(chatId, me.id, otherProfile?.id);
                    setE2eeFingerprint(fp);
                  }
                  setCustomPassInput(getChatCustomPassphrase(chatId));
                  setShowE2EEModal(true);
                }}
              >
                <span>🔒</span>
                <span>Сквозное шифрование (E2EE)</span>
              </button>

              <button
                type="button"
                style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', textAlign: 'left', fontSize: 13 }}
                onClick={() => {
                  setShowHeaderMenu(false);
                  if (me) {
                    exportChatHistory(chat.title || 'Чат', messages, me, senderProfiles, otherProfile, 'html');
                  }
                }}
              >
                <span>📥</span>
                <span>Экспорт истории чата</span>
              </button>

              <button
                type="button"
                style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', textAlign: 'left', fontSize: 13 }}
                onClick={() => {
                  setShowHeaderMenu(false);
                  if (chat.type === 'direct' && otherProfile) {
                    router.push(`/user/?id=${otherProfile.id}`);
                  } else {
                    router.push(`/chat-info/?id=${chat.id}`);
                  }
                }}
              >
                <span>ℹ️</span>
                <span>{chat.type === 'direct' ? 'Профиль собеседника' : 'Информация о чате'}</span>
              </button>

              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

              <button
                type="button"
                style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', textAlign: 'left', fontSize: 13 }}
                onClick={() => {
                  setShowHeaderMenu(false);
                  toggleHiddenChat(chat.id);
                  setNotice('Статус скрытия чата изменён');
                  setTimeout(() => setNotice(null), 1500);
                }}
              >
                <span>🕵️</span>
                <span>{isChatHidden(chat.id) ? 'Показать в обычном списке' : 'Скрыть чат под PIN-код'}</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Пункт 8: Горизонтальная панель тем (Топиков), если создатель выбрал режим «С темами» */}
      {isGroupOrChannel && channelGroupCfg.structureMode === 'topics' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
            overflowX: 'auto',
          }}
        >
          <button
            type="button"
            className={`folder-tab ${activeTopicId === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTopicId('all')}
          >
            🗂️ Все темы
          </button>
          {channelGroupCfg.topics.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`folder-tab ${activeTopicId === t.id ? 'active' : ''}`}
              onClick={() => setActiveTopicId(t.id)}
            >
              {t.icon} #{t.title}
            </button>
          ))}
          {canModerate && (
            <button
              type="button"
              className="folder-tab"
              onClick={() => setShowNewTopicQuickModal(true)}
              title="Добавить новую тему"
            >
              + Тема
            </button>
          )}
        </div>
      )}

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

      {/* Пункт 1: Плашка активного прямого эфира канала для подписчиков */}
      {chat.type === 'channel' && (liveStreamActive || !canModerate) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            background: 'rgba(239, 68, 68, 0.12)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
            fontSize: 13,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--danger)', fontWeight: 700 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--danger)', display: 'inline-block' }} className="online-dot-glow" />
            <span>🔴 ИДЁТ ПРЯМОЙ ЭФИР КАНАЛА</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!canModerate && (
              <button
                type="button"
                className="btn"
                style={{ width: 'auto', padding: '4px 12px', fontSize: 12 }}
                onClick={() => {
                  setHasRaisedHand((v) => !v);
                  if (!hasRaisedHand && me) {
                    setRaisedHands((prev) => [...prev, { userId: me.id, userName: me.display_name }]);
                    setNotice('Вы подняли руку ✋. Админ может дать вам слово!');
                    setTimeout(() => setNotice(null), 2000);
                  }
                }}
              >
                {hasRaisedHand ? '✋ Рука поднята' : '✋ Поднять руку'}
              </button>
            )}
            {canModerate && raisedHands.length > 0 && (
              <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>
                ✋ Рук поднято: {raisedHands.length}
              </span>
            )}
          </div>
        </div>
      )}

      {pinnedMessage && (
        <div
          className="pinned-bar"
          style={{ cursor: 'pointer' }}
          onClick={() => scrollToMessageById(pinnedMessage.id)}
        >
          <span>📌 {extractTopicFromText(extractSelfDestructInfo(pinnedMessage.text).cleanText).cleanText}</span>
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

      <div
        className="chat-messages"
        onClick={() => {
          setOpenMenuId(null);
          setShowToolsMenu(false);
        }}
      >
        {visibleMessages.map((m, i) => {
          const prev = visibleMessages[i - 1];
          const showDateDivider = !prev || new Date(prev.sent_at).toDateString() !== new Date(m.sent_at).toDateString();
          const isMine = m.sender_id === me.id;
          const replySource = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : null;
          const sender = isGroupOrChannel && !isMine ? senderProfiles[m.sender_id] : null;
          const showSenderHeader = sender && (!prev || prev.sender_id !== m.sender_id || showDateDivider);

          // Отделяем служебные голоса опросов (📊1, 📊2...) и комментарии (💬:...) от обычных эмодзи-реакций
          const msgReactions = reactions[m.id] || {};
          const regularReactionsEntries = Object.entries(msgReactions).filter(
            ([emoji]) => !emoji.startsWith('📊') && !emoji.startsWith('💬:')
          );
          const postComments =
            chat.type === 'channel' && channelGroupCfg.commentsEnabled
              ? extractPostCommentsFromReactions(m.id, msgReactions)
              : [];

          // Извлекаем тему и проверяем тег дедуплицированного стикера [STICKER:id]
          const { cleanText: afterTtl } = extractSelfDestructInfo(m.text || '');
          const { topicId: msgTopicId, cleanText: cleanTopicText } = extractTopicFromText(afterTtl);
          const msgTopicObj = msgTopicId
            ? channelGroupCfg.topics.find((t) => t.id === msgTopicId)
            : null;
          const deduplicatedSticker = resolveStickerFromText(cleanTopicText);
          const isVideoNote =
            m.message_type === 'video' &&
            Boolean(m.media_path) &&
            (m.caption === '__VIDEONOTE__' || m.text?.startsWith('__VIDEONOTE__'));

          const isReadByPartner =
            isSavedChat ||
            Boolean(partnerLastReadAt && new Date(partnerLastReadAt).getTime() >= new Date(m.sent_at).getTime());

          // Пересобираем текст без префикса [TOPIC:id] для рендера
          const displayRawText =
            msgTopicId && m.text
              ? m.text.replace(`[TOPIC:${msgTopicId}]`, '')
              : m.text;

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
                  {/* Пункт 2: Анимированный всплеск микро-частиц реакции */}
                  <ReactionParticles
                    emoji={particleEmoji}
                    active={particleMsgId === m.id}
                    onComplete={() => setParticleMsgId(null)}
                  />
                  {showSenderHeader && (
                    <Link href={`/user/?id=${sender!.id}`} className="sender-name-link">
                      {sender!.display_name}
                    </Link>
                  )}

                  {msgTopicObj && activeTopicId === 'all' && (
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--accent)',
                        fontWeight: 700,
                        marginBottom: 3,
                        cursor: 'pointer',
                      }}
                      onClick={() => setActiveTopicId(msgTopicObj.id)}
                    >
                      {msgTopicObj.icon} #{msgTopicObj.title}
                    </div>
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
                        ↩ {extractTopicFromText(extractSelfDestructInfo(replySource.text).cleanText).cleanText}
                      </div>
                    )}
                    {m.forwarded_from_chat_id && <div className="forwarded-label">Переслано</div>}

                    {m.caption && m.caption !== '__VIDEONOTE__' && m.caption_position === 'above' && (
                      <div className="media-caption">{m.caption}</div>
                    )}

                    {/* Пункт 10: Дедуплицированный по ID стикер ([STICKER:id]) */}
                    {deduplicatedSticker ? (
                      <img
                        src={deduplicatedSticker.dataUrl}
                        alt={deduplicatedSticker.title}
                        className="media-sticker"
                        title={deduplicatedSticker.title}
                      />
                    ) : isVideoNote && m.media_path ? (
                      /* Пункт 1: Видеосообщение в кружочке (Video Note) */
                      <div
                        className={`video-note-bubble ${expandedVideoNoteIds[m.id] ? 'expanded' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedVideoNoteIds((prev) => ({ ...prev, [m.id]: !prev[m.id] }));
                        }}
                        title="Нажмите, чтобы включить/выключить звук и увеличить кружочек"
                      >
                        <video
                          src={m.media_path}
                          autoPlay
                          loop
                          playsInline
                          muted={!expandedVideoNoteIds[m.id]}
                        />
                        <span className="video-note-badge">
                          {expandedVideoNoteIds[m.id] ? '🔊 Звук вкл' : '🔇 Нажмите для звука'}
                        </span>
                      </div>
                    ) : m.message_type === 'image' && m.media_path ? (
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
                        rawText={displayRawText}
                        editedAt={m.edited_at}
                        isDeleted={m.is_deleted}
                        myUserId={me.id}
                        reactions={msgReactions}
                        onVotePollOption={(optIndex) => handleToggleReaction(m.id, `📊${optIndex + 1}`)}
                        onSelfDestructExpired={handleSelfDestructExpired}
                      />
                    )}

                    {m.caption && m.caption !== '__VIDEONOTE__' && m.caption_position === 'below' && (
                      <div className="media-caption">{m.caption}</div>
                    )}

                    <div className="bubble-time-standalone">
                      <span>{formatMessageTime(m.sent_at)}</span>
                      {/* Пункт 3: Статус прочтения (✓ доставлено / ✓✓ прочитано) */}
                      {isMine && !m.is_deleted && (
                        <span
                          className={`read-receipt-ticks ${isReadByPartner ? 'read' : 'sent'}`}
                          title={isReadByPartner ? 'Прочитано' : 'Доставлено'}
                        >
                          {isReadByPartner ? '✓✓' : '✓'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Пункт 8: Кнопка комментариев под постами канала (если комментарии включены создателем) */}
                  {chat.type === 'channel' && channelGroupCfg.commentsEnabled && !m.is_deleted && (
                    <div style={{ marginTop: 6 }}>
                      <button
                        type="button"
                        className="btn"
                        style={{
                          width: 'auto',
                          padding: '4px 10px',
                          fontSize: 12,
                          borderRadius: 999,
                          borderColor: postComments.length > 0 ? 'var(--accent)' : undefined,
                          color: postComments.length > 0 ? 'var(--accent)' : 'var(--text-muted)',
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveCommentsPost(m);
                        }}
                      >
                        💬 Комментарии ({postComments.length})
                      </button>
                    </div>
                  )}

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
                      <button
                        onClick={() => {
                          setOpenMenuId(null);
                          const { cleanText } = extractSelfDestructInfo(m.text || '');
                          const { cleanText: topicCleaned } = extractTopicFromText(cleanText);
                          const lang = detectLanguage(topicCleaned);
                          const translated = translateText(topicCleaned, lang === 'ru' ? 'en' : 'ru');
                          setTranslatedMessages((prev) => ({ ...prev, [m.id]: translated }));
                        }}
                      >
                        <span>🌐</span> Перевести
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
                        <button
                          onClick={() => {
                            setEditingMessage(m);
                            setDraft(extractTopicFromText(extractSelfDestructInfo(m.text).cleanText).cleanText);
                            setOpenMenuId(null);
                          }}
                        >
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
                    ] {extractTopicFromText(extractSelfDestructInfo(sm.text).cleanText).cleanText}
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
                  : `↩ Ответ: ${extractTopicFromText(extractSelfDestructInfo(replyingTo?.text || '').cleanText).cleanText}`}
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
              <button
                type="button"
                className="btn-ghost"
                style={{ width: 'auto', marginLeft: 'auto', fontSize: 12 }}
                onClick={() => setShowFormatToolbar(false)}
              >
                ✕
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
              <span>{Object.values(typingUsers).join(', ')}</span>
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

            {/* Компактное всплывающее меню «+» со всеми инструментами (освобождает 80% ширины под поле текста!) */}
            {showToolsMenu && (
              <div
                className="card"
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 8px)',
                  left: 10,
                  zIndex: 85,
                  width: 280,
                  padding: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  boxShadow: '0 12px 32px rgba(0,0,0,0.65)',
                }}
              >
                <button
                  type="button"
                  className="btn"
                  style={{ justifyContent: 'flex-start', gap: 10, fontSize: 13 }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span>📎</span>
                  <span>Фото, видео или файл</span>
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ justifyContent: 'flex-start', gap: 10, fontSize: 13 }}
                  onClick={() => {
                    setShowToolsMenu(false);
                    void openVideoNoteRecorder();
                  }}
                >
                  <span>🎥</span>
                  <span>Видеокружок (Video Note)</span>
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ justifyContent: 'flex-start', gap: 10, fontSize: 13 }}
                  onClick={() => {
                    setShowToolsMenu(false);
                    setShowPollModal(true);
                  }}
                >
                  <span>📊</span>
                  <span>Создать опрос</span>
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ justifyContent: 'flex-start', gap: 10, fontSize: 13 }}
                  onClick={() => {
                    setShowToolsMenu(false);
                    setShowFormatToolbar((v) => !v);
                  }}
                >
                  <span>Aa</span>
                  <span>Форматирование текста</span>
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ justifyContent: 'flex-start', gap: 10, fontSize: 13 }}
                  onClick={() => {
                    setShowToolsMenu(false);
                    setShowTimerPopover((v) => !v);
                  }}
                >
                  <span>{ttlSeconds > 0 ? '🔥' : '⏱️'}</span>
                  <span>
                    Таймер автоудаления {ttlSeconds > 0 ? `(${ttlSeconds}с)` : ''} и отложенные
                  </span>
                </button>
                <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                  <button
                    type="button"
                    className="btn"
                    style={{ flex: 1, fontSize: 11.5, padding: '6px 8px' }}
                    onClick={() => {
                      setShowToolsMenu(false);
                      exportChatHistory(
                        isSavedChat ? 'Избранное' : otherProfile?.display_name || chat.title || 'Чат',
                        messages,
                        me,
                        senderProfiles,
                        otherProfile,
                        'html'
                      );
                    }}
                  >
                    📥 Экспорт HTML
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{ flex: 1, fontSize: 11.5, padding: '6px 8px' }}
                    onClick={() => {
                      setShowToolsMenu(false);
                      exportChatHistory(
                        isSavedChat ? 'Избранное' : otherProfile?.display_name || chat.title || 'Чат',
                        messages,
                        me,
                        senderProfiles,
                        otherProfile,
                        'json'
                      );
                    }}
                  >
                    📥 Экспорт JSON
                  </button>
                </div>
              </div>
            )}

            {showTimerPopover && (
              <div
                className="card"
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 8px)',
                  left: 12,
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

            {/* Оптимизированная широкая панель ввода: только 1 кнопка «+» слева, огромное текстовое поле по центру и эмодзи + отправка/запись справа */}
            <form onSubmit={handleSend} className="chat-composer-unified-bar">
              <button
                type="button"
                className={`composer-inner-btn ${showToolsMenu || ttlSeconds > 0 ? 'active' : ''}`}
                onClick={() => {
                  setShowEmoji(false);
                  setShowTimerPopover(false);
                  setShowToolsMenu((v) => !v);
                }}
                disabled={uploading}
                title="Вложения, опросы, кружочки, таймер и инструменты"
              >
                {ttlSeconds > 0 ? <span style={{ fontSize: 15 }}>🔥</span> : <PaperclipIcon size={18} />}
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
                placeholder={
                  pendingFile
                    ? 'Подпись к файлу…'
                    : ttlSeconds > 0
                      ? `🔥 Исчезающее сообщение (${ttlSeconds}с)…`
                      : channelGroupCfg.structureMode === 'topics' && activeTopicId !== 'all'
                        ? `Сообщение в #${channelGroupCfg.topics.find((t) => t.id === activeTopicId)?.title || 'тему'}…`
                        : 'Написать сообщение…'
                }
                rows={1}
              />

              <button
                type="button"
                className={`composer-inner-btn ${showEmoji ? 'active' : ''}`}
                onClick={() => {
                  setShowToolsMenu(false);
                  setShowTimerPopover(false);
                  setShowEmoji((v) => !v);
                }}
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
                <>
                  <button
                    type="button"
                    className="composer-inner-btn"
                    onClick={() => void openVideoNoteRecorder()}
                    disabled={uploading || isRecording}
                    title="Записать круглое видеосообщение (кружочек)"
                    style={{ fontSize: 15 }}
                  >
                    🎥
                  </button>
                  <button
                    type="button"
                    className={`composer-inner-btn ${isRecording ? 'recording' : ''}`}
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={uploading}
                    title={isRecording ? 'Остановить запись' : 'Голосовое сообщение'}
                  >
                    {isRecording ? <StopIcon size={18} /> : <MicIcon size={18} />}
                  </button>
                </>
              )}
            </form>
          </div>
        </>
      ) : (
        <div className="subscriber-notice" style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <span>
            Вы подписчик канала — публиковать посты могут владелец и администраторы
            {channelGroupCfg.commentsEnabled ? ' (вы можете оставлять комментарии под постами 💬)' : ''}
          </span>
          <button className="btn" style={{ width: 'auto' }} onClick={handleUnsubscribe}>
            Отписаться
          </button>
        </div>
      )}

      {/* Пункт 1: Модальное окно записи видеосообщения в кружочке (Video Note) */}
      {showVideoNoteModal && (
        <div className="modal-overlay" style={{ zIndex: 9999 }} onClick={() => cleanupVideoNoteStream()}>
          <div
            className="modal-card"
            style={{ maxWidth: 340, textAlign: 'center', padding: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 12 }}>
              🎥 Запись видеокружка · 00:{String(videoNoteSeconds).padStart(2, '0')}
            </div>

            <div
              style={{
                width: 224,
                height: 224,
                borderRadius: '50%',
                overflow: 'hidden',
                margin: '0 auto 18px',
                border: '4px solid var(--accent)',
                boxShadow: '0 0 0 8px rgba(255, 212, 0, 0.16)',
                background: '#000',
              }}
            >
              <video
                ref={videoNotePreviewRef}
                autoPlay
                muted
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                type="button"
                className="btn"
                style={{ flex: 1 }}
                onClick={() => cleanupVideoNoteStream()}
              >
                ✕ Отмена
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => void finishAndSendVideoNote()}
              >
                ➤ Отправить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Пункт 8: Модальное окно комментариев к посту в канале */}
      {activeCommentsPost && (
        <div className="modal-overlay" onClick={() => setActiveCommentsPost(null)}>
          <div
            className="modal-card"
            style={{ maxWidth: 460, width: '100%', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 17 }}>💬 Комментарии к записи</h3>
              <button
                type="button"
                className="btn-ghost"
                style={{ width: 'auto', padding: '4px 8px' }}
                onClick={() => setActiveCommentsPost(null)}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                background: 'var(--bg-secondary)',
                borderLeft: '3px solid var(--accent)',
                fontSize: 12.5,
                color: 'var(--text-muted)',
                marginBottom: 12,
                maxHeight: 64,
                overflow: 'hidden',
              }}
            >
              {extractTopicFromText(extractSelfDestructInfo(activeCommentsPost.text).cleanText).cleanText}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {extractPostCommentsFromReactions(
                activeCommentsPost.id,
                reactions[activeCommentsPost.id] || {}
              ).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--text-muted)', fontSize: 13 }}>
                  Пока нет комментариев. Будьте первым!
                </div>
              ) : (
                extractPostCommentsFromReactions(
                  activeCommentsPost.id,
                  reactions[activeCommentsPost.id] || {}
                ).map((cmt) => (
                  <div
                    key={cmt.id}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: 'var(--surface-raised)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 4 }}>
                      <strong style={{ color: 'var(--accent)' }}>{cmt.userName}</strong>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {new Date(cmt.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{cmt.text}</div>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleSendPostComment} style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                className="input"
                style={{ flex: 1 }}
                placeholder="Написать комментарий…"
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                required
              />
              <button type="submit" className="btn btn-primary" style={{ width: 'auto', padding: '0 16px' }}>
                ➤
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Пункт 8: Быстрое добавление новой темы (Топика) из шапки */}
      {showNewTopicQuickModal && (
        <div className="modal-overlay" onClick={() => setShowNewTopicQuickModal(false)}>
          <div className="modal-card" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>🗂️ Новая тема (Топик)</h3>
            <form onSubmit={handleQuickAddTopic}>
              <div className="field">
                <label>Название темы</label>
                <input
                  className="input"
                  placeholder="Например: Мероприятия, Мемы, Важное"
                  value={quickTopicName}
                  onChange={(e) => setQuickTopicName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn" style={{ width: 'auto' }} onClick={() => setShowNewTopicQuickModal(false)}>
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
                Отмена
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: 'auto' }}
                onClick={async () => {
                  setChatCustomPassphrase(chatId, customPassInput);
                  setShowE2EEModal(false);
                  const refreshed = await getMessages(chatId);
                  setMessages(refreshed);
                  setNotice(
                    customPassInput.trim()
                      ? '🔒 Секретный пароль шифрования применён'
                      : '🔒 Используется стандартный ключ шифрования чата'
                  );
                  setTimeout(() => setNotice(null), 2200);
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

export default function ChatPage() {
  return (
    <DesktopShell>
      <Suspense fallback={<Loading />}>
        <ChatWindowInner />
      </Suspense>
    </DesktopShell>
  );
}
