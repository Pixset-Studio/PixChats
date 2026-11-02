import { getSupabaseClient } from './supabaseClient';
import { isMessageDeletedForMe } from './messages';

const LOCAL_READ_STATE_KEY = 'pixchats:local_read_state_v2';

function getLocalReadStateMap(userId: string): Record<string, string> {
  if (typeof window === 'undefined' || !userId) return {};
  try {
    const raw = localStorage.getItem(`${LOCAL_READ_STATE_KEY}:${userId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setLocalReadState(userId: string, chatId: string, isoTimestamp: string): void {
  if (typeof window === 'undefined' || !userId || !chatId) return;
  try {
    const map = getLocalReadStateMap(userId);
    const prev = map[chatId];
    if (!prev || new Date(isoTimestamp).getTime() >= new Date(prev).getTime()) {
      map[chatId] = isoTimestamp;
      localStorage.setItem(`${LOCAL_READ_STATE_KEY}:${userId}`, JSON.stringify(map));
    }
  } catch {}
}

/**
 * Отметить чат прочитанным (вызывается при открытии окна чата и при получении сообщения в открытом чате).
 * Мгновенно сбрасывает счётчик непрочитанных локально и синхронизирует chat_read_state с учётом возможного рассинхрона часов клиента и сервера.
 */
export async function markChatAsRead(userId: string, chatId: string, latestMessageSentAt?: string): Promise<void> {
  if (!userId || !chatId) return;

  const nowMs = Date.now();
  const hintMs = latestMessageSentAt ? new Date(latestMessageSentAt).getTime() : 0;
  // +2000 мс защищает от микросекундного округления PostgreSQL timestamptz и небольшого отставания часов устройства
  const initialIso = new Date(Math.max(nowMs, hintMs) + 2000).toISOString();

  setLocalReadState(userId, chatId, initialIso);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('pixchats:chat_read', {
        detail: { chatId, userId, readAt: initialIso },
      })
    );
  }

  const supabase = getSupabaseClient();
  let finalIso = initialIso;

  try {
    if (!latestMessageSentAt) {
      const { data: latestRow } = await supabase
        .from('messages')
        .select('sent_at')
        .eq('chat_id', chatId)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestRow?.sent_at) {
        const dbLatestMs = new Date(latestRow.sent_at).getTime();
        finalIso = new Date(Math.max(Date.now(), dbLatestMs) + 2000).toISOString();
        setLocalReadState(userId, chatId, finalIso);
      }
    }
  } catch {}

  try {
    const { error } = await supabase
      .from('chat_read_state')
      .upsert(
        { user_id: userId, chat_id: chatId, last_read_at: finalIso },
        { onConflict: 'user_id,chat_id' }
      );
    if (error) {
      // Фолбэк на случай обратного порядка уникального ключа (chat_id, user_id) или политики UPDATE
      await supabase
        .from('chat_read_state')
        .upsert(
          { user_id: userId, chat_id: chatId, last_read_at: finalIso },
          { onConflict: 'chat_id,user_id' }
        );
    }
  } catch {}
}

/** Количество непрочитанных (чужих и неудалённых) сообщений по каждому чату из списка. */
export async function getUnreadCounts(chatIds: string[], userId: string): Promise<Record<string, number>> {
  if (chatIds.length === 0) return {};
  const supabase = getSupabaseClient();

  const { data: readStates } = await supabase
    .from('chat_read_state')
    .select('chat_id, last_read_at')
    .eq('user_id', userId)
    .in('chat_id', chatIds);

  const localMap = getLocalReadStateMap(userId);
  const lastReadByChat: Record<string, string> = {};

  for (const row of readStates ?? []) {
    if (row.last_read_at) {
      lastReadByChat[row.chat_id] = row.last_read_at;
    }
  }

  for (const [cId, localIso] of Object.entries(localMap)) {
    const dbIso = lastReadByChat[cId];
    if (!dbIso || new Date(localIso).getTime() > new Date(dbIso).getTime()) {
      lastReadByChat[cId] = localIso;
    }
  }

  const currentlyOpenChatId =
    typeof window !== 'undefined' && /\/chat(\/|$)/.test(window.location.pathname)
      ? new URLSearchParams(window.location.search).get('id')
      : null;

  const result: Record<string, number> = {};
  await Promise.all(
    chatIds.map(async (chatId) => {
      if (currentlyOpenChatId && String(currentlyOpenChatId) === String(chatId)) {
        result[chatId] = 0;
        return;
      }
      const since = lastReadByChat[chatId] ?? '1970-01-01T00:00:00Z';
      const { data: rows } = await supabase
        .from('messages')
        .select('id, sent_at, is_deleted')
        .eq('chat_id', chatId)
        .neq('sender_id', userId)
        .gt('sent_at', since)
        .limit(100);

      const unreadRows = (rows ?? []).filter(
        (r: any) => !r.is_deleted && !isMessageDeletedForMe(r.id)
      );
      result[chatId] = unreadRows.length;
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
    .select('*')
    .eq('user_id', userId)
    .in('chat_id', chatIds);

  const result: Record<string, MuteState> = {};
  for (const row of (data ?? []) as any[]) {
    // Пропускаем штрафные муты модерации, чтобы они не отображались как выключенные уведомления
    if (row.is_penalty || (row.reason && String(row.reason).trim().length > 0)) continue;
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
