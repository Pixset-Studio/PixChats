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

async function mapRowAsync(row: any): Promise<Message> {
  const decryptedText = row.is_deleted
    ? 'Сообщение удалено'
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
    is_deleted: row.is_deleted,
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
  if (!senderId) throw new Error('Нужно войти в аккаунт');

  const ciphertext = await encryptMessageE2EE(chatId, text);

  const { error } = await supabase.from('messages').insert({
    chat_id: chatId,
    sender_id: senderId,
    ciphertext,
    message_type: options.messageType ?? 'text',
    media_path: options.mediaPath ?? null,
    reply_to_id: options.replyToId ?? null,
    caption: options.caption ?? null,
    caption_position: options.captionPosition ?? 'below',
  });
  if (error) throw error;
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
  return Promise.all((data ?? []).map(mapRowAsync));
}

export async function getMessageById(messageId: string): Promise<Message | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('messages').select(SELECT_FIELDS).eq('id', messageId).maybeSingle();
  if (error) throw error;
  return data ? mapRowAsync(data) : null;
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

/** "Удалить у обоих" — soft-delete: текст стирается, но строка остаётся (не рвёт ответы/закреп). */
export async function deleteMessage(messageId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('messages')
    .update({ is_deleted: true, ciphertext: encodeLegacyBase64Text('') })
    .eq('id', messageId);
  if (error) throw error;
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

/** Последнее сообщение по каждому чату из списка — для превью в списке чатов. */
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

/** Переключить реакцию (поставить или снять) с мгновенной рассылкой в Realtime */
export async function toggleMessageReaction(
  chatId: string,
  messageId: string,
  emoji: string,
  userId: string
): Promise<ReactionPayload> {
  const current = getStoredReactions(chatId);
  const msgReactions = current[messageId] ?? {};
  const userList = msgReactions[emoji] ?? [];
  const hasReacted = userList.includes(userId);
  const action: 'add' | 'remove' = hasReacted ? 'remove' : 'add';

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

/** Подписка на новые/изменённые сообщения и реакции в чате через Supabase Realtime. */
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
        const msg = await mapRowAsync(payload.new);
        onInsert(msg);
      }
    )
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
    .on('broadcast', { event: 'reaction' }, (payload) => {
      if (payload.payload) onReaction?.(payload.payload as ReactionPayload);
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

