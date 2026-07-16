import { getSupabaseClient } from './supabaseClient';

export interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  text: string; // декодировано из ciphertext (заглушка Фазы 1 — просто base64(plaintext))
  message_type: string;
  sent_at: string;
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

export async function sendMessage(chatId: string, text: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const senderId = sessionData.session?.user.id;
  if (!senderId) throw new Error('Нужно войти в аккаунт');

  const { error } = await supabase.from('messages').insert({
    chat_id: chatId,
    sender_id: senderId,
    ciphertext: encodeText(text),
    message_type: 'text',
  });
  if (error) throw error;
}

export async function getMessages(chatId: string, limit = 100): Promise<Message[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('messages')
    .select('id, chat_id, sender_id, ciphertext, message_type, sent_at')
    .eq('chat_id', chatId)
    .order('sent_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    chat_id: row.chat_id,
    sender_id: row.sender_id,
    text: decodeText(row.ciphertext),
    message_type: row.message_type,
    sent_at: row.sent_at,
  }));
}

/** Подписка на новые сообщения в чате через Supabase Realtime. Возвращает функцию отписки. */
export function subscribeToMessages(chatId: string, onMessage: (message: Message) => void): () => void {
  const supabase = getSupabaseClient();
  const channel = supabase
    .channel(`messages:${chatId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
      (payload) => {
        const row = payload.new as any;
        onMessage({
          id: row.id,
          chat_id: row.chat_id,
          sender_id: row.sender_id,
          text: decodeText(row.ciphertext),
          message_type: row.message_type,
          sent_at: row.sent_at,
        });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
