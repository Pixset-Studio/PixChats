import { getSupabaseClient } from './supabaseClient';
import {
  encryptMessageE2EE,
  decryptMessageE2EE,
  decodeLegacyBase64Text,
  encodeLegacyBase64Text,
  isEncryptedE2EEPayload,
} from './crypto';

export interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  text: string; // расшифровано через E2EE AES-256-GCM (или декодировано из старого формата Фазы 1)
  message_type: string;
  media_path: string | null;
  caption: string | null;
  caption_position: 'above' | 'below';
  sent_at: string;
  reply_to_id: string | null;
  edited_at: string | null;
  is_deleted: boolean;
  forwarded_from_chat_id: string | null;
  is_e2ee?: boolean;
}

const SELECT_FIELDS =
  'id, chat_id, sender_id, ciphertext, message_type, media_path, caption, caption_position, sent_at, reply_to_id, edited_at, is_deleted, forwarded_from_chat_id';

// Лёгкий набор полей без тяжёлого media_path (Base64) для превью в списке чатов — экономит >95% трафика БД
const PREVIEW_SELECT_FIELDS =
  'id, chat_id, sender_id, ciphertext, message_type, caption, caption_position, sent_at, reply_to_id, edited_at, is_deleted, forwarded_from_chat_id';

const DELETED_FOR_ME_STORAGE_KEY = 'pixchats:deleted_for_me';

function getDeletedForMeSet(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DELETED_FOR_ME_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function isMessageDeletedForMe(messageId: string): boolean {
  if (!messageId) return false;
  return getDeletedForMeSet().has(messageId);
}

/** "Удалить у меня" — скрывает сообщение только на текущем аккаунте/устройстве без следов и заглушек. */
export function deleteMessageForMe(messageId: string, chatId?: string): void {
  if (typeof window === 'undefined' || !messageId) return;
  try {
    const set = getDeletedForMeSet();
    set.add(messageId);
    const trimmed = Array.from(set).slice(-2000);
    localStorage.setItem(DELETED_FOR_ME_STORAGE_KEY, JSON.stringify(trimmed));
    window.dispatchEvent(new CustomEvent('pixchats:message_deleted', { detail: { messageId, chatId, mode: 'me' } }));
  } catch {}
}

// Кэш расшифрованных текстов сообщений (ключ: id + edited_at) и метаданных чатов/участников для экономии CPU и запросов к БД
const decryptedTextCache = new Map<string, string>();
const chatMetaCache = new Map<string, { type: string; visibility: string; title: string | null; direct_pair_key: string | null; memberIds: string[]; fetchedAt: number }>();
const activeChatChannels = new Map<string, any>();

async function mapRowAsync(row: any): Promise<Message> {
  const cacheKey = `${row.id}:${row.edited_at || ''}:${row.is_deleted ? '1' : '0'}`;
  let decryptedText = '';
  if (!row.is_deleted) {
    const cached = decryptedTextCache.get(cacheKey);
    if (cached !== undefined) {
      decryptedText = cached;
    } else {
      decryptedText = await decryptMessageE2EE(row.chat_id, row.ciphertext);
      if (decryptedTextCache.size > 1500) {
        const firstKey = decryptedTextCache.keys().next().value;
        if (firstKey) decryptedTextCache.delete(firstKey);
      }
      decryptedTextCache.set(cacheKey, decryptedText);
    }
  }
  return {
    id: row.id,
    chat_id: row.chat_id,
    sender_id: row.sender_id,
    text: decryptedText,
    message_type: row.message_type,
    media_path: row.media_path ?? null,
    caption: row.caption,
    caption_position: row.caption_position ?? 'below',
    sent_at: row.sent_at,
    reply_to_id: row.reply_to_id,
    edited_at: row.edited_at,
    is_deleted: Boolean(row.is_deleted),
    forwarded_from_chat_id: row.forwarded_from_chat_id,
    is_e2ee: isEncryptedE2EEPayload(row.ciphertext),
  };
}

/**
 * Безопасная отправка Realtime broadcast без дублирования и закрытия уже подписанных каналов.
 */
function safeBroadcastOnChannel(chName: string, event: string, payload: any): void {
  try {
    // 1. Проверяем глобальный канал NotificationListener в window
    if (typeof window !== 'undefined' && chName === 'pixchats-messages-global') {
      const globalCh = (window as any).__pixchatsGlobalMsgChannel;
      if (globalCh && typeof globalCh.send === 'function') {
        void globalCh.send({ type: 'broadcast', event, payload });
        return;
      }
    }

    // 2. Проверяем активный канал открытого чата
    const activeChatCh = activeChatChannels.get(chName);
    if (activeChatCh && typeof activeChatCh.send === 'function') {
      void activeChatCh.send({ type: 'broadcast', event, payload });
      return;
    }

    const supabase = getSupabaseClient();
    // 3. Ищем уже открытый канал в supabase.getChannels()
    const existing =
      typeof (supabase as any).getChannels === 'function'
        ? (supabase as any)
            .getChannels()
            .find((c: any) => c.topic === `realtime:${chName}` || c.topic === chName)
        : null;

    if (existing && (existing.state === 'joined' || existing.state === 'joining')) {
      void existing.send({ type: 'broadcast', event, payload });
      return;
    }

    // 4. Временный канал для однократной отправки (например, в личный канал получателя) с автоочисткой
    const tempChannel = supabase.channel(chName);
    tempChannel.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        void tempChannel
          .send({ type: 'broadcast', event, payload })
          .finally(() => {
            setTimeout(() => {
              try {
                supabase.removeChannel(tempChannel);
              } catch {}
            }, 600);
          });
      }
    });
  } catch {}
}

export interface SendMessageOptions {
  replyToId?: string;
  mediaPath?: string;
  messageType?: string;
  caption?: string;
  captionPosition?: 'above' | 'below';
}

/** Загружает произвольный файл в бакет message-media (с фолбэком в Base64 Data URL для небольших файлов/изображений). */
export async function uploadMessageFile(chatId: string, file: File): Promise<{ url: string; name: string; size: number }> {
  // Для небольших картинок (< 1.5 МБ) или если бакет недоступен, конвертируем в Base64
  try {
    const supabase = getSupabaseClient();
    const path = `${chatId}/${Date.now()}-${file.name}`;

    const { error } = await supabase.storage.from('message-media').upload(path, file);
    if (error) throw error;

    const { data } = supabase.storage.from('message-media').getPublicUrl(path);
    return { url: data.publicUrl, name: file.name, size: file.size };
  } catch (err) {
    if (file.size <= 3 * 1024 * 1024 && typeof FileReader !== 'undefined') {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(err);
        reader.readAsDataURL(file);
      });
      return { url: dataUrl, name: file.name, size: file.size };
    }
    throw err;
  }
}

export async function sendMessage(chatId: string, text: string, options: SendMessageOptions = {}): Promise<Message> {
  const supabase = getSupabaseClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const senderId = sessionData.session?.user.id;
  if (senderId) {
    const { getUserChatMute } = await import('./admin');
    const mute = await getUserChatMute(senderId, chatId);
    if (mute) {
      const untilStr = mute.muted_until
        ? `до ${new Date(mute.muted_until).toLocaleString('ru-RU')}`
        : 'бессрочно';
      throw new Error(`🔇 Вы замучены в этом чате ${untilStr}. Причина: ${mute.reason || 'Нарушение правил'}`);
    }
  }

  // 0. Кэшированная загрузка метаданных чата и его участников (обновляется раз в 3 минуты)
  let chatMeta = chatMetaCache.get(chatId);
  if (!chatMeta || Date.now() - chatMeta.fetchedAt > 180_000) {
    try {
      const [{ data: chatRow }, { data: members }] = await Promise.all([
        supabase.from('chats').select('type, visibility, title, direct_pair_key').eq('id', chatId).maybeSingle(),
        supabase.from('chat_members').select('user_id').eq('chat_id', chatId),
      ]);
      if (chatRow) {
        chatMeta = {
          type: chatRow.type,
          visibility: chatRow.visibility,
          title: chatRow.title,
          direct_pair_key: chatRow.direct_pair_key,
          memberIds: (members ?? []).map((m: any) => m.user_id).filter(Boolean),
          fetchedAt: Date.now(),
        };
        chatMetaCache.set(chatId, chatMeta);
      }
    } catch {}
  }

  // Автомодерация для публичных чатов, групп и каналов
  try {
    if (senderId && chatMeta && (chatMeta.visibility === 'public' || chatMeta.type === 'channel' || chatMeta.type === 'group')) {
      const { checkAutoModerationViolation, notifyAdminsAboutFreeze, muteUserInChat, autoFreezeUserAccount } = await import('./admin');
      const modResult = checkAutoModerationViolation(text);
      if (modResult.violated) {
        if (modResult.severity === 'light') {
          await muteUserInChat({ userId: senderId, chatId, durationHours: 24, reason: modResult.reason });
          throw new Error(`🔇 Вы получили автоматический мут в этом чате на 24 часа. Причина: ${modResult.reason}`);
        } else {
          const freezeReason = `Автомодерация в чате "${chatMeta.title || 'Публичный'}": ${modResult.reason || 'Запрещённые выражения'}`;
          await autoFreezeUserAccount(senderId, freezeReason);
          await notifyAdminsAboutFreeze(senderId, freezeReason);
          throw new Error(`⚠️ ${modResult.reason || 'Нарушение правил общения'}. Ваш аккаунт автоматически заморожен.`);
        }
      }
    }
  } catch (err: any) {
    if (err.message?.includes('автоматически заморожен') || err.message?.includes('автоматический мут')) {
      throw err;
    }
  }

  const ciphertext = await encryptMessageE2EE(chatId, text);

  const { data: insertedRow, error } = await supabase
    .from('messages')
    .insert({
      chat_id: chatId,
      sender_id: senderId,
      ciphertext,
      message_type: options.messageType ?? 'text',
      media_path: options.mediaPath ?? null,
      reply_to_id: options.replyToId ?? null,
      caption: options.caption ?? null,
      caption_position: options.captionPosition ?? 'below',
    })
    .select(SELECT_FIELDS)
    .single();

  if (error) throw error;

  const mapped = await mapRowAsync(insertedRow);

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent('pixchats:message_sent', { detail: { chatId, message: mapped } })
      );
    } catch {}
  }

  // Рассылаем мгновенный Realtime broadcast для моментального появления сообщения и 100% срабатывания уведомлений
  try {
    const { getCachedCurrentProfile } = await import('./auth');
    const cachedMe = getCachedCurrentProfile();
    let senderProfile: any =
      cachedMe && cachedMe.id === senderId
        ? {
            id: cachedMe.id,
            display_name: cachedMe.display_name,
            username: cachedMe.username,
            avatar_url: cachedMe.avatar_url,
          }
        : null;

    if (!senderProfile && senderId) {
      const { data: sp } = await supabase
        .from('profiles')
        .select('id, display_name, username, avatar_url')
        .eq('id', senderId)
        .maybeSingle();
      senderProfile = sp;
    }

    const recipientIds = new Set<string>();
    if (chatMeta) {
      for (const uid of chatMeta.memberIds) {
        if (uid && uid !== senderId) recipientIds.add(uid);
      }
      if (recipientIds.size === 0 && chatMeta.direct_pair_key) {
        for (const p of chatMeta.direct_pair_key.split(':')) {
          if (p && p !== senderId) recipientIds.add(p);
        }
      }
    }

    // Не пересылаем тяжёлый Base64 media_path через WebSocket broadcast (экономит память и исключает превышение лимита кадра WebSocket)
    const lightRow = { ...insertedRow, media_path: null };
    const broadcastPayload = {
      message: mapped,
      row: lightRow,
      sender: senderProfile,
      chatId,
      chatType: chatMeta?.type || 'direct',
      chatTitle: chatMeta?.title || null,
      targetUserIds: Array.from(recipientIds),
    };

    // 1. В канал конкретного чата
    safeBroadcastOnChannel(`messages:${chatId}`, 'new-message', broadcastPayload);
    // 2. В глобальный канал сообщений (использует уже открытый сокет без переподключения)
    safeBroadcastOnChannel('pixchats-messages-global', 'new-message', broadcastPayload);
    // 3. Персонально каждому получателю в личный канал уведомлений
    for (const uid of recipientIds) {
      safeBroadcastOnChannel(`pixchats-user-notifications:${uid}`, 'new-message', broadcastPayload);
    }
  } catch {
    // broadcast failure should not block message send
  }

  const cachedChat = messagesByChatCache.get(chatId);
  if (cachedChat) {
    if (!cachedChat.messages.some((m) => m.id === mapped.id)) {
      cachedChat.messages = [...cachedChat.messages, mapped];
      cachedChat.fetchedAt = Date.now();
    }
  }

  return mapped;
}

const messagesByChatCache = new Map<string, { messages: Message[]; fetchedAt: number; limit: number }>();

export async function getMessages(chatId: string, limit = 80): Promise<Message[]> {
  const now = Date.now();
  const cached = messagesByChatCache.get(chatId);
  if (cached && cached.limit >= limit && now - cached.fetchedAt < 45_000) {
    return cached.messages.filter((m) => !m.is_deleted && !isMessageDeletedForMe(m.id));
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('messages')
    .select(SELECT_FIELDS)
    .eq('chat_id', chatId)
    .eq('is_deleted', false)
    .order('sent_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const chronologicalRows = [...(data ?? [])].reverse();
  const visibleRows = chronologicalRows.filter((row: any) => !row.is_deleted && !isMessageDeletedForMe(row.id));
  const mapped = await Promise.all(visibleRows.map(mapRowAsync));
  messagesByChatCache.set(chatId, { messages: mapped, fetchedAt: Date.now(), limit });
  return mapped;
}


export async function getMessageById(messageId: string): Promise<Message | null> {
  if (isMessageDeletedForMe(messageId)) return null;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('messages').select(SELECT_FIELDS).eq('id', messageId).maybeSingle();
  if (error) throw error;
  if (!data || data.is_deleted) return null;
  return mapRowAsync(data);
}

/** Редактирование своего сообщения — шифрует новый текст через E2EE AES-256-GCM и отмечает edited_at. */
export async function editMessage(messageId: string, newText: string, chatId?: string): Promise<void> {
  const supabase = getSupabaseClient();
  let targetChatId = chatId;
  if (!targetChatId) {
    const { data } = await supabase.from('messages').select('chat_id').eq('id', messageId).maybeSingle();
    targetChatId = data?.chat_id;
  }
  const ciphertext = targetChatId
    ? await encryptMessageE2EE(targetChatId, newText)
    : encodeLegacyBase64Text(newText);

  const editedAt = new Date().toISOString();
  const { error } = await supabase
    .from('messages')
    .update({ ciphertext, edited_at: editedAt })
    .eq('id', messageId);
  if (error) throw error;

  if (targetChatId) {
    const cached = messagesByChatCache.get(targetChatId);
    if (cached) {
      cached.messages = cached.messages.map((m) =>
        m.id === messageId ? { ...m, text: newText, edited_at: editedAt } : m
      );
    }
  }
}

/** "Удалить у всех" — полное удаление сообщения без плашки «Сообщение удалено» у всех участников чата. */
export async function deleteMessage(messageId: string, chatId?: string): Promise<void> {
  const supabase = getSupabaseClient();
  let targetChatId = chatId;
  try {
    if (!targetChatId) {
      const { data } = await supabase.from('messages').select('chat_id').eq('id', messageId).maybeSingle();
      targetChatId = data?.chat_id;
    }
  } catch {}

  if (targetChatId) {
    const cached = messagesByChatCache.get(targetChatId);
    if (cached) {
      cached.messages = cached.messages.filter((m) => m.id !== messageId);
    }
  }

  // Снимаем закреп и очищаем ссылки reply_to_id, чтобы не блокировать полное удаление
  try {
    if (targetChatId) {
      await supabase.from('chats').update({ pinned_message_id: null }).eq('id', targetChatId).eq('pinned_message_id', messageId);
    }
    await supabase.from('messages').update({ reply_to_id: null }).eq('reply_to_id', messageId);
  } catch {}

  // Помечаем is_deleted = true (на случай ограничений RLS на физический DELETE) и удаляем физически из БД
  try {
    await supabase
      .from('messages')
      .update({ is_deleted: true, ciphertext: encodeLegacyBase64Text('') })
      .eq('id', messageId);
  } catch {}

  try {
    await supabase.from('messages').delete().eq('id', messageId);
  } catch {}

  // Мгновенно рассылаем событие удаления всем открытым клиентам чата
  if (targetChatId) {
    safeBroadcastOnChannel(`messages:${targetChatId}`, 'delete-message', {
      messageId,
      chatId: targetChatId,
    });
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('pixchats:message_deleted', { detail: { messageId, chatId: targetChatId, mode: 'all' } })
    );
  }
}

export async function pinMessage(chatId: string, messageId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('chats').update({ pinned_message_id: messageId }).eq('id', chatId);
  if (error) throw error;
}

export async function unpinMessage(chatId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('chats').update({ pinned_message_id: null }).eq('id', chatId);
  if (error) throw error;
}

/** Пересылка: копирует текст в другой чат, помечая forwarded_from_chat_id (откуда переслано). */
export async function forwardMessage(message: Message, targetChatId: string): Promise<void> {
  await sendMessage(targetChatId, message.text, { messageType: message.message_type });
  const supabase = getSupabaseClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const senderId = sessionData.session?.user.id;
  await supabase
    .from('messages')
    .update({ forwarded_from_chat_id: message.chat_id })
    .eq('chat_id', targetChatId)
    .eq('sender_id', senderId)
    .order('sent_at', { ascending: false })
    .limit(1);
}

/** Последнее сообщение по каждому чату из списка — для превью в списке чатов (без удалённых сообщений и без загрузки тяжёлых Base64 media_path). */
export async function getLastMessagesForChats(chatIds: string[]): Promise<Record<string, Message>> {
  if (chatIds.length === 0) return {};
  const supabase = getSupabaseClient();
  const rowLimit = Math.min(80, Math.max(15, chatIds.length * 3));
  const { data, error } = await supabase
    .from('messages')
    .select(PREVIEW_SELECT_FIELDS)
    .in('chat_id', chatIds)
    .order('sent_at', { ascending: false })
    .limit(rowLimit);
  if (error) throw error;

  const latestRows: any[] = [];
  const seenChats = new Set<string>();
  for (const row of data ?? []) {
    if (row.is_deleted || isMessageDeletedForMe(row.id)) continue;
    if (!seenChats.has(row.chat_id)) {
      seenChats.add(row.chat_id);
      latestRows.push(row);
    }
  }

  const mapped = await Promise.all(latestRows.map(mapRowAsync));
  const result: Record<string, Message> = {};
  for (const msg of mapped) {
    result[msg.chat_id] = msg;
  }
  return result;
}

export interface ReactionPayload {
  messageId: string;
  emoji: string;
  userId: string;
  action: 'add' | 'remove';
}

function getStoredReactions(chatId: string): Record<string, Record<string, string[]>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(`pixchats:reactions:${chatId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStoredReactions(chatId: string, reactions: Record<string, Record<string, string[]>>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`pixchats:reactions:${chatId}`, JSON.stringify(reactions));
  } catch {}
}

/** Получить реакции для сообщений в чате */
export async function getChatReactions(chatId: string, messageIds: string[]): Promise<Record<string, Record<string, string[]>>> {
  const result: Record<string, Record<string, string[]>> = getStoredReactions(chatId);
  if (messageIds.length === 0) return result;

  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('message_reactions')
      .select('message_id, emoji, user_id')
      .in('message_id', messageIds);

    if (data && data.length > 0) {
      for (const row of data) {
        if (!result[row.message_id]) result[row.message_id] = {};
        if (!result[row.message_id][row.emoji]) result[row.message_id][row.emoji] = [];
        if (!result[row.message_id][row.emoji].includes(row.user_id)) {
          result[row.message_id][row.emoji].push(row.user_id);
        }
      }
      saveStoredReactions(chatId, result);
    }
  } catch {
    // broadcast + local fallback
  }

  return result;
}

export function isSpecialMetadataReaction(emoji: string): boolean {
  return emoji.startsWith('📊') || emoji.startsWith('☑️') || emoji.startsWith('💬:');
}

/** Переключить реакцию (поставить или снять) с мгновенной рассылкой в Realtime */
export async function toggleMessageReaction(
  chatId: string,
  messageId: string,
  emoji: string,
  userId: string,
  isDeveloper = false
): Promise<ReactionPayload> {
  const current = getStoredReactions(chatId);
  const msgReactions = current[messageId] ?? {};
  const userList = msgReactions[emoji] ?? [];
  const hasReacted = userList.includes(userId);
  const action: 'add' | 'remove' = hasReacted ? 'remove' : 'add';

  if (action === 'add' && !isDeveloper && !isSpecialMetadataReaction(emoji)) {
    let myEmojiCount = 0;
    for (const [keyEmoji, uList] of Object.entries(msgReactions)) {
      if (!isSpecialMetadataReaction(keyEmoji) && Array.isArray(uList) && uList.includes(userId)) {
        myEmojiCount++;
      }
    }
    if (myEmojiCount >= 3) {
      throw new Error('Можно поставить максимум 3 реакции на одно сообщение (безлимит для разработчика)');
    }
  }

  if (action === 'add') {
    msgReactions[emoji] = [...userList, userId];
  } else {
    msgReactions[emoji] = userList.filter((id) => id !== userId);
    if (msgReactions[emoji].length === 0) delete msgReactions[emoji];
  }
  current[messageId] = msgReactions;
  saveStoredReactions(chatId, current);

  // Broadcast через Supabase Realtime канал чата без создания дубликата канала
  try {
    const supabase = getSupabaseClient();
    safeBroadcastOnChannel(`messages:${chatId}`, 'reaction', { messageId, emoji, userId, action });

    if (action === 'add') {
      supabase.from('message_reactions').insert({ message_id: messageId, emoji, user_id: userId }).then(() => {});
    } else {
      supabase.from('message_reactions').delete().eq('message_id', messageId).eq('emoji', emoji).eq('user_id', userId).then(() => {});
    }
  } catch {
    // fallback
  }

  return { messageId, emoji, userId, action };
}

/** Подписка на новые/изменённые/удалённые сообщения и реакции в чате через Supabase Realtime. */
export function subscribeToMessages(
  chatId: string,
  onInsert: (message: Message) => void,
  onUpdate?: (message: Message) => void,
  onReaction?: (reaction: ReactionPayload) => void
): () => void {
  const supabase = getSupabaseClient();
  const topicName = `messages:${chatId}`;
  const prevCh = activeChatChannels.get(topicName);
  if (prevCh) {
    try {
      supabase.removeChannel(prevCh);
    } catch {}
    activeChatChannels.delete(topicName);
  }

  const cacheInsert = (msg: Message) => {
    const cached = messagesByChatCache.get(chatId);
    if (cached && !cached.messages.some((m) => m.id === msg.id)) {
      cached.messages = [...cached.messages, msg];
      cached.fetchedAt = Date.now();
    }
  };

  const cacheUpdate = (msg: Message) => {
    const cached = messagesByChatCache.get(chatId);
    if (cached) {
      if (msg.is_deleted) {
        cached.messages = cached.messages.filter((m) => m.id !== msg.id);
      } else {
        cached.messages = cached.messages.map((m) => (m.id === msg.id ? msg : m));
      }
    }
  };

  const channel = supabase
    .channel(topicName)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
      async (payload) => {
        if (payload.new?.is_deleted || isMessageDeletedForMe(payload.new?.id)) return;
        const msg = await mapRowAsync(payload.new);
        cacheInsert(msg);
        onInsert(msg);
      }
    )
    .on('broadcast', { event: 'new-message' }, async (payload: any) => {
      const msg = payload.payload?.message;
      if (msg && !msg.is_deleted && !isMessageDeletedForMe(msg.id)) {
        cacheInsert(msg);
        onInsert(msg);
      }
    })
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
      async (payload) => {
        const msg = await mapRowAsync(payload.new);
        cacheUpdate(msg);
        if (onUpdate) {
          onUpdate(msg);
        }
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages' },
      (payload: any) => {
        const deletedId = payload.old?.id;
        if (deletedId) {
          const delMsg = { id: deletedId, chat_id: chatId, is_deleted: true, text: '' } as Message;
          cacheUpdate(delMsg);
          if (onUpdate) onUpdate(delMsg);
        }
      }
    )
    .on('broadcast', { event: 'delete-message' }, (payload: any) => {
      const deletedId = payload?.payload?.messageId;
      if (deletedId) {
        const delMsg = { id: deletedId, chat_id: chatId, is_deleted: true, text: '' } as Message;
        cacheUpdate(delMsg);
        if (onUpdate) onUpdate(delMsg);
      }
    })
    .on('broadcast', { event: 'reaction' }, (payload) => {
      if (payload.payload) onReaction?.(payload.payload as ReactionPayload);
    })
    .subscribe();

  activeChatChannels.set(topicName, channel);

  return () => {
    if (activeChatChannels.get(topicName) === channel) {
      activeChatChannels.delete(topicName);
    }
    supabase.removeChannel(channel);
  };
}

