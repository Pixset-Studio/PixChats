import { getSupabaseClient } from './supabaseClient';
import type { Chat, Profile, UserRole, ChatMute, BannedIp, AppealItem, AppealPenaltyType, AppealStatus } from './types';

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

/** Ручная самопроверка: если запрос к БД прошёл — Supabase точно доступен. Полноценный cron — задача на будущее. */
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
}

/**
 * Назначение роли. По вашему требованию — только 'developer' может назначать
 * 'admin'/'moderator'. Эта проверка продублирована и на фронте, и обязана быть
 * закреплена RLS-политикой/Edge Function перед продакшеном (см. TODO в миграции).
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
  permanent?: boolean;
}

/** Бан аккаунта — временный (durationDays) или навсегда. Только admin/developer. */
export async function banAccount(targetUserId: string, params: BanAccountParams, actingProfile: Profile) {
  if (actingProfile.role !== 'admin' && actingProfile.role !== 'developer') {
    throw new Error('Недостаточно прав');
  }
  const supabase = getSupabaseClient();
  const bannedUntil = params.permanent
    ? null
    : params.durationDays
    ? new Date(Date.now() + params.durationDays * 86400000).toISOString()
    : null;

  const { error } = await supabase
    .from('profiles')
    .update({ banned_permanently: !!params.permanent, banned_until: bannedUntil })
    .eq('id', targetUserId);
  if (error) throw error;
  await logAdminAction('ban_account', 'user', targetUserId, params as any);
}

export async function unbanAccount(targetUserId: string, actingProfile: Profile) {
  if (actingProfile.role !== 'admin' && actingProfile.role !== 'developer') {
    throw new Error('Недостаточно прав');
  }
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('profiles')
    .update({ banned_permanently: false, banned_until: null })
    .eq('id', targetUserId);
  if (error) throw error;
  await logAdminAction('unban_account', 'user', targetUserId);
}

/** Заморозка — аккаунт может читать, но не может писать сообщения (RLS блокирует insert). */
export async function setAccountFrozen(targetUserId: string, frozen: boolean, actingProfile: Profile) {
  if (actingProfile.role !== 'admin' && actingProfile.role !== 'developer') {
    throw new Error('Недостаточно прав');
  }
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('profiles')
    .update({
      frozen,
      frozen_at: frozen ? new Date().toISOString() : null,
    })
    .eq('id', targetUserId);
  if (error) throw error;
  await logAdminAction(frozen ? 'freeze_account' : 'unfreeze_account', 'user', targetUserId);
}

/** Автоматическая очистка заблокированных/замороженных аккаунтов, если заморозка не снята в течение 90 дней */
export async function cleanupExpiredFrozenAccounts(): Promise<number> {
  const supabase = getSupabaseClient();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  
  const { data: expired } = await supabase
    .from('profiles')
    .select('id')
    .eq('frozen', true)
    .lt('frozen_at', ninetyDaysAgo);

  if (!expired || expired.length === 0) return 0;

  let count = 0;
  for (const user of expired) {
    try {
      await supabase.from('profiles').delete().eq('id', user.id);
      count++;
    } catch {}
  }
  return count;
}

/**
 * Полное удаление аккаунта требует service_role (auth.admin.deleteUser) — с anon-ключом
 * это невозможно, поэтому вызывается Edge Function admin-delete-user (см. supabase/functions/).
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
    .update({ is_verified: verified, verified_at: verified ? new Date().toISOString() : null })
    .eq('id', chatId);
  if (error) throw error;
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

    // Рассылаем по каналу omniscient / admin-broadcast
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

  // 1. Вставляем запись жалобы
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

  // 2. Проверяем количество УНИКАЛЬНЫХ пожаловавшихся пользователей на данного нарушителя
  const { data: reports } = await supabase
    .from('message_reports')
    .select('reporter_id')
    .eq('reported_user_id', params.reportedUserId);

  const uniqueReporters = new Set((reports || []).map((r) => r.reporter_id));
  let autoFrozen = false;

  if (uniqueReporters.size >= 3) {
    autoFrozen = true;
    await supabase
      .from('profiles')
      .update({ frozen: true })
      .eq('id', params.reportedUserId);

    await notifyAdminsAboutFreeze(
      params.reportedUserId,
      `Накоплено ${uniqueReporters.size} жалоб от разных пользователей (последняя: ${params.reason})`
    );
  }

  return { autoFrozen };
}

/** Получение всех жалоб для раздела модерации в админ-панели */
export async function getMessageReportsForAdmin(): Promise<MessageReport[]> {
  const supabase = getSupabaseClient();
  const { data: reports, error } = await supabase
    .from('message_reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return [];

  if (!reports || reports.length === 0) return [];

  // Собираем связанные профили, сообщения и чаты
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

/** Список вредоносных / незаконных / спам-слов для автомодерации публичных чатов и каналов */
const BAD_WORDS_REGEX =
  /(терракт|терроризм|наркотик|наркота|гидра|мефедрон|амфетамин|продам паспорт|купить слив|взлом аккаунт|казино 1000|заработок без вложений|убью тебя|взрывчатка|оружие сбыт|сбыт карт|кардинг)/i;

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
 * МЬЮТЫ (Ограничения отправки сообщений в конкретном чате)
 * ============================================================================ */

export async function muteUserInChat(params: {
  userId: string;
  chatId: string;
  durationHours?: number; // null/undefined = навсегда
  reason?: string;
  actingProfile?: Profile | null;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const mutedUntil = params.durationHours
    ? new Date(Date.now() + params.durationHours * 3600 * 1000).toISOString()
    : null;

  const { error } = await supabase.from('chat_mutes').upsert(
    {
      user_id: params.userId,
      chat_id: params.chatId,
      muted_until: mutedUntil,
      reason: params.reason || 'Нарушение правил в этом чате',
      muted_by: params.actingProfile?.id || null,
    },
    { onConflict: 'user_id,chat_id' }
  );

  if (error) throw error;
  if (params.actingProfile) {
    await logAdminAction('mute_user_in_chat', 'chat', params.chatId, {
      targetUserId: params.userId,
      durationHours: params.durationHours,
      reason: params.reason,
    });
  }
}

export async function unmuteUserInChat(userId: string, chatId: string, actingProfile?: Profile | null): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('chat_mutes').delete().eq('user_id', userId).eq('chat_id', chatId);
  if (error) throw error;
  if (actingProfile) {
    await logAdminAction('unmute_user_in_chat', 'chat', chatId, { targetUserId: userId });
  }
}

export async function getUserChatMute(userId: string, chatId: string): Promise<ChatMute | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('chat_mutes')
    .select('*')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .maybeSingle();

  if (error || !data) return null;

  // Проверяем истечение срока
  if (data.muted_until && new Date(data.muted_until).getTime() <= Date.now()) {
    void unmuteUserInChat(userId, chatId);
    return null;
  }

  return data as ChatMute;
}

export async function getUserAllMutes(userId: string): Promise<ChatMute[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('chat_mutes')
    .select('*')
    .eq('user_id', userId);

  if (error || !data) return [];

  const validMutes: ChatMute[] = [];
  for (const item of data) {
    if (item.muted_until && new Date(item.muted_until).getTime() <= Date.now()) {
      void unmuteUserInChat(userId, item.chat_id);
    } else {
      validMutes.push(item as ChatMute);
    }
  }

  // Загружаем названия чатов
  if (validMutes.length > 0) {
    const chatIds = validMutes.map((m) => m.chat_id);
    const { data: chatRows } = await supabase.from('chats').select('id, title').in('id', chatIds);
    const chatMap = new Map((chatRows || []).map((c) => [c.id, c.title || 'Чат']));
    return validMutes.map((m) => ({
      ...m,
      chat_title: chatMap.get(m.chat_id) || 'Чат',
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
 * АПЕЛЛЯЦИИ И ОБЖАЛОВАНИЕ НАКАЗАНИЙ (Appeals)
 * ============================================================================ */

export async function submitAppeal(params: {
  userId: string;
  penaltyType: AppealPenaltyType;
  chatId?: string;
  reason: string;
}): Promise<AppealItem> {
  const supabase = getSupabaseClient();
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

  if (error) throw error;
  return data as AppealItem;
}

export async function listAppealsForAdmin(): Promise<AppealItem[]> {
  const supabase = getSupabaseClient();
  const { data: appeals, error } = await supabase
    .from('appeals')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !appeals) return [];

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
  if (params.actingProfile.role !== 'admin' && params.actingProfile.role !== 'developer' && params.actingProfile.role !== 'moderator') {
    throw new Error('Недостаточно прав для рассмотрения апелляции');
  }

  const supabase = getSupabaseClient();
  const { data: appeal } = await supabase.from('appeals').select('*').eq('id', params.appealId).single();
  if (!appeal) throw new Error('Апелляция не найдена');

  // Обновляем статус апелляции
  await supabase
    .from('appeals')
    .update({
      status: params.status,
      admin_notes: params.adminNotes || null,
      reviewed_by: params.actingProfile.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', params.appealId);

  // Если апелляция ОДОБРЕНА (approved) — автоматически снимаем наказание!
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
  });
}

