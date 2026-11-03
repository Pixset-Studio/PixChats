import { getSupabaseClient } from './supabaseClient';
import { isMessageDeletedForMe } from './messages';

const LOCAL_READ_STATE_KEY = 'pixchats:local_read_state_v2';

// Кэш состояния прочитанности и счётчиков непрочитанных в памяти для снижения запросов к Supabase на >90%
const lastSyncedDbReadAtMap = new Map<string, number>();
let unreadCountsCache: {
  userId: string;
  key: string;
  fetchedAt: number;
  counts: Record<string, number>;
} | null = null;

// Кэш настроек мута уведомлений чатов (TTL 3 минуты)
let muteStatesCache: {
  userId: string;
  fetchedAt: number;
  byChatId: Record<string, MuteState>;
} | null = null;

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
 * Мгновенно сбрасывает счётчик непрочитанных локально и экономно синхронизирует chat_read_state с БД без лишних запросов.
 */
export async function markChatAsRead(userId: string, chatId: string, latestMessageSentAt?: string): Promise<void> {
  if (!userId || !chatId) return;

  const nowMs = Date.now();
  const hintMs = latestMessageSentAt ? new Date(latestMessageSentAt).getTime() : 0;
  // +2000 мс защищает от микросекундного округления PostgreSQL timestamptz и небольшого отставания часов устройства
  const targetMs = Math.max(nowMs, Number.isFinite(hintMs) ? hintMs : 0) + 2000;
  const initialIso = new Date(targetMs).toISOString();

  setLocalReadState(userId, chatId, initialIso);

  if (unreadCountsCache && unreadCountsCache.userId === userId) {
    unreadCountsCache.counts[chatId] = 0;
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('pixchats:chat_read', {
        detail: { chatId, userId, readAt: initialIso },
      })
    );
  }

  // Троттлинг записи в БД: если мы уже синхронизировали этот чат недавно (< 20 сек назад) и нет более нового сообщения, пропускаем запрос к Supabase
  const cacheKey = `${userId}:${chatId}`;
  const prevSyncedMs = lastSyncedDbReadAtMap.get(cacheKey) || 0;
  if (prevSyncedMs > 0 && nowMs - prevSyncedMs < 20_000 && (!hintMs || hintMs <= prevSyncedMs)) {
    return;
  }
  lastSyncedDbReadAtMap.set(cacheKey, targetMs);

  const supabase = getSupabaseClient();

  try {
    const { error } = await supabase
      .from('chat_read_state')
      .upsert(
        { user_id: userId, chat_id: chatId, last_read_at: initialIso },
        { onConflict: 'user_id,chat_id' }
      );
    if (error) {
      await supabase
        .from('chat_read_state')
        .upsert(
          { user_id: userId, chat_id: chatId, last_read_at: initialIso },
          { onConflict: 'chat_id,user_id' }
        );
    }
  } catch {}
}

/**
 * Количество непрочитанных (чужих и неудалённых) сообщений по каждому чату из списка.
 * Оптимизировано: вместо N отдельных запросов по каждому чату выполняет ОДИН пакетный запрос .in('chat_id', ...).
 */
export async function getUnreadCounts(chatIds: string[], userId: string): Promise<Record<string, number>> {
  if (chatIds.length === 0 || !userId) return {};

  const currentlyOpenChatId =
    typeof window !== 'undefined' && /\/chat(\/|$)/.test(window.location.pathname)
      ? new URLSearchParams(window.location.search).get('id')
      : null;

  const sortedKey = [...chatIds].sort().join(',');
  const now = Date.now();
  if (
    unreadCountsCache &&
    unreadCountsCache.userId === userId &&
    unreadCountsCache.key === sortedKey &&
    now - unreadCountsCache.fetchedAt < 25_000
  ) {
    const cachedCopy = { ...unreadCountsCache.counts };
    if (currentlyOpenChatId) cachedCopy[currentlyOpenChatId] = 0;
    return cachedCopy;
  }

  const supabase = getSupabaseClient();

  const { data: readStates } = await supabase
    .from('chat_read_state')
    .select('chat_id, last_read_at')
    .eq('user_id', userId)
    .in('chat_id', chatIds);

  const localMap = getLocalReadStateMap(userId);
  const lastReadByChat: Record<string, number> = {};

  for (const row of readStates ?? []) {
    if (row.last_read_at) {
      const ms = new Date(row.last_read_at).getTime();
      if (Number.isFinite(ms)) lastReadByChat[row.chat_id] = ms;
    }
  }

  for (const [cId, localIso] of Object.entries(localMap)) {
    const localMs = new Date(localIso).getTime();
    const dbMs = lastReadByChat[cId] || 0;
    if (Number.isFinite(localMs) && localMs > dbMs) {
      lastReadByChat[cId] = localMs;
    }
  }

  const result: Record<string, number> = {};
  for (const id of chatIds) {
    result[id] = 0;
  }

  const targetChatIds = chatIds.filter(
    (id) => !currentlyOpenChatId || String(currentlyOpenChatId) !== String(id)
  );

  if (targetChatIds.length > 0) {
    // Вычисляем минимальную границу времени (не старше 14 дней для экономии трафика)
    const fourteenDaysAgoMs = now - 14 * 24 * 60 * 60 * 1000;
    let minReadMs = now;
    for (const id of targetChatIds) {
      const readMs = lastReadByChat[id] ?? fourteenDaysAgoMs;
      if (readMs < minReadMs) minReadMs = readMs;
    }
    const minSinceIso = new Date(Math.max(fourteenDaysAgoMs, minReadMs)).toISOString();

    const { data: rows } = await supabase
      .from('messages')
      .select('id, chat_id, sent_at, is_deleted')
      .in('chat_id', targetChatIds)
      .neq('sender_id', userId)
      .gt('sent_at', minSinceIso)
      .order('sent_at', { ascending: false })
      .limit(Math.min(250, targetChatIds.length * 25));

    for (const r of (rows ?? []) as any[]) {
      if (r.is_deleted || isMessageDeletedForMe(r.id)) continue;
      const msgMs = new Date(r.sent_at).getTime();
      const chatLastReadMs = lastReadByChat[r.chat_id] ?? 0;
      if (msgMs > chatLastReadMs) {
        result[r.chat_id] = (result[r.chat_id] ?? 0) + 1;
      }
    }
  }

  unreadCountsCache = {
    userId,
    key: sortedKey,
    fetchedAt: Date.now(),
    counts: { ...result },
  };

  return result;
}

export interface MuteState {
  muted: boolean;
  mutedForever: boolean;
  mutedUntil: string | null;
}

export async function getMuteStates(chatIds: string[], userId: string): Promise<Record<string, MuteState>> {
  if (chatIds.length === 0 || !userId) return {};

  const now = Date.now();
  if (
    muteStatesCache &&
    muteStatesCache.userId === userId &&
    now - muteStatesCache.fetchedAt < 180_000
  ) {
    const out: Record<string, MuteState> = {};
    for (const cid of chatIds) {
      if (muteStatesCache.byChatId[cid]) {
        out[cid] = muteStatesCache.byChatId[cid];
      }
    }
    return out;
  }

  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('chat_mutes')
    .select('chat_id, muted_forever, muted_until, is_penalty, reason')
    .eq('user_id', userId);

  const byChatId: Record<string, MuteState> = {};
  for (const row of (data ?? []) as any[]) {
    // Пропускаем штрафные муты модерации, чтобы они не отображались как выключенные уведомления
    if (row.is_penalty || (row.reason && String(row.reason).trim().length > 0)) continue;
    const stillMuted = row.muted_forever || (row.muted_until && new Date(row.muted_until) > new Date());
    byChatId[row.chat_id] = { muted: !!stillMuted, mutedForever: row.muted_forever, mutedUntil: row.muted_until };
  }

  muteStatesCache = {
    userId,
    fetchedAt: now,
    byChatId,
  };

  const result: Record<string, MuteState> = {};
  for (const cid of chatIds) {
    if (byChatId[cid]) result[cid] = byChatId[cid];
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
  if (muteStatesCache && muteStatesCache.userId === userId) {
    muteStatesCache.byChatId[chatId] = {
      muted: true,
      mutedForever: !durationHours,
      mutedUntil,
    };
  }
}

export async function unmuteChat(userId: string, chatId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('chat_mutes').delete().eq('user_id', userId).eq('chat_id', chatId);
  if (error) throw error;
  if (muteStatesCache && muteStatesCache.userId === userId) {
    delete muteStatesCache.byChatId[chatId];
  }
}
