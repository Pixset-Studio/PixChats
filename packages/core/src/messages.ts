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

async function mapRowAsync(row: any): Promise<Message> {
  const decryptedText = row.is_deleted
    ? ''
    : await decryptMessageE2EE(row.chat_id, row.ciphertext);
  return {
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
    is_deleted: Boolean(row.is_deleted),
    forwarded_from_chat_id: row.forwarded_from_chat_id,
    is_e2ee: isEncryptedE2EEPayload(row.ciphertext),
  };
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

export async function sendMessage(chatId: string, text: string, options: SendMessageOptions = {}): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const senderId = sessionData.session?.user.id;
  // 0. Автомодерация для публичных чатов, групп и каналов
  try {
    const { data: chatRow } = await supabase
      .from('chats')
      .select('type, visibility, title')
      .eq('id', chatId)
      .maybeSingle();

    if (senderId && chatRow && (chatRow.visibility === 'public' || chatRow.type === 'channel' || chatRow.type === 'group')) {
      const { checkAutoModerationViolation, notifyAdminsAboutFreeze } = await import('./admin');
      const modResult = checkAutoModerationViolation(text);
      if (modResult.violated) {
        // Автоматически замораживаем аккаунт нарушителя
        await supabase.from('profiles').update({ frozen: true }).eq('id', senderId);
        await notifyAdminsAboutFreeze(senderId, `Автомодерация в чате "${chatRow.title || 'Публичный'}": ${modResult.reason || 'Запрещённые выражения'}`);
        throw new Error(`⚠️ ${modResult.reason || 'Нарушение правил общения'}. Ваш аккаунт автоматически заморожен.`);
      }
    }
  } catch (err: any) {
    if (err.message?.includes('автоматически заморожен')) {
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

  // Рассылаем мгновенный Realtime broadcast для моментального появления сообщения и надёжного срабатывания уведомлений
  try {
    const mapped = await mapRowAsync(insertedRow);
    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('id, display_name, username, avatar_url')
      .eq('id', senderId)
      .maybeSingle();

    // Находим всех получателей сообщения (по chat_members и direct_pair_key)
    const recipientIds = new Set<string>();
    try {
      const { data: members } = await supabase
        .from('chat_members')
        .select('user_id')
        .eq('chat_id', chatId);

      if (members) {
        for (const m of members) {
          if (m.user_id && m.user_id !== senderId) recipientIds.add(m.user_id);
        }
      }

      if (recipientIds.size === 0) {
        const { data: chatRow } = await supabase
          .from('chats')
          .select('direct_pair_key')
          .eq('id', chatId)
          .maybeSingle();
        if (chatRow?.direct_pair_key) {
          const parts = chatRow.direct_pair_key.split(':');
          for (const p of parts) {
            if (p && p !== senderId) recipientIds.add(p);
          }
        }
      }
    } catch {}

    const broadcastPayload = {
      message: mapped,
      row: insertedRow,
      sender: senderProfile,
      chatId,
      targetUserIds: Array.from(recipientIds),
    };

    const sendBroadcast = (chName: string) => {
      try {
        const ch = supabase.channel(chName);
        if ((ch as any).state === 'joined') {
          void ch.send({ type: 'broadcast', event: 'new-message', payload: broadcastPayload });
          return;
        }
        ch.subscribe((st) => {
          if (st === 'SUBSCRIBED') {
            void ch.send({ type: 'broadcast', event: 'new-message', payload: broadcastPayload });
          }
        });
      } catch {}
    };

    // 1. В канал конкретного чата
    sendBroadcast(`messages:${chatId}`);
    // 2. В глобальный канал сообщений
    sendBroadcast('pixchats-messages-global');
    // 3. Персонально каждому получателю в личный канал уведомлений
    for (const uid of recipientIds) {
      sendBroadcast(`pixchats-user-notifications:${uid}`);
    }
  } catch {
    // broadcast failure should not block message send
  }
}

export async function getMessages(chatId: string, limit = 200): Promise<Message[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('messages')
    .select(SELECT_FIELDS)
    .eq('chat_id', chatId)
    .order('sent_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  const visibleRows = (data ?? []).filter((row: any) => !row.is_deleted && !isMessageDeletedForMe(row.id));
  return Promise.all(visibleRows.map(mapRowAsync));
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

  const { error } = await supabase
    .from('messages')
    .update({ ciphertext, edited_at: new Date().toISOString() })
    .eq('id', messageId);
  if (error) throw error;
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
    try {
      const channel = supabase.channel(`messages:${targetChatId}`);
      channel.send({
        type: 'broadcast',
        event: 'delete-message',
        payload: { messageId, chatId: targetChatId },
      });
    } catch {}
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

/** Последнее сообщение по каждому чату из списка — для превью в списке чатов (без удалённых сообщений). */
export async function getLastMessagesForChats(chatIds: string[]): Promise<Record<string, Message>> {
  if (chatIds.length === 0) return {};
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('messages')
    .select(SELECT_FIELDS)
    .in('chat_id', chatIds)
    .order('sent_at', { ascending: false })
    .limit(500);
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

  // Broadcast через Supabase Realtime канал чата
  try {
    const supabase = getSupabaseClient();
    const channel = supabase.channel(`messages:${chatId}`);
    channel.send({
      type: 'broadcast',
      event: 'reaction',
      payload: { messageId, emoji, userId, action },
    });

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
  const channel = supabase
    .channel(`messages:${chatId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
      async (payload) => {
        if (payload.new?.is_deleted || isMessageDeletedForMe(payload.new?.id)) return;
        const msg = await mapRowAsync(payload.new);
        onInsert(msg);
      }
    )
    .on('broadcast', { event: 'new-message' }, async (payload: any) => {
      const msg = payload.payload?.message;
      if (msg && !msg.is_deleted && !isMessageDeletedForMe(msg.id)) {
        onInsert(msg);
      }
    })
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
      async (payload) => {
        if (onUpdate) {
          const msg = await mapRowAsync(payload.new);
          onUpdate(msg);
        }
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages' },
      (payload: any) => {
        const deletedId = payload.old?.id;
        if (deletedId && onUpdate) {
          onUpdate({ id: deletedId, chat_id: chatId, is_deleted: true, text: '' } as Message);
        }
      }
    )
    .on('broadcast', { event: 'delete-message' }, (payload: any) => {
      const deletedId = payload?.payload?.messageId;
      if (deletedId && onUpdate) {
        onUpdate({ id: deletedId, chat_id: chatId, is_deleted: true, text: '' } as Message);
      }
    })
    .on('broadcast', { event: 'reaction' }, (payload) => {
      if (payload.payload) onReaction?.(payload.payload as ReactionPayload);
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

