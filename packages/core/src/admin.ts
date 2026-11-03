import { getSupabaseClient } from './supabaseClient';
import { PROFILE_SELECT_WITHOUT_OTK, hydrateProfileRowEnvelopes } from './auth';
import { decryptMessageE2EE } from './crypto';
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
  deletedRoleIds?: string[];
  updatedAt: string;
}

export interface ProfileAdminEnvelopeV1 {
  premium?: {
    userId: string;
    username?: string;
    grantedBy: string;
    grantedAt: string;
    expiresAt: string | null;
    note?: string;
    revoked?: boolean;
  } | null;
  customRoleIds?: string[];
  customRolesCatalog?: CustomRoleDefinition[];
  deletedRoleIds?: string[];
  penaltyMeta?: UserPenaltyDetails;
  chatMutes?: ChatMute[];
  reviewedAppeals?: Record<
    string,
    {
      status: AppealStatus;
      admin_notes: string | null;
      reviewed_by: string | null;
      reviewed_at: string | null;
    }
  >;
  updatedAt?: string;
}

export interface ProfileUserEnvelopeV1 {
  birthDate?: string | null;
  bannerUrl?: string | null;
  musicStatus?: {
    title: string;
    artist: string;
    audioUrl?: string | null;
    fileName?: string | null;
    updatedAt: string;
  } | null;
  emojiStatus?: {
    emoji: string;
    label?: string;
    expiresAt?: string | null;
    updatedAt: string;
  } | null;
  closeFriendsIds?: string[];
  stories?: any[];
  appeals?: AppealItem[];
  updatedAt?: string;
}

const CUSTOM_ROLES_LOCAL_KEY = 'pixchats:custom_roles_manifest_v1';
const ADMIN_ENVELOPE_PREFIX = 'pxadm:v1:';
const USER_ENVELOPE_PREFIX = 'pxext:v1:';

export function parseProfileAdminEnvelope(raw?: string | null): ProfileAdminEnvelopeV1 {
  if (!raw || typeof raw !== 'string' || !raw.startsWith(ADMIN_ENVELOPE_PREFIX)) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw.slice(ADMIN_ENVELOPE_PREFIX.length));
    return parsed && typeof parsed === 'object' ? (parsed as ProfileAdminEnvelopeV1) : {};
  } catch {
    return {};
  }
}

export function serializeProfileAdminEnvelope(env: ProfileAdminEnvelopeV1): string {
  return `${ADMIN_ENVELOPE_PREFIX}${JSON.stringify({ ...env, updatedAt: new Date().toISOString() })}`;
}

export function parseProfileUserEnvelope(raw?: string | null): ProfileUserEnvelopeV1 {
  if (!raw || typeof raw !== 'string' || !raw.startsWith(USER_ENVELOPE_PREFIX)) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw.slice(USER_ENVELOPE_PREFIX.length));
    return parsed && typeof parsed === 'object' ? (parsed as ProfileUserEnvelopeV1) : {};
  } catch {
    return {};
  }
}

export function serializeProfileUserEnvelope(env: ProfileUserEnvelopeV1): string {
  return `${USER_ENVELOPE_PREFIX}${JSON.stringify({ ...env, updatedAt: new Date().toISOString() })}`;
}

export async function updateProfileAdminEnvelope(
  userId: string,
  updater: (prev: ProfileAdminEnvelopeV1) => ProfileAdminEnvelopeV1,
  extraProfileColumns?: Record<string, any>
): Promise<ProfileAdminEnvelopeV1> {
  const supabase = getSupabaseClient();
  const { data: row } = await supabase
    .from('profiles')
    .select('public_signed_prekey')
    .eq('id', userId)
    .maybeSingle();
  const prev = parseProfileAdminEnvelope(row?.public_signed_prekey);
  const next = updater(prev);
  const serialized = serializeProfileAdminEnvelope(next);
  const patch: Record<string, any> = {
    ...(extraProfileColumns || {}),
    public_signed_prekey: serialized,
  };
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) throw error;
  return next;
}

export async function updateProfileUserEnvelope(
  userId: string,
  updater: (prev: ProfileUserEnvelopeV1) => ProfileUserEnvelopeV1
): Promise<ProfileUserEnvelopeV1> {
  const supabase = getSupabaseClient();
  const { data: row } = await supabase
    .from('profiles')
    .select('signed_prekey_signature')
    .eq('id', userId)
    .maybeSingle();
  const prev = parseProfileUserEnvelope(row?.signed_prekey_signature);
  const next = updater(prev);
  const serialized = serializeProfileUserEnvelope(next);
  const { error } = await supabase
    .from('profiles')
    .update({ signed_prekey_signature: serialized })
    .eq('id', userId);
  if (error) throw error;
  return next;
}

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

export async function saveUserPenaltyMetaToCloud(
  userId: string,
  patch: Partial<UserPenaltyDetails>
): Promise<void> {
  try {
    await updateProfileAdminEnvelope(userId, (prev) => {
      const existing: UserPenaltyDetails = prev.penaltyMeta || {
        banReason: null,
        frozenReason: null,
        moderatorComment: null,
      };
      return {
        ...prev,
        penaltyMeta: {
          ...existing,
          ...patch,
          updatedAt: new Date().toISOString(),
        },
      };
    });
  } catch {}
}

/**
 * Возвращает причину бана/заморозки и комментарий модератора для показа пользователю.
 * Проверяет поля профиля (включая public_signed_prekey) и журнал admin_audit_log.
 */
export async function getUserPenaltyDetails(
  userId: string,
  profile?: Profile | null
): Promise<UserPenaltyDetails> {
  let banReason = profile?.ban_reason || null;
  let frozenReason = profile?.frozen_reason || null;
  let moderatorComment = profile?.moderator_comment || null;

  if (profile?.public_signed_prekey) {
    const env = parseProfileAdminEnvelope(profile.public_signed_prekey);
    if (env.penaltyMeta) {
      if (!banReason && env.penaltyMeta.banReason) banReason = env.penaltyMeta.banReason;
      if (!frozenReason && env.penaltyMeta.frozenReason) frozenReason = env.penaltyMeta.frozenReason;
      if (!moderatorComment && env.penaltyMeta.moderatorComment) moderatorComment = env.penaltyMeta.moderatorComment;
    }
  }

  if (banReason && frozenReason && moderatorComment) {
    return { banReason, frozenReason, moderatorComment };
  }

  try {
    const supabase = getSupabaseClient();
    const { data: profRow } = await supabase
      .from('profiles')
      .select('public_signed_prekey')
      .eq('id', userId)
      .maybeSingle();
    if (profRow?.public_signed_prekey) {
      const env = parseProfileAdminEnvelope(profRow.public_signed_prekey);
      if (env.penaltyMeta) {
        if (!banReason && env.penaltyMeta.banReason) banReason = env.penaltyMeta.banReason;
        if (!frozenReason && env.penaltyMeta.frozenReason) frozenReason = env.penaltyMeta.frozenReason;
        if (!moderatorComment && env.penaltyMeta.moderatorComment) moderatorComment = env.penaltyMeta.moderatorComment;
      }
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
    .select(PROFILE_SELECT_WITHOUT_OTK)
    .or(`username.ilike.%${clean}%,display_name.ilike.%${clean}%`)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []).map((r) => hydrateProfileRowEnvelopes(r));
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

  let req = supabase.from('profiles').select(PROFILE_SELECT_WITHOUT_OTK);

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
  return (data ?? []).map((r) => hydrateProfileRowEnvelopes(r));
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
  const bannedUntil = computePenaltyExpirationIso(params);
  const isPermanent = Boolean(params.permanent || (!bannedUntil && !params.durationDays && !params.durationValue && !params.untilDate));
  const cleanReason = params.reason?.trim() || 'Нарушение правил PixChats';
  const cleanComment = params.moderatorComment?.trim() || null;

  await updateProfileAdminEnvelope(
    targetUserId,
    (prev) => ({
      ...prev,
      penaltyMeta: {
        ...(prev.penaltyMeta || { banReason: null, frozenReason: null, moderatorComment: null }),
        banReason: cleanReason,
        moderatorComment: cleanComment,
        updatedAt: new Date().toISOString(),
      },
    }),
    {
      banned_permanently: isPermanent,
      banned_until: isPermanent ? null : bannedUntil,
    }
  );

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

  await updateProfileAdminEnvelope(
    targetUserId,
    (prev) => ({
      ...prev,
      penaltyMeta: {
        ...(prev.penaltyMeta || { banReason: null, frozenReason: null, moderatorComment: null }),
        banReason: null,
        moderatorComment: null,
        updatedAt: new Date().toISOString(),
      },
    }),
    {
      banned_permanently: false,
      banned_until: null,
    }
  );

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
  const cleanReason = frozen ? (reason?.trim() || 'Заморожен модерацией для проверки') : null;
  const cleanComment = frozen ? (moderatorComment?.trim() || null) : null;
  const nowIso = frozen ? new Date().toISOString() : null;

  await updateProfileAdminEnvelope(
    targetUserId,
    (prev) => ({
      ...prev,
      penaltyMeta: {
        ...(prev.penaltyMeta || { banReason: null, frozenReason: null, moderatorComment: null }),
        frozenReason: cleanReason,
        frozenAt: nowIso,
        moderatorComment: cleanComment,
        updatedAt: new Date().toISOString(),
      },
    }),
    {
      frozen,
    }
  );

  await logAdminAction(frozen ? 'freeze_account' : 'unfreeze_account', 'user', targetUserId, {
    reason: cleanReason,
    moderatorComment: cleanComment,
  });
}

/** Безопасная автозаморозка аккаунта при автомодерации или жалобах */
export async function autoFreezeUserAccount(targetUserId: string, freezeReason: string): Promise<void> {
  const nowIso = new Date().toISOString();
  try {
    await updateProfileAdminEnvelope(
      targetUserId,
      (prev) => ({
        ...prev,
        penaltyMeta: {
          ...(prev.penaltyMeta || { banReason: null, frozenReason: null, moderatorComment: null }),
          frozenReason: freezeReason,
          frozenAt: nowIso,
          updatedAt: nowIso,
        },
      }),
      {
        frozen: true,
      }
    );
  } catch {
    const supabase = getSupabaseClient();
    await supabase.from('profiles').update({ frozen: true }).eq('id', targetUserId);
  }
}

/** Автоматическая очистка замороженных аккаунтов, если заморозка не снята в течение 90 дней */
export async function cleanupExpiredFrozenAccounts(): Promise<number> {
  const supabase = getSupabaseClient();
  const ninetyDaysAgoMs = Date.now() - 90 * 24 * 60 * 60 * 1000;

  const { data: frozenUsers, error } = await supabase
    .from('profiles')
    .select('id, public_signed_prekey')
    .eq('frozen', true);

  if (error || !frozenUsers || frozenUsers.length === 0) return 0;

  let count = 0;
  for (const user of frozenUsers as any[]) {
    const env = parseProfileAdminEnvelope(user.public_signed_prekey);
    const frozenIso = env.penaltyMeta?.frozenAt || env.penaltyMeta?.updatedAt;
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
    supabase.from('profiles').select(PROFILE_SELECT_WITHOUT_OTK).in('id', userIds),
    supabase.from('messages').select('id, chat_id, ciphertext, caption').in('id', msgIds),
    chatIds.length > 0 ? supabase.from('chats').select('id, title').in('id', chatIds) : Promise.resolve({ data: [] }),
  ]);

  const profileMap = new Map((profiles || []).map((p) => [p.id, hydrateProfileRowEnvelopes(p)]));
  const msgMap = new Map<string, string>();
  for (const m of (messages || []) as any[]) {
    let text = '';
    if (m.ciphertext && m.chat_id) {
      try {
        text = await decryptMessageE2EE(m.chat_id, m.ciphertext);
      } catch {
        text = m.ciphertext;
      }
    }
    msgMap.set(m.id, text || m.caption || '');
  }
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

  await updateProfileAdminEnvelope(params.userId, (prev) => {
    const existing = Array.isArray(prev.chatMutes) ? prev.chatMutes : [];
    const filtered = existing.filter((m) => m.chat_id !== params.chatId);
    return {
      ...prev,
      chatMutes: [muteRecord, ...filtered],
    };
  });

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
  try {
    await updateProfileAdminEnvelope(userId, (prev) => {
      const existing = Array.isArray(prev.chatMutes) ? prev.chatMutes : [];
      return {
        ...prev,
        chatMutes: existing.filter((m) => m.chat_id !== chatId),
      };
    });
  } catch {}

  if (actingProfile) {
    await logAdminAction('unmute_user_in_chat', 'chat', chatId, { targetUserId: userId });
  }
}

export async function getUserChatMute(userId: string, chatId: string): Promise<ChatMute | null> {
  try {
    const supabase = getSupabaseClient();
    const { data: row } = await supabase
      .from('profiles')
      .select('public_signed_prekey')
      .eq('id', userId)
      .maybeSingle();
    const env = parseProfileAdminEnvelope(row?.public_signed_prekey);
    const mutes = Array.isArray(env.chatMutes) ? env.chatMutes : [];
    const found = mutes.find((m) => m.chat_id === chatId);
    if (found) {
      if (found.muted_until && new Date(found.muted_until).getTime() <= Date.now()) {
        void unmuteUserInChat(userId, chatId);
        return null;
      }
      return found;
    }
  } catch {}
  return null;
}

export async function getUserAllMutes(userId: string): Promise<ChatMute[]> {
  const supabase = getSupabaseClient();
  const { data: row } = await supabase
    .from('profiles')
    .select('public_signed_prekey')
    .eq('id', userId)
    .maybeSingle();

  const env = parseProfileAdminEnvelope(row?.public_signed_prekey);
  const rawMutes = Array.isArray(env.chatMutes) ? env.chatMutes : [];
  const validMutes: ChatMute[] = [];

  for (const cm of rawMutes) {
    if (cm.muted_until && new Date(cm.muted_until).getTime() <= Date.now()) {
      void unmuteUserInChat(userId, cm.chat_id);
      continue;
    }
    validMutes.push(cm);
  }

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
 * АПЕЛЛЯЦИИ И ОБЖАЛОВАНИЕ НАКАЗАНИЙ (Appeals в PostgreSQL profiles)
 * ============================================================================ */

export async function submitAppeal(params: {
  userId: string;
  penaltyType: AppealPenaltyType;
  chatId?: string;
  reason: string;
}): Promise<AppealItem> {
  const nowIso = new Date().toISOString();
  const item: AppealItem = {
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

  await updateProfileUserEnvelope(params.userId, (prev) => {
    const existing = Array.isArray(prev.appeals) ? prev.appeals : [];
    return {
      ...prev,
      appeals: [item, ...existing].slice(0, 50),
    };
  });

  return item;
}

export async function getMyAppeals(userId: string): Promise<AppealItem[]> {
  const supabase = getSupabaseClient();
  const { data: row } = await supabase
    .from('profiles')
    .select('public_signed_prekey, signed_prekey_signature')
    .eq('id', userId)
    .maybeSingle();

  const userEnv = parseProfileUserEnvelope(row?.signed_prekey_signature);
  const admEnv = parseProfileAdminEnvelope(row?.public_signed_prekey);
  const reviewedMap = admEnv.reviewedAppeals || {};
  const list = Array.isArray(userEnv.appeals) ? userEnv.appeals : [];

  return list
    .map((a) => {
      const rev = reviewedMap[a.id];
      return rev ? { ...a, ...rev } : a;
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function listAppealsForAdmin(): Promise<AppealItem[]> {
  const supabase = getSupabaseClient();
  const { data: rows } = await supabase
    .from('profiles')
    .select('id, display_name, username, avatar_url, public_signed_prekey, signed_prekey_signature')
    .like('signed_prekey_signature', `${USER_ENVELOPE_PREFIX}%`)
    .limit(150);

  const appeals: AppealItem[] = [];
  for (const r of (rows || []) as any[]) {
    const userEnv = parseProfileUserEnvelope(r.signed_prekey_signature);
    const admEnv = parseProfileAdminEnvelope(r.public_signed_prekey);
    const reviewedMap = admEnv.reviewedAppeals || {};
    for (const item of userEnv.appeals || []) {
      const rev = reviewedMap[item.id];
      appeals.push({
        ...item,
        ...(rev || {}),
        user_id: r.id,
        user_name: r.display_name || r.username || 'Пользователь',
        user_username: r.username || 'user',
        user_avatar: r.avatar_url || null,
      });
    }
  }

  appeals.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  if (appeals.length === 0) return [];

  const chatIds = Array.from(new Set(appeals.map((a) => a.chat_id).filter(Boolean))) as string[];
  const { data: chats } =
    chatIds.length > 0 ? await supabase.from('chats').select('id, title').in('id', chatIds) : { data: [] };
  const chatMap = new Map((chats || []).map((c: any) => [c.id, c.title || 'Чат']));

  return appeals.map((a) => ({
    ...a,
    chat_title: a.chat_id ? chatMap.get(a.chat_id) || 'Чат' : undefined,
  }));
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

  const allAppeals = await listAppealsForAdmin();
  const appeal = allAppeals.find((a) => a.id === params.appealId);
  if (!appeal) throw new Error('Апелляция не найдена');

  const nowIso = new Date().toISOString();
  const cleanNotes = params.adminNotes?.trim() || null;

  await updateProfileAdminEnvelope(appeal.user_id, (prev) => ({
    ...prev,
    reviewedAppeals: {
      ...(prev.reviewedAppeals || {}),
      [params.appealId]: {
        status: params.status,
        admin_notes: cleanNotes,
        reviewed_by: params.actingProfile.id,
        reviewed_at: nowIso,
      },
    },
    penaltyMeta: cleanNotes
      ? {
          ...(prev.penaltyMeta || { banReason: null, frozenReason: null, moderatorComment: null }),
          moderatorComment: cleanNotes,
          updatedAt: nowIso,
        }
      : prev.penaltyMeta,
  }));

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
 * КАСТОМНЫЕ РОЛИ И ИКОНКИ (Custom Roles & Icons в PostgreSQL profiles)
 * ============================================================================ */

const DEFAULT_CUSTOM_ROLES: CustomRoleDefinition[] = [];

function readLocalCustomRolesManifest(): CustomRolesCloudManifest {
  const empty: CustomRolesCloudManifest = {
    roles: DEFAULT_CUSTOM_ROLES,
    assignments: {},
    deletedRoleIds: [],
    updatedAt: '',
  };
  if (typeof window === 'undefined') return empty;
  try {
    const raw = localStorage.getItem(CUSTOM_ROLES_LOCAL_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as CustomRolesCloudManifest;
    const deletedSet = new Set<string>(Array.isArray(parsed.deletedRoleIds) ? parsed.deletedRoleIds : []);
    const rawRoles = Array.isArray(parsed.roles) ? parsed.roles : DEFAULT_CUSTOM_ROLES;
    return {
      roles: rawRoles.filter((r) => r && r.id && !deletedSet.has(r.id)),
      assignments: parsed.assignments && typeof parsed.assignments === 'object' ? parsed.assignments : {},
      deletedRoleIds: Array.from(deletedSet),
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
  if (!force && Date.now() - lastCustomRolesSyncTs < 60_000) {
    return local;
  }
  lastCustomRolesSyncTs = Date.now();
  try {
    const supabase = getSupabaseClient();
    const { data: rows } = await supabase
      .from('profiles')
      .select('id, username, role, public_signed_prekey')
      .like('public_signed_prekey', `${ADMIN_ENVELOPE_PREFIX}%`)
      .limit(200);

    if (rows && rows.length > 0) {
      const deletedSet = new Set<string>(local.deletedRoleIds || []);
      const rolesMap = new Map<string, CustomRoleDefinition>();
      for (const r of local.roles) {
        if (r && r.id) rolesMap.set(r.id, r);
      }
      const assignments: Record<string, string[]> = { ...local.assignments };

      for (const row of rows as any[]) {
        const env = parseProfileAdminEnvelope(row.public_signed_prekey);
        if (Array.isArray(env.deletedRoleIds)) {
          for (const did of env.deletedRoleIds) deletedSet.add(did);
        }
        if ((row.role === 'developer' || row.role === 'admin') && Array.isArray(env.customRolesCatalog)) {
          for (const roleDef of env.customRolesCatalog) {
            if (roleDef && roleDef.id) rolesMap.set(roleDef.id, roleDef);
          }
        }
        if (Array.isArray(env.customRoleIds)) {
          assignments[row.id] = env.customRoleIds;
          if (row.username) {
            assignments[`@${String(row.username).toLowerCase().replace(/^@/, '')}`] = env.customRoleIds;
          }
        }
      }

      const finalRoles = Array.from(rolesMap.values()).filter((r) => !deletedSet.has(r.id));
      const cleanedAssignments: Record<string, string[]> = {};
      for (const [k, ids] of Object.entries(assignments)) {
        cleanedAssignments[k] = (ids || []).filter((id) => !deletedSet.has(id));
      }
      const merged: CustomRolesCloudManifest = {
        roles: finalRoles,
        assignments: cleanedAssignments,
        deletedRoleIds: Array.from(deletedSet),
        updatedAt: new Date().toISOString(),
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
    deletedRoleIds: manifest.deletedRoleIds || [],
    updatedAt: new Date().toISOString(),
  };

  saveLocalCustomRolesManifest(nextManifest);
  await updateProfileAdminEnvelope(actingProfile.id, (prev) => ({
    ...prev,
    customRolesCatalog: nextManifest.roles,
    deletedRoleIds: nextManifest.deletedRoleIds,
  }));
  await logAdminAction('create_custom_role', 'role', newRole.id, { name: cleanName, icon: cleanIcon, color: cleanColor });
  return newRole;
}

export async function deleteCustomRole(roleId: string, actingProfile: Profile): Promise<void> {
  if (actingProfile.role !== 'admin' && actingProfile.role !== 'developer') {
    throw new Error('Недостаточно прав для удаления роли');
  }
  const local = readLocalCustomRolesManifest();
  const deletedSet = new Set<string>([...(local.deletedRoleIds || []), roleId]);
  const nextAssignments: Record<string, string[]> = {};
  for (const [k, ids] of Object.entries(local.assignments)) {
    nextAssignments[k] = (ids || []).filter((id) => id !== roleId && !deletedSet.has(id));
  }
  const nextManifest: CustomRolesCloudManifest = {
    roles: local.roles.filter((r) => r.id !== roleId && !deletedSet.has(r.id)),
    assignments: nextAssignments,
    deletedRoleIds: Array.from(deletedSet),
    updatedAt: new Date().toISOString(),
  };
  saveLocalCustomRolesManifest(nextManifest);
  await updateProfileAdminEnvelope(actingProfile.id, (prev) => ({
    ...prev,
    customRolesCatalog: nextManifest.roles,
    deletedRoleIds: nextManifest.deletedRoleIds,
  }));
  await logAdminAction('delete_custom_role', 'role', roleId);
}

export async function clearAllCustomRoles(actingProfile: Profile): Promise<void> {
  if (actingProfile.role !== 'admin' && actingProfile.role !== 'developer') {
    throw new Error('Недостаточно прав для удаления всех кастомных ролей');
  }
  const local = readLocalCustomRolesManifest();
  const deletedSet = new Set<string>([
    ...(local.deletedRoleIds || []),
    ...local.roles.map((r) => r.id),
    'role_vip_tester',
    'role_designer',
  ]);
  const nextManifest: CustomRolesCloudManifest = {
    roles: [],
    assignments: {},
    deletedRoleIds: Array.from(deletedSet),
    updatedAt: new Date().toISOString(),
  };
  saveLocalCustomRolesManifest(nextManifest);
  await updateProfileAdminEnvelope(actingProfile.id, (prev) => ({
    ...prev,
    customRolesCatalog: [],
    deletedRoleIds: nextManifest.deletedRoleIds,
  }));
  await logAdminAction('clear_all_custom_roles', 'role', 'all');
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
    deletedRoleIds: manifest.deletedRoleIds || [],
    updatedAt: new Date().toISOString(),
  };
  saveLocalCustomRolesManifest(nextManifest);

  await updateProfileAdminEnvelope(targetUserId, (prev) => ({
    ...prev,
    customRoleIds: updatedList,
  }));
  await updateProfileAdminEnvelope(actingProfile.id, (prev) => ({
    ...prev,
    customRolesCatalog: manifest.roles,
  }));

  await logAdminAction('toggle_custom_role', 'user', targetUserId, { roleId, assigned: updatedList });
  return updatedList;
}



