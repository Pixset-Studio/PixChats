import { getSupabaseClient } from './supabaseClient';

/** Отметить чат прочитанным (вызывается при открытии окна чата). */
export async function markChatAsRead(userId: string, chatId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('chat_read_state')
    .upsert({ user_id: userId, chat_id: chatId, last_read_at: new Date().toISOString() });
  if (error) throw error;
}

/** Количество непрочитанных (чужих) сообщений по каждому чату из списка. */
export async function getUnreadCounts(chatIds: string[], userId: string): Promise<Record<string, number>> {
  if (chatIds.length === 0) return {};
  const supabase = getSupabaseClient();

  const { data: readStates } = await supabase
    .from('chat_read_state')
    .select('chat_id, last_read_at')
    .eq('user_id', userId)
    .in('chat_id', chatIds);

  const lastReadByChat: Record<string, string> = {};
  for (const row of readStates ?? []) lastReadByChat[row.chat_id] = row.last_read_at;

  const result: Record<string, number> = {};
  await Promise.all(
    chatIds.map(async (chatId) => {
      const since = lastReadByChat[chatId] ?? '1970-01-01T00:00:00Z';
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('chat_id', chatId)
        .neq('sender_id', userId)
        .gt('sent_at', since);
      result[chatId] = count ?? 0;
    })
  );
  return result;
}

export interface MuteState {
  muted: boolean;
  mutedForever: boolean;
  mutedUntil: string | null;
}

export async function getMuteStates(chatIds: string[], userId: string): Promise<Record<string, MuteState>> {
  if (chatIds.length === 0) return {};
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('chat_mutes')
    .select('chat_id, muted_forever, muted_until')
    .eq('user_id', userId)
    .in('chat_id', chatIds);

  const result: Record<string, MuteState> = {};
  for (const row of data ?? []) {
    const stillMuted = row.muted_forever || (row.muted_until && new Date(row.muted_until) > new Date());
    result[row.chat_id] = { muted: !!stillMuted, mutedForever: row.muted_forever, mutedUntil: row.muted_until };
  }
  return result;
}

/** Отключить уведомления от чата навсегда или на срок (durationHours). */
export async function muteChat(userId: string, chatId: string, durationHours?: number): Promise<void> {
  const supabase = getSupabaseClient();
  const mutedUntil = durationHours ? new Date(Date.now() + durationHours * 3600000).toISOString() : null;
  const { error } = await supabase
    .from('chat_mutes')
    .upsert({ user_id: userId, chat_id: chatId, muted_forever: !durationHours, muted_until: mutedUntil });
  if (error) throw error;
}

export async function unmuteChat(userId: string, chatId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('chat_mutes').delete().eq('user_id', userId).eq('chat_id', chatId);
  if (error) throw error;
}
