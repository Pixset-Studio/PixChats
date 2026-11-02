import { getSupabaseClient } from './supabaseClient';
import type {
  Chat,
  Profile,
  UserRole,
  ChatMute,
  BannedIp,
  AppealItem,
  AppealPenaltyType,
  AppealStatus,
  PenaltyDurationUnit,
  CustomRoleDefinition,
} from './types';

export interface AdminStatsOverview {
  total_users: number;
  dau: number;
  mau: number;
  total_direct_chats: number;
  total_groups: number;
  total_channels: number;
  total_messages: number;
  messages_today: number;
  total_calls: number;
  calls_today: number;
}

export type AdminUserFilter =
  | 'all'
  | 'developer'
  | 'admin'
  | 'moderator'
  | 'partner'
  | 'verified'
  | 'employee'
  | 'frozen'
  | 'banned';

export interface AdminAuditLogRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  details: Record<string, any> | null;
  created_at: string;
}

const PENALTY_CLOUD_BUCKET = 'avatars';
const APPEALS_CLOUD_PATH = 'moderation/appeals_v1.json';
const MUTES_CLOUD_PATH = 'moderation/penalty_mutes_v1.json';
const PENALTY_META_CLOUD_PATH = 'moderation/user_penalties_v1.json';
const CUSTOM_ROLES_CLOUD_PATH = 'moderation/custom_roles_v1.json';

export interface UserPenaltyDetails {
  banReason: string | null;
  frozenReason: string | null;
  frozenAt?: string | null;
  moderatorComment: string | null;
  updatedAt?: string;
}

export interface CustomRolesCloudManifest {
  roles: CustomRoleDefinition[];
  assignments: Record<string, string[]>; // userId или @username -> массив role.id
  updatedAt: string;
}

const CUSTOM_ROLES_LOCAL_KEY = 'pixchats:custom_roles_manifest_v1';
const cloudJsonMemCache = new Map<string, { data: any; ts: number }>();
const CLOUD_JSON_TTL_MS = 20_000;

/**
 * Вычисляет точную дату окончания наказания (ISO-строку) на основе:
 * - флага permanent ("Навсегда" -> null)
 * - точной даты/времени untilDate (ISO или datetime-local)
 * - числового значения durationValue + единицы измерения durationUnit (seconds | minutes | hours | days | months | years)
 * - классического durationDays
 */
export function computePenaltyExpirationIso(
  params: {
    permanent?: boolean;
    untilDate?: string | null;
    durationValue?: number;
    durationUnit?: PenaltyDurationUnit;
    durationDays?: number;
  },
  nowMs: number = Date.now()
): string | null {
  if (params.permanent) return null;

  if (params.untilDate && params.untilDate.trim()) {
    const parsedMs = new Date(params.untilDate.trim()).getTime();
    if (!Number.isFinite(parsedMs) || parsedMs <= nowMs) {
      throw new Error('Дата окончания блокировки должна быть в будущем');
    }
    return new Date(parsedMs).toISOString();
  }

  if (params.durationValue !== undefined && params.durationValue !== null) {
    const val = Number(params.durationValue);
    if (!Number.isFinite(val) || val <= 0) {
      throw new Error('Укажите положительную длительность наказания');
    }
    const unit: PenaltyDurationUnit = params.durationUnit || 'days';
    const d = new Date(nowMs);
    switch (unit) {
      case 'seconds':
        return new Date(nowMs + val * 1000).toISOString();
      case 'minutes':
        return new Date(nowMs + val * 60 * 1000).toISOString();
      case 'hours':
        return new Date(nowMs + val * 3600 * 1000).toISOString();
      case 'days':
        return new Date(nowMs + val * 86400 * 1000).toISOString();
      case 'months': {
        const wholeMonths = Math.floor(val);
        const fracDays = (val - wholeMonths) * 30;
        d.setMonth(d.getMonth() + wholeMonths);
        return new Date(d.getTime() + fracDays * 86400 * 1000).toISOString();
      }
      case 'years': {
        const wholeYears = Math.floor(val);
        const fracDays = (val - wholeYears) * 365;
        d.setFullYear(d.getFullYear() + wholeYears);
        return new Date(d.getTime() + fracDays * 86400 * 1000).toISOString();
      }
    }
  }

  if (params.durationDays !== undefined && params.durationDays !== null) {
    const days = Number(params.durationDays);
    if (Number.isFinite(days) && days > 0) {
      return new Date(nowMs + days * 86400 * 1000).toISOString();
    }
  }

  return null;
}

async function readCloudJson<T>(path: string, fallback: T): Promise<T> {
  const cached = cloudJsonMemCache.get(path);
  if (cached && Date.now() - cached.ts < CLOUD_JSON_TTL_MS) {
    return cached.data as T;
  }
  try {
    const supabase = getSupabaseClient();
    const { data } = supabase.storage.from(PENALTY_CLOUD_BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) return fallback;
    const res = await fetch(`${data.publicUrl}?v=${Math.floor(Date.now() / 30000)}`);
    if (!res.ok) {
      cloudJsonMemCache.set(path, { data: fallback, ts: Date.now() });
      return fallback;
    }
    const parsed = await res.json();
    const result = (parsed ?? fallback) as T;
    cloudJsonMemCache.set(path, { data: result, ts: Date.now() });
    return result;
  } catch {
    return fallback;
  }
}

async function writeCloudJson<T>(path: string, value: T): Promise<void> {
  cloudJsonMemCache.set(path, { data: value, ts: Date.now() });
  try {
    const supabase = getSupabaseClient();
    const blob = new Blob([JSON.stringify(value)], { type: 'application/json' });
    await supabase.storage.from(PENALTY_CLOUD_BUCKET).upload(path, blob, {
      upsert: true,
      contentType: 'application/json',
      cacheControl: '30',
    });
  } catch {
    // ignore storage fallback errors
  }
}

export async function saveUserPenaltyMetaToCloud(
  userId: string,
  patch: Partial<UserPenaltyDetails>
): Promise<void> {
  try {
    const current = await readCloudJson<Record<string, UserPenaltyDetails>>(PENALTY_META_CLOUD_PATH, {});
    const existing = current[userId] || {
      banReason: null,
      frozenReason: null,
      moderatorComment: null,
    };
    current[userId] = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await writeCloudJson(PENALTY_META_CLOUD_PATH, current);
  } catch {}
}

/**
 * Возвращает причину бана/заморозки и комментарий модератора для показа пользователю.
 * Проверяет поля профиля, облачный манифест модерации и журнал admin_audit_log.
 */
export async function getUserPenaltyDetails(
  userId: string,
  profile?: Profile | null
): Promise<UserPenaltyDetails> {
  let banReason = profile?.ban_reason || null;
  let frozenReason = profile?.frozen_reason || null;
  let moderatorComment = profile?.moderator_comment || null;

  if (banReason && frozenReason && moderatorComment) {
    return { banReason, frozenReason, moderatorComment };
  }

  try {
    const cloudMap = await readCloudJson<Record<string, UserPenaltyDetails>>(PENALTY_META_CLOUD_PATH, {});
    const cloudEntry = cloudMap[userId];
    if (cloudEntry) {
      if (!banReason && cloudEntry.banReason) banReason = cloudEntry.banReason;
      if (!frozenReason && cloudEntry.frozenReason) frozenReason = cloudEntry.frozenReason;
      if (!moderatorComment && cloudEntry.moderatorComment) moderatorComment = cloudEntry.moderatorComment;
    }
  } catch {}

  try {
    const supabase = getSupabaseClient();
    const { data: logs } = await supabase
      .from('admin_audit_log')
      .select('action, details, created_at')
      .eq('target_id', userId)
      .in('action', ['ban_account', 'freeze_account'])
      .order('created_at', { ascending: false })
      .limit(5);

    for (const row of logs ?? []) {
      const det = (row.details || {}) as Record<string, any>;
      if (row.action === 'ban_account' && !banReason && det.reason) {
        banReason = String(det.reason);
      }
      if (row.action === 'freeze_account' && !frozenReason && det.reason) {
        frozenReason = String(det.reason);
      }
      if (!moderatorComment && det.moderatorComment) {
        moderatorComment = String(det.moderatorComment);
      }
    }
  } catch {}

  return { banReason, frozenReason, moderatorComment };
}

export async function getAdminStats(): Promise<AdminStatsOverview> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('get_admin_stats_overview');
  if (error) throw error;
  return data as AdminStatsOverview;
}

export interface SystemStatusRow {
  id: string;
  service: string;
  status: 'operational' | 'degraded' | 'down';
  latency_ms: number | null;
  checked_at: string;
}

/** Ручная самопроверка: если запрос к БД прошёл — Supabase точно доступен. */
export async function checkSystemStatusNow(): Promise<void> {
  const supabase = getSupabaseClient();
  const start = performance.now();
  await supabase.from('profiles').select('id').limit(1);
  const latency = Math.round(performance.now() - start);
  const { error } = await supabase.rpc('record_self_status_check', { p_latency_ms: latency });
  if (error) throw error;
}

export async function getSystemStatus(): Promise<SystemStatusRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('system_status_checks')
    .select('*')
    .order('checked_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as SystemStatusRow[];
}

export interface ErrorLogRow {
  id: string;
  source: 'web' | 'desktop' | 'mobile';
  user_id: string | null;
  message: string;
  created_at: string;
}

export async function getErrorLogs(limit = 50): Promise<ErrorLogRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('app_error_logs')
    .select('id, source, user_id, message, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ErrorLogRow[];
}

export async function searchProfilesByUsername(query: string): Promise<Profile[]> {
  const supabase = getSupabaseClient();
  const clean = query.trim().replace(/^@/, '');
  if (!clean) {
    return listProfilesForAdmin({ filter: 'all', limit: 30 });
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .or(`username.ilike.%${clean}%,display_name.ilike.%${clean}%`)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function listProfilesForAdmin(options?: {
  filter?: AdminUserFilter;
  query?: string;
  limit?: number;
}): Promise<Profile[]> {
  const supabase = getSupabaseClient();
  const filter = options?.filter ?? 'all';
  const cleanQuery = (options?.query ?? '').trim().replace(/^@/, '');
  const limit = options?.limit ?? 40;

  let req = supabase.from('profiles').select('*');

  if (cleanQuery) {
    req = req.or(`username.ilike.%${cleanQuery}%,display_name.ilike.%${cleanQuery}%`);
  }

  if (filter === 'developer' || filter === 'admin' || filter === 'moderator' || filter === 'partner') {
    req = req.eq('role', filter);
  } else if (filter === 'verified') {
    req = req.eq('is_verified', true);
  } else if (filter === 'employee') {
    req = req.eq('is_pixset_employee', true);
  } else if (filter === 'frozen') {
    req = req.eq('frozen', true);
  } else if (filter === 'banned') {
    req = req.or(`banned_permanently.eq.true,banned_until.gt.${new Date().toISOString()}`);
  }

  const { data, error } = await req.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function listGroupAndChannelChatsForAdmin(query = '', limit = 40): Promise<Chat[]> {
  const supabase = getSupabaseClient();
  const clean = query.trim().replace(/^@/, '');
  let req = supabase
    .from('chats')
    .select('*')
    .in('type', ['group', 'channel']);

  if (clean) {
    req = req.or(`title.ilike.%${clean}%,username.ilike.%${clean}%`);
  }

  const { data, error } = await req.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as Chat[];
}

export async function getAuditLogsForAdmin(limit = 40): Promise<AdminAuditLogRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('admin_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as AdminAuditLogRow[];
}

async function logAdminAction(action: string, targetType: string, targetId: string, details?: object) {
  try {
    const supabase = getSupabaseClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const actorId = sessionData.session?.user.id;
    await supabase.from('admin_audit_log').insert({
      actor_id: actorId,
      action,
      target_type: targetType,
      target_id: targetId,
      details: details ?? {},
    });
  } catch {}
}

/**
 * Назначение роли. Только 'developer' может назначать 'admin'/'moderator'.
 */
export async function setUserRole(targetUserId: string, role: UserRole, actingProfile: Profile) {
  if (actingProfile.role !== 'developer') {
    throw new Error('Только разработчик может назначать роли admin/moderator');
  }
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('profiles').update({ role }).eq('id', targetUserId);
  if (error) throw error;
  await logAdminAction('assign_role', 'user', targetUserId, { role });
}

/** Выдача/снятие галочки верификации пользователю. Доступно admin и developer. */
export async function setUserVerification(targetUserId: string, verified: boolean, actingProfile: Profile) {
  if (actingProfile.role !== 'admin' && actingProfile.role !== 'developer') {
    throw new Error('Недостаточно прав для выдачи верификации');
  }
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('profiles')
    .update({ is_verified: verified, verified_at: verified ? new Date().toISOString() : null })
    .eq('id', targetUserId);
  if (error) throw error;
  await logAdminAction(verified ? 'grant_verification' : 'revoke_verification', 'user', targetUserId);
}

/** Выдача/снятие бейджа "Сотрудник Pixset Studio" — независимая пометка, не влияет на role. */
export async function setPixsetEmployeeBadge(targetUserId: string, value: boolean, actingProfile: Profile) {
  if (actingProfile.role !== 'admin' && actingProfile.role !== 'developer') {
    throw new Error('Недостаточно прав');
  }
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('profiles').update({ is_pixset_employee: value }).eq('id', targetUserId);
  if (error) throw error;
  await logAdminAction(value ? 'grant_pixset_employee' : 'revoke_pixset_employee', 'user', targetUserId);
}

export interface BanAccountParams {
  durationDays?: number;
  durationValue?: number;
  durationUnit?: PenaltyDurationUnit;
  untilDate?: string | null;
  permanent?: boolean;
  reason?: string;
  moderatorComment?: string;
}

/**
 * Бан аккаунта — с гибким сроком (секунды, минуты, часы, дни, месяцы, годы),
 * точной датой/временем окончания или навсегда, с сохранением причины и комментария модератора.
 */
export async function banAccount(targetUserId: string, params: BanAccountParams, actingProfile: Profile) {
  if (actingProfile.role !== 'admin' && actingProfile.role !== 'developer' && actingProfile.role !== 'moderator') {
    throw new Error('Недостаточно прав');
  }
  const supabase = getSupabaseClient();
  const bannedUntil = computePenaltyExpirationIso(params);
  const isPermanent = Boolean(params.permanent || (!bannedUntil && !params.durationDays && !params.durationValue && !params.untilDate));
  const cleanReason = params.reason?.trim() || 'Нарушение правил PixChats';
  const cleanComment = params.moderatorComment?.trim() || null;

  const fullPatch: Record<string, any> = {
    banned_permanently: isPermanent,
    banned_until: isPermanent ? null : bannedUntil,
    ban_reason: cleanReason,
    moderator_comment: cleanComment,
  };

  const { error } = await supabase
    .from('profiles')
    .update(fullPatch)
    .eq('id', targetUserId);

  if (error) {
    // Фолбэк, если миграция 0030 ещё не применена к таблице profiles
    const { error: fallbackErr } = await supabase
      .from('profiles')
      .update({
        banned_permanently: isPermanent,
        banned_until: isPermanent ? null : bannedUntil,
      })
      .eq('id', targetUserId);
    if (fallbackErr) throw fallbackErr;
  }

  await saveUserPenaltyMetaToCloud(targetUserId, {
    banReason: cleanReason,
    moderatorComment: cleanComment,
  });

  await logAdminAction('ban_account', 'user', targetUserId, {
    ...params,
    bannedUntil,
    reason: cleanReason,
    moderatorComment: cleanComment,
  });
}

export async function unbanAccount(targetUserId: string, actingProfile: Profile) {
  if (actingProfile.role !== 'admin' && actingProfile.role !== 'developer' && actingProfile.role !== 'moderator') {
    throw new Error('Недостаточно прав');
  }
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('profiles')
    .update({
      banned_permanently: false,
      banned_until: null,
      ban_reason: null,
      moderator_comment: null,
    } as any)
    .eq('id', targetUserId);

  if (error) {
    const { error: fallbackErr } = await supabase
      .from('profiles')
      .update({ banned_permanently: false, banned_until: null })
      .eq('id', targetUserId);
    if (fallbackErr) throw fallbackErr;
  }

  await saveUserPenaltyMetaToCloud(targetUserId, {
    banReason: null,
    moderatorComment: null,
  });
  await logAdminAction('unban_account', 'user', targetUserId);
}

/** Заморозка — аккаунт может читать, но не может писать сообщения (с сохранением причины и комментария). */
export async function setAccountFrozen(
  targetUserId: string,
  frozen: boolean,
  actingProfile: Profile,
  reason?: string,
  moderatorComment?: string
) {
  if (actingProfile.role !== 'admin' && actingProfile.role !== 'developer' && actingProfile.role !== 'moderator') {
    throw new Error('Недостаточно прав');
  }
  const supabase = getSupabaseClient();
  const cleanReason = frozen ? (reason?.trim() || 'Заморожен модерацией для проверки') : null;
  const cleanComment = frozen ? (moderatorComment?.trim() || null) : null;
  const nowIso = frozen ? new Date().toISOString() : null;

  const { error } = await supabase
    .from('profiles')
    .update({
      frozen,
      frozen_at: nowIso,
      frozen_reason: cleanReason,
      moderator_comment: cleanComment,
    } as any)
    .eq('id', targetUserId);

  if (error) {
    // Фолбэк для БД без колонок frozen_at / frozen_reason / moderator_comment (миграции 0029 / 0030)
    const { error: fallbackErr } = await supabase
      .from('profiles')
      .update({
        frozen,
      } as any)
      .eq('id', targetUserId);
    if (fallbackErr) throw fallbackErr;
  }

  await saveUserPenaltyMetaToCloud(targetUserId, {
    frozenReason: cleanReason,
    frozenAt: nowIso,
    moderatorComment: cleanComment,
  });

  await logAdminAction(frozen ? 'freeze_account' : 'unfreeze_account', 'user', targetUserId, {
    reason: cleanReason,
    moderatorComment: cleanComment,
  });
}

/** Безопасная автозаморозка аккаунта при автомодерации или жалобах (работает даже без колонки frozen_at в БД) */
export async function autoFreezeUserAccount(targetUserId: string, freezeReason: string): Promise<void> {
  const supabase = getSupabaseClient();
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from('profiles')
    .update({
      frozen: true,
      frozen_at: nowIso,
      frozen_reason: freezeReason,
    } as any)
    .eq('id', targetUserId);

  if (error) {
    await supabase
      .from('profiles')
      .update({ frozen: true } as any)
      .eq('id', targetUserId);
  }

  await saveUserPenaltyMetaToCloud(targetUserId, {
    frozenReason: freezeReason,
    frozenAt: nowIso,
  });
}

/** Автоматическая очистка замороженных аккаунтов, если заморозка не снята в течение 90 дней */
export async function cleanupExpiredFrozenAccounts(): Promise<number> {
  const supabase = getSupabaseClient();
  const ninetyDaysAgoMs = Date.now() - 90 * 24 * 60 * 60 * 1000;

  const { data: frozenUsers, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('frozen', true);

  if (error || !frozenUsers || frozenUsers.length === 0) return 0;

  let cloudMeta: Record<string, UserPenaltyDetails> = {};
  try {
    cloudMeta = await readCloudJson<Record<string, UserPenaltyDetails>>(PENALTY_META_CLOUD_PATH, {});
  } catch {}

  let count = 0;
  for (const user of frozenUsers as any[]) {
    const frozenIso = user.frozen_at || cloudMeta[user.id]?.frozenAt || cloudMeta[user.id]?.updatedAt;
    if (!frozenIso) continue;
    const frozenMs = new Date(frozenIso).getTime();
    if (Number.isFinite(frozenMs) && frozenMs < ninetyDaysAgoMs) {
      try {
        await supabase.from('profiles').delete().eq('id', user.id);
        count++;
      } catch {}
    }
  }
  return count;
}

/**
 * Полное удаление аккаунта через Edge Function admin-delete-user.
 */
export async function deleteAccount(targetUserId: string, actingProfile: Profile) {
  if (actingProfile.role !== 'admin' && actingProfile.role !== 'developer') {
    throw new Error('Недостаточно прав');
  }
  const supabase = getSupabaseClient();
  const { error } = await supabase.functions.invoke('admin-delete-user', {
    body: { targetUserId },
  });
  if (error) throw error;
  await logAdminAction('delete_account', 'user', targetUserId);
}

export async function banUsername(username: string, actingProfile: Profile) {
  if (actingProfile.role !== 'admin' && actingProfile.role !== 'developer') {
    throw new Error('Недостаточно прав');
  }
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('banned_usernames')
    .insert({ username: username.toLowerCase(), banned_by: actingProfile.id });
  if (error) throw error;
}

export async function unbanUsername(username: string) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('banned_usernames').delete().eq('username', username.toLowerCase());
  if (error) throw error;
}

export async function listBannedUsernames(): Promise<string[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('banned_usernames')
    .select('username')
    .order('banned_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => r.username);
}

export async function setChatVerification(chatId: string, verified: boolean, actingProfile: Profile) {
  if (actingProfile.role !== 'admin' && actingProfile.role !== 'developer') {
    throw new Error('Недостаточно прав для выдачи верификации');
  }
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('chats')
    .update({ is_verified: verified, verified_at: verified ? new Date().toISOString() : null } as any)
    .eq('id', chatId);
  if (error) {
    const { error: fallbackErr } = await supabase
      .from('chats')
      .update({ is_verified: verified })
      .eq('id', chatId);
    if (fallbackErr) throw fallbackErr;
  }
  await logAdminAction(verified ? 'grant_verification' : 'revoke_verification', 'chat', chatId);
}

export interface MessageReport {
  id: string;
  message_id: string;
  reporter_id: string;
  reported_user_id: string;
  chat_id: string | null;
  reason: string;
  details: string | null;
  created_at: string;
  reporter_name?: string;
  reported_user_name?: string;
  reported_username?: string;
  message_text?: string;
  chat_title?: string;
  reported_user?: Profile;
  reporter?: Profile;
}

/** Отправляет сигнал-уведомление администраторам и разработчикам о заморозке аккаунта */
export async function notifyAdminsAboutFreeze(reportedUserId: string, reasonText: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { data: user } = await supabase
      .from('profiles')
      .select('display_name, username')
      .eq('id', reportedUserId)
      .maybeSingle();

    const userName = user?.display_name || user?.username || reportedUserId;

    const broadcastCh = supabase.channel('pixchats-admin-alerts');
    broadcastCh.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void broadcastCh.send({
          type: 'broadcast',
          event: 'account-frozen-alert',
          payload: {
            reportedUserId,
            userName,
            reason: reasonText,
            timestamp: new Date().toISOString(),
          },
        }).finally(() => {
          setTimeout(() => {
            try {
              void supabase.removeChannel(broadcastCh);
            } catch {}
          }, 1500);
        });
      }
    });
  } catch {}
}

/**
 * Подать жалобу на сообщение.
 * Если на пользователя набирается >= 3 жалоб от РАЗНЫХ людей, аккаунт автоматически замораживается (`frozen = true`),
 * а админам приходит уведомление.
 */
export async function reportMessage(params: {
  messageId: string;
  reportedUserId: string;
  chatId?: string;
  reason: string;
  details?: string;
}): Promise<{ autoFrozen: boolean }> {
  const supabase = getSupabaseClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const reporterId = sessionData.session?.user.id;
  if (!reporterId) throw new Error('Нужно войти в аккаунт');

  if (reporterId === params.reportedUserId) {
    throw new Error('Нельзя пожаловаться на своё собственное сообщение');
  }

  const { error } = await supabase.from('message_reports').insert({
    message_id: params.messageId,
    reporter_id: reporterId,
    reported_user_id: params.reportedUserId,
    chat_id: params.chatId || null,
    reason: params.reason,
    details: params.details || null,
  });

  if (error && !error.message.includes('unique')) {
    throw error;
  }

  const { data: reports } = await supabase
    .from('message_reports')
    .select('reporter_id')
    .eq('reported_user_id', params.reportedUserId);

  const uniqueReporters = new Set((reports || []).map((r) => r.reporter_id));
  let autoFrozen = false;

  if (uniqueReporters.size >= 3) {
    autoFrozen = true;
    const freezeReason = `Накоплено ${uniqueReporters.size} жалоб от разных пользователей (последняя: ${params.reason})`;
    await autoFreezeUserAccount(params.reportedUserId, freezeReason);
    await notifyAdminsAboutFreeze(params.reportedUserId, freezeReason);
  }

  return { autoFrozen };
}

/** Получение всех жалоб для раздела модерации в панели администратора */
export async function getMessageReportsForAdmin(): Promise<MessageReport[]> {
  const supabase = getSupabaseClient();
  const { data: reports, error } = await supabase
    .from('message_reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return [];
  if (!reports || reports.length === 0) return [];

  const userIds = Array.from(
    new Set([
      ...reports.map((r) => r.reporter_id),
      ...reports.map((r) => r.reported_user_id),
    ])
  );
  const msgIds = Array.from(new Set(reports.map((r) => r.message_id)));
  const chatIds = Array.from(new Set(reports.map((r) => r.chat_id).filter(Boolean))) as string[];

  const [{ data: profiles }, { data: messages }, { data: chats }] = await Promise.all([
    supabase.from('profiles').select('*').in('id', userIds),
    supabase.from('messages').select('id, ciphertext, text').in('id', msgIds),
    chatIds.length > 0 ? supabase.from('chats').select('id, title').in('id', chatIds) : Promise.resolve({ data: [] }),
  ]);

  const profileMap = new Map((profiles || []).map((p) => [p.id, p as Profile]));
  const msgMap = new Map((messages || []).map((m) => [m.id, m.text || m.ciphertext || '']));
  const chatMap = new Map((chats || []).map((c) => [c.id, c.title || 'Чат']));

  return reports.map((r) => {
    const reporter = profileMap.get(r.reporter_id);
    const reported = profileMap.get(r.reported_user_id);
    return {
      ...r,
      reporter,
      reported_user: reported,
      reporter_name: reporter?.display_name || reporter?.username || r.reporter_id,
      reported_user_name: reported?.display_name || reported?.username || r.reported_user_id,
      reported_username: reported?.username || 'user',
      message_text: msgMap.get(r.message_id) || 'Текст сообщения',
      chat_title: r.chat_id ? chatMap.get(r.chat_id) || 'Чат' : 'Чат',
    };
  });
}

/** Проверяет текст сообщения на автомодерацию (тяжёлое или лёгкое нарушение) */
export function checkAutoModerationViolation(text: string): { violated: boolean; severity?: 'light' | 'heavy'; reason?: string } {
  if (!text || typeof text !== 'string') return { violated: false };

  const heavyRegex = /(терракт|терроризм|наркотик|наркота|гидра|мефедрон|амфетамин|продам паспорт|купить слив|взлом аккаунт|взрывчатка|оружие сбыт|кардинг)/i;
  const lightRegex = /(казино 1000|заработок без вложений|подпишись на канал|купи курс|переходи по ссылке t\.me)/i;

  if (heavyRegex.test(text)) {
    const match = text.match(heavyRegex);
    return {
      violated: true,
      severity: 'heavy',
      reason: `Запрещённая вредоносная фраза: "${match?.[0] || 'закон'}"`,
    };
  }

  if (lightRegex.test(text)) {
    const match = text.match(lightRegex);
    return {
      violated: true,
      severity: 'light',
      reason: `Спам или сомнительная реклама: "${match?.[0] || 'спам'}"`,
    };
  }

  return { violated: false };
}

/* ============================================================================
 * МУТЫ (Ограничения отправки сообщений в конкретном чате за нарушения)
 * ============================================================================ */

export async function muteUserInChat(params: {
  userId: string;
  chatId: string;
  durationHours?: number;
  durationValue?: number;
  durationUnit?: PenaltyDurationUnit;
  untilDate?: string | null;
  permanent?: boolean;
  reason?: string;
  moderatorComment?: string;
  actingProfile?: Profile | null;
}): Promise<void> {
  const supabase = getSupabaseClient();
  let mutedUntil: string | null = null;
  if (params.untilDate || params.durationValue !== undefined || params.permanent !== undefined) {
    mutedUntil = computePenaltyExpirationIso({
      permanent: params.permanent,
      untilDate: params.untilDate,
      durationValue: params.durationValue,
      durationUnit: params.durationUnit,
    });
  } else if (params.durationHours) {
    mutedUntil = new Date(Date.now() + params.durationHours * 3600 * 1000).toISOString();
  }

  const cleanReason = params.reason?.trim() || 'Нарушение правил в этом чате';
  const cleanComment = params.moderatorComment?.trim() || null;

  const muteRecord: ChatMute = {
    id: `mute_${params.userId}_${params.chatId}`,
    user_id: params.userId,
    chat_id: params.chatId,
    muted_until: mutedUntil,
    reason: cleanReason,
    moderator_comment: cleanComment,
    muted_by: params.actingProfile?.id || null,
    is_penalty: true,
    created_at: new Date().toISOString(),
  };

  // Сохраняем в облачный манифест модерации (гарантированная работа даже без миграции 0030)
  const cloudMutes = await readCloudJson<ChatMute[]>(MUTES_CLOUD_PATH, []);
  const filteredCloud = cloudMutes.filter(
    (m) => !(m.user_id === params.userId && m.chat_id === params.chatId)
  );
  filteredCloud.unshift(muteRecord);
  await writeCloudJson(MUTES_CLOUD_PATH, filteredCloud);

  // Пробуем записать в таблицу chat_mutes
  await supabase
    .from('chat_mutes')
    .upsert(
      {
        user_id: params.userId,
        chat_id: params.chatId,
        muted_forever: false,
        muted_until: mutedUntil,
        reason: cleanReason,
        moderator_comment: cleanComment,
        muted_by: params.actingProfile?.id || null,
        is_penalty: true,
      } as any,
      { onConflict: 'user_id,chat_id' }
    )
    .then(() => {});

  if (params.actingProfile) {
    await logAdminAction('mute_user_in_chat', 'chat', params.chatId, {
      targetUserId: params.userId,
      mutedUntil,
      reason: cleanReason,
      moderatorComment: cleanComment,
    });
  }
}

export async function unmuteUserInChat(userId: string, chatId: string, actingProfile?: Profile | null): Promise<void> {
  const supabase = getSupabaseClient();
  const cloudMutes = await readCloudJson<ChatMute[]>(MUTES_CLOUD_PATH, []);
  const nextCloud = cloudMutes.filter((m) => !(m.user_id === userId && m.chat_id === chatId));
  await writeCloudJson(MUTES_CLOUD_PATH, nextCloud);

  await supabase.from('chat_mutes').delete().eq('user_id', userId).eq('chat_id', chatId);
  if (actingProfile) {
    await logAdminAction('unmute_user_in_chat', 'chat', chatId, { targetUserId: userId });
  }
}

function isPenaltyMuteRow(row: any): boolean {
  if (!row) return false;
  // Отличаем штрафной мут модерации от пользовательского отключения уведомлений (muted_forever без reason)
  return Boolean(row.is_penalty || (row.reason && String(row.reason).trim().length > 0) || row.muted_by);
}

export async function getUserChatMute(userId: string, chatId: string): Promise<ChatMute | null> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('chat_mutes')
    .select('*')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .maybeSingle();

  if (data && isPenaltyMuteRow(data)) {
    if (data.muted_until && new Date(data.muted_until).getTime() <= Date.now()) {
      void unmuteUserInChat(userId, chatId);
      return null;
    }
    return {
      ...data,
      id: data.id || `mute_${userId}_${chatId}`,
    } as ChatMute;
  }

  const cloudMutes = await readCloudJson<ChatMute[]>(MUTES_CLOUD_PATH, []);
  const found = cloudMutes.find((m) => m.user_id === userId && m.chat_id === chatId);
  if (found) {
    if (found.muted_until && new Date(found.muted_until).getTime() <= Date.now()) {
      void unmuteUserInChat(userId, chatId);
      return null;
    }
    return found;
  }

  return null;
}

export async function getUserAllMutes(userId: string): Promise<ChatMute[]> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('chat_mutes')
    .select('*')
    .eq('user_id', userId);

  const cloudMutes = await readCloudJson<ChatMute[]>(MUTES_CLOUD_PATH, []);
  const myCloudMutes = cloudMutes.filter((m) => m.user_id === userId);

  const byChat = new Map<string, ChatMute>();

  for (const item of data ?? []) {
    if (!isPenaltyMuteRow(item)) continue;
    if (item.muted_until && new Date(item.muted_until).getTime() <= Date.now()) {
      void unmuteUserInChat(userId, item.chat_id);
      continue;
    }
    byChat.set(item.chat_id, {
      ...(item as ChatMute),
      id: item.id || `mute_${userId}_${item.chat_id}`,
    });
  }

  for (const cm of myCloudMutes) {
    if (cm.muted_until && new Date(cm.muted_until).getTime() <= Date.now()) {
      void unmuteUserInChat(userId, cm.chat_id);
      continue;
    }
    if (!byChat.has(cm.chat_id)) {
      byChat.set(cm.chat_id, cm);
    }
  }

  const validMutes = Array.from(byChat.values());

  if (validMutes.length > 0) {
    const chatIds = validMutes.map((m) => m.chat_id);
    const { data: chatRows } = await supabase.from('chats').select('id, title').in('id', chatIds);
    const chatMap = new Map((chatRows || []).map((c) => [c.id, c.title || 'Чат']));
    return validMutes.map((m) => ({
      ...m,
      chat_title: chatMap.get(m.chat_id) || m.chat_title || 'Чат',
    }));
  }

  return validMutes;
}

/* ============================================================================
 * БАН ПО IP (Отдельный класс наказаний)
 * ============================================================================ */

export async function banIpAddress(ipAddress: string, reason: string, actingProfile: Profile): Promise<void> {
  if (actingProfile.role !== 'admin' && actingProfile.role !== 'developer') {
    throw new Error('Недостаточно прав для бана по IP');
  }
  const cleanIp = ipAddress.trim();
  if (!cleanIp) throw new Error('Укажите корректный IP адрес');

  const supabase = getSupabaseClient();
  const { error } = await supabase.from('banned_ips').upsert(
    {
      ip_address: cleanIp,
      reason: reason || 'Заблокирован администратором',
      banned_by: actingProfile.id,
    },
    { onConflict: 'ip_address' }
  );

  if (error) throw error;
  await logAdminAction('ban_ip', 'ip', cleanIp, { reason });
}

export async function unbanIpAddress(ipAddress: string, actingProfile: Profile): Promise<void> {
  if (actingProfile.role !== 'admin' && actingProfile.role !== 'developer') {
    throw new Error('Недостаточно прав');
  }
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('banned_ips').delete().eq('ip_address', ipAddress.trim());
  if (error) throw error;
  await logAdminAction('unban_ip', 'ip', ipAddress, {});
}

export async function listBannedIps(): Promise<BannedIp[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('banned_ips').select('*').order('created_at', { ascending: false });
  if (error) return [];
  return (data ?? []) as BannedIp[];
}

export async function isIpBanned(ipAddress: string): Promise<boolean> {
  if (!ipAddress) return false;
  const supabase = getSupabaseClient();
  const { data } = await supabase.from('banned_ips').select('id').eq('ip_address', ipAddress.trim()).maybeSingle();
  return Boolean(data);
}

/* ============================================================================
 * АПЕЛЛЯЦИИ И ОБЖАЛОВАНИЕ НАКАЗАНИЙ (Appeals — БД + Облачный фолбэк)
 * ============================================================================ */

export async function submitAppeal(params: {
  userId: string;
  penaltyType: AppealPenaltyType;
  chatId?: string;
  reason: string;
}): Promise<AppealItem> {
  const supabase = getSupabaseClient();
  const nowIso = new Date().toISOString();
  const fallbackItem: AppealItem = {
    id: `appeal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    user_id: params.userId,
    penalty_type: params.penaltyType,
    chat_id: params.chatId || null,
    reason: params.reason.trim(),
    status: 'pending',
    admin_notes: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: nowIso,
  };

  let finalItem = fallbackItem;
  try {
    const { data, error } = await supabase
      .from('appeals')
      .insert({
        user_id: params.userId,
        penalty_type: params.penaltyType,
        chat_id: params.chatId || null,
        reason: params.reason.trim(),
        status: 'pending',
      })
      .select('*')
      .single();

    if (!error && data) {
      finalItem = data as AppealItem;
    }
  } catch {}

  const cloudList = await readCloudJson<AppealItem[]>(APPEALS_CLOUD_PATH, []);
  cloudList.unshift(finalItem);
  await writeCloudJson(APPEALS_CLOUD_PATH, cloudList.slice(0, 200));

  return finalItem;
}

export async function getMyAppeals(userId: string): Promise<AppealItem[]> {
  const supabase = getSupabaseClient();
  const byId = new Map<string, AppealItem>();

  try {
    const { data } = await supabase
      .from('appeals')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    for (const row of data ?? []) {
      byId.set(row.id, row as AppealItem);
    }
  } catch {}

  const cloudList = await readCloudJson<AppealItem[]>(APPEALS_CLOUD_PATH, []);
  for (const item of cloudList) {
    if (item.user_id === userId && !byId.has(item.id)) {
      byId.set(item.id, item);
    }
  }

  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function listAppealsForAdmin(): Promise<AppealItem[]> {
  const supabase = getSupabaseClient();
  const byId = new Map<string, AppealItem>();

  try {
    const { data: dbAppeals } = await supabase
      .from('appeals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    for (const row of dbAppeals ?? []) {
      byId.set(row.id, row as AppealItem);
    }
  } catch {}

  const cloudList = await readCloudJson<AppealItem[]>(APPEALS_CLOUD_PATH, []);
  for (const item of cloudList) {
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
    }
  }

  const appeals = Array.from(byId.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  if (appeals.length === 0) return [];

  const userIds = Array.from(new Set(appeals.map((a) => a.user_id)));
  const chatIds = Array.from(new Set(appeals.map((a) => a.chat_id).filter(Boolean))) as string[];

  const [{ data: profiles }, { data: chats }] = await Promise.all([
    supabase.from('profiles').select('id, display_name, username, avatar_url').in('id', userIds),
    chatIds.length > 0 ? supabase.from('chats').select('id, title').in('id', chatIds) : Promise.resolve({ data: [] }),
  ]);

  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
  const chatMap = new Map((chats || []).map((c) => [c.id, c.title || 'Чат']));

  return appeals.map((a) => {
    const prof = profileMap.get(a.user_id);
    return {
      ...a,
      user_name: prof?.display_name || prof?.username || 'Пользователь',
      user_username: prof?.username || 'user',
      user_avatar: prof?.avatar_url || null,
      chat_title: a.chat_id ? chatMap.get(a.chat_id) || 'Чат' : undefined,
    };
  });
}

export async function reviewAppeal(params: {
  appealId: string;
  status: 'approved' | 'rejected';
  adminNotes?: string;
  actingProfile: Profile;
}): Promise<void> {
  if (
    params.actingProfile.role !== 'admin' &&
    params.actingProfile.role !== 'developer' &&
    params.actingProfile.role !== 'moderator'
  ) {
    throw new Error('Недостаточно прав для рассмотрения апелляции');
  }

  const supabase = getSupabaseClient();
  let appeal: AppealItem | null = null;

  try {
    const { data } = await supabase.from('appeals').select('*').eq('id', params.appealId).maybeSingle();
    if (data) appeal = data as AppealItem;
  } catch {}

  const cloudList = await readCloudJson<AppealItem[]>(APPEALS_CLOUD_PATH, []);
  if (!appeal) {
    appeal = cloudList.find((a) => a.id === params.appealId) || null;
  }
  if (!appeal) throw new Error('Апелляция не найдена');

  const nowIso = new Date().toISOString();
  const cleanNotes = params.adminNotes?.trim() || null;

  try {
    await supabase
      .from('appeals')
      .update({
        status: params.status,
        admin_notes: cleanNotes,
        reviewed_by: params.actingProfile.id,
        reviewed_at: nowIso,
      })
      .eq('id', params.appealId);
  } catch {}

  const updatedCloud = cloudList.map((a) =>
    a.id === params.appealId
      ? {
          ...a,
          status: params.status,
          admin_notes: cleanNotes,
          reviewed_by: params.actingProfile.id,
          reviewed_at: nowIso,
        }
      : a
  );
  await writeCloudJson(APPEALS_CLOUD_PATH, updatedCloud);

  if (cleanNotes) {
    await saveUserPenaltyMetaToCloud(appeal.user_id, {
      moderatorComment: cleanNotes,
    });
  }

  // Если апелляция ОДОБРЕНА — автоматически снимаем наказание!
  if (params.status === 'approved') {
    if (appeal.penalty_type === 'mute' && appeal.chat_id) {
      await unmuteUserInChat(appeal.user_id, appeal.chat_id, params.actingProfile);
    } else if (appeal.penalty_type === 'freeze') {
      await setAccountFrozen(appeal.user_id, false, params.actingProfile);
    } else if (appeal.penalty_type === 'ban_account') {
      await unbanAccount(appeal.user_id, params.actingProfile);
    }
  }

  await logAdminAction(`review_appeal_${params.status}`, 'appeal', params.appealId, {
    userId: appeal.user_id,
    penaltyType: appeal.penalty_type,
    adminNotes: cleanNotes,
  });
}

/* ============================================================================
 * КАСТОМНЫЕ РОЛИ И ИКОНКИ (Custom Roles & Icons)
 * ============================================================================ */

const DEFAULT_CUSTOM_ROLES: CustomRoleDefinition[] = [
  {
    id: 'role_vip_tester',
    name: 'VIP Тестер Pixset Studio',
    color: '#ffd400',
    icon: '🧪',
    description: 'Ранний доступ и тестирование новых функций PixChats',
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'role_designer',
    name: 'Дизайнер Pixset Studio',
    color: '#38bdf8',
    icon: '🎨',
    description: 'Команда визуального дизайна и оформления',
    created_at: '2026-01-01T00:00:00.000Z',
  },
];

function readLocalCustomRolesManifest(): CustomRolesCloudManifest {
  const empty: CustomRolesCloudManifest = {
    roles: DEFAULT_CUSTOM_ROLES,
    assignments: {},
    updatedAt: '',
  };
  if (typeof window === 'undefined') return empty;
  try {
    const raw = localStorage.getItem(CUSTOM_ROLES_LOCAL_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as CustomRolesCloudManifest;
    return {
      roles: Array.isArray(parsed.roles) && parsed.roles.length > 0 ? parsed.roles : DEFAULT_CUSTOM_ROLES,
      assignments: parsed.assignments && typeof parsed.assignments === 'object' ? parsed.assignments : {},
      updatedAt: parsed.updatedAt || '',
    };
  } catch {
    return empty;
  }
}

function saveLocalCustomRolesManifest(manifest: CustomRolesCloudManifest): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CUSTOM_ROLES_LOCAL_KEY, JSON.stringify(manifest));
    window.dispatchEvent(new CustomEvent('pixchats-custom-roles-changed', { detail: manifest }));
  } catch {}
}

let lastCustomRolesSyncTs = 0;

export async function syncCustomRolesFromCloud(force = false): Promise<CustomRolesCloudManifest> {
  const local = readLocalCustomRolesManifest();
  if (!force && Date.now() - lastCustomRolesSyncTs < 30_000) {
    return local;
  }
  lastCustomRolesSyncTs = Date.now();
  try {
    const cloud = await readCloudJson<CustomRolesCloudManifest | null>(CUSTOM_ROLES_CLOUD_PATH, null);
    if (cloud && Array.isArray(cloud.roles)) {
      const merged: CustomRolesCloudManifest = {
        roles: cloud.roles.length > 0 ? cloud.roles : DEFAULT_CUSTOM_ROLES,
        assignments: { ...local.assignments, ...(cloud.assignments || {}) },
        updatedAt: cloud.updatedAt || new Date().toISOString(),
      };
      saveLocalCustomRolesManifest(merged);
      return merged;
    }
  } catch {}
  return local;
}

export function getCustomRolesSync(): CustomRoleDefinition[] {
  return readLocalCustomRolesManifest().roles;
}

export function getUserCustomRolesSync(userId?: string | null, username?: string | null): CustomRoleDefinition[] {
  const manifest = readLocalCustomRolesManifest();
  const assignedIds = new Set<string>();
  if (userId && Array.isArray(manifest.assignments[userId])) {
    manifest.assignments[userId].forEach((id) => assignedIds.add(id));
  }
  if (username) {
    const clean = `@${username.toLowerCase().replace(/^@/, '')}`;
    if (Array.isArray(manifest.assignments[clean])) {
      manifest.assignments[clean].forEach((id) => assignedIds.add(id));
    }
  }
  if (assignedIds.size === 0) return [];
  return manifest.roles.filter((r) => assignedIds.has(r.id));
}

export async function listCustomRoles(): Promise<CustomRoleDefinition[]> {
  const manifest = await syncCustomRolesFromCloud(true);
  return manifest.roles;
}

export async function createCustomRole(
  params: {
    name: string;
    icon: string;
    color?: string;
    description?: string;
  },
  actingProfile: Profile
): Promise<CustomRoleDefinition> {
  if (actingProfile.role !== 'admin' && actingProfile.role !== 'developer') {
    throw new Error('Только администратор или разработчик может создавать новые роли');
  }
  const cleanName = params.name.trim();
  if (!cleanName) throw new Error('Введите название роли');
  const cleanIcon = params.icon.trim() || '⭐';
  const cleanColor = params.color?.trim() || '#ffd400';

  const manifest = await syncCustomRolesFromCloud(true);
  const newRole: CustomRoleDefinition = {
    id: `crole_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    icon: cleanIcon,
    color: cleanColor,
    description: params.description?.trim() || null,
    created_at: new Date().toISOString(),
  };

  const nextManifest: CustomRolesCloudManifest = {
    roles: [...manifest.roles, newRole],
    assignments: manifest.assignments,
    updatedAt: new Date().toISOString(),
  };

  saveLocalCustomRolesManifest(nextManifest);
  await writeCloudJson(CUSTOM_ROLES_CLOUD_PATH, nextManifest);
  await logAdminAction('create_custom_role', 'role', newRole.id, { name: cleanName, icon: cleanIcon, color: cleanColor });
  return newRole;
}

export async function deleteCustomRole(roleId: string, actingProfile: Profile): Promise<void> {
  if (actingProfile.role !== 'admin' && actingProfile.role !== 'developer') {
    throw new Error('Недостаточно прав для удаления роли');
  }
  const manifest = await syncCustomRolesFromCloud(true);
  const nextAssignments: Record<string, string[]> = {};
  for (const [k, ids] of Object.entries(manifest.assignments)) {
    nextAssignments[k] = (ids || []).filter((id) => id !== roleId);
  }
  const nextManifest: CustomRolesCloudManifest = {
    roles: manifest.roles.filter((r) => r.id !== roleId),
    assignments: nextAssignments,
    updatedAt: new Date().toISOString(),
  };
  saveLocalCustomRolesManifest(nextManifest);
  await writeCloudJson(CUSTOM_ROLES_CLOUD_PATH, nextManifest);
  await logAdminAction('delete_custom_role', 'role', roleId);
}

export async function toggleUserCustomRole(
  targetUserId: string,
  roleId: string,
  actingProfile: Profile,
  targetUsername?: string
): Promise<string[]> {
  if (actingProfile.role !== 'admin' && actingProfile.role !== 'developer') {
    throw new Error('Недостаточно прав для назначения кастомной роли');
  }
  const manifest = await syncCustomRolesFromCloud(true);
  const existing = new Set<string>(manifest.assignments[targetUserId] || []);
  if (existing.has(roleId)) {
    existing.delete(roleId);
  } else {
    existing.add(roleId);
  }
  const updatedList = Array.from(existing);
  const nextAssignments: Record<string, string[]> = {
    ...manifest.assignments,
    [targetUserId]: updatedList,
  };
  if (targetUsername) {
    nextAssignments[`@${targetUsername.toLowerCase().replace(/^@/, '')}`] = updatedList;
  }

  const nextManifest: CustomRolesCloudManifest = {
    roles: manifest.roles,
    assignments: nextAssignments,
    updatedAt: new Date().toISOString(),
  };
  saveLocalCustomRolesManifest(nextManifest);
  await writeCloudJson(CUSTOM_ROLES_CLOUD_PATH, nextManifest);
  await logAdminAction('toggle_custom_role', 'user', targetUserId, { roleId, assigned: updatedList });
  return updatedList;
}



