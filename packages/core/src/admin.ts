import { getSupabaseClient } from './supabaseClient';
import type { Profile, UserRole } from './types';

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
  const { data, error } = await supabase.from('profiles').select('*').ilike('username', `%${query}%`).limit(20);
  if (error) throw error;
  return (data ?? []) as Profile[];
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

/** Выдача/снятие галочки верификации группе/каналу. Доступно admin и developer. */
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
