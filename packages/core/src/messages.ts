import { getSupabaseClient } from './supabaseClient';

export interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  text: string; // декодировано из ciphertext (заглушка Фазы 1 — просто base64(plaintext))
  message_type: string;
  media_path: string | null;
  caption: string | null;
  caption_position: 'above' | 'below';
  sent_at: string;
  reply_to_id: string | null;
  edited_at: string | null;
  is_deleted: boolean;
  forwarded_from_chat_id: string | null;
}

function encodeText(text: string): string {
  // Фаза 1: заглушка — просто base64 от UTF-8 текста.
  // Фаза 2: здесь будет вызов libsignal Double Ratchet encrypt(), а результат
  // (реальный шифротекст) точно так же ляжет в это же поле ciphertext.
  return btoa(unescape(encodeURIComponent(text)));
}

function decodeText(ciphertext: string): string {
  try {
    return decodeURIComponent(escape(atob(ciphertext)));
  } catch {
    return '[не удалось расшифровать]';
  }
}

const SELECT_FIELDS =
  'id, chat_id, sender_id, ciphertext, message_type, media_path, caption, caption_position, sent_at, reply_to_id, edited_at, is_deleted, forwarded_from_chat_id';

function mapRow(row: any): Message {
  return {
    id: row.id,
    chat_id: row.chat_id,
    sender_id: row.sender_id,
    text: row.is_deleted ? 'Сообщение удалено' : decodeText(row.ciphertext),
    message_type: row.message_type,
    media_path: row.media_path,
    caption: row.caption,
    caption_position: row.caption_position ?? 'below',
    sent_at: row.sent_at,
    reply_to_id: row.reply_to_id,
    edited_at: row.edited_at,
    is_deleted: row.is_deleted,
    forwarded_from_chat_id: row.forwarded_from_chat_id,
  };
}

export interface SendMessageOptions {
  replyToId?: string;
  mediaPath?: string;
  messageType?: string;
  caption?: string;
  captionPosition?: 'above' | 'below';
}

/** Загружает произвольный файл (любого типа) в бакет message-media (папка = chatId), возвращает публичный URL. */
export async function uploadMessageFile(chatId: string, file: File): Promise<{ url: string; name: string; size: number }> {
  const supabase = getSupabaseClient();
  const path = `${chatId}/${Date.now()}-${file.name}`;

  const { error } = await supabase.storage.from('message-media').upload(path, file);
  if (error) throw error;

  const { data } = supabase.storage.from('message-media').getPublicUrl(path);
  return { url: data.publicUrl, name: file.name, size: file.size };
}

export async function sendMessage(chatId: string, text: string, options: SendMessageOptions = {}): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const senderId = sessionData.session?.user.id;
  if (!senderId) throw new Error('Нужно войти в аккаунт');

  const { error } = await supabase.from('messages').insert({
    chat_id: chatId,
    sender_id: senderId,
    ciphertext: encodeText(text),
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
  return (data ?? []).map(mapRow);
}

export async function getMessageById(messageId: string): Promise<Message | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('messages').select(SELECT_FIELDS).eq('id', messageId).maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

/** Редактирование своего сообщения — отмечает edited_at, UI показывает пометку "изменено". */
export async function editMessage(messageId: string, newText: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('messages')
    .update({ ciphertext: encodeText(newText), edited_at: new Date().toISOString() })
    .eq('id', messageId);
  if (error) throw error;
}

/** "Удалить у обоих" — soft-delete: текст стирается, но строка остаётся (не рвёт ответы/закреп). */
export async function deleteMessage(messageId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('messages')
    .update({ is_deleted: true, ciphertext: encodeText('') })
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
  // Помечаем последнюю вставленную запись как пересланную отдельным update, т.к. insert
  // не возвращает id в текущей реализации sendMessage — проще и надёжнее отдельным шагом.
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

  const result: Record<string, Message> = {};
  for (const row of data ?? []) {
    if (!result[row.chat_id]) result[row.chat_id] = mapRow(row);
  }
  return result;
}

/** Подписка на новые/изменённые сообщения в чате через Supabase Realtime. Возвращает функцию отписки. */
export function subscribeToMessages(
  chatId: string,
  onInsert: (message: Message) => void,
  onUpdate?: (message: Message) => void
): () => void {
  const supabase = getSupabaseClient();
  const channel = supabase
    .channel(`messages:${chatId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
      (payload) => onInsert(mapRow(payload.new))
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
      (payload) => onUpdate?.(mapRow(payload.new))
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
