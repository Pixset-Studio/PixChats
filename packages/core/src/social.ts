import { getSupabaseClient } from './supabaseClient';
import type { Profile, Friendship } from './types';

/** Поиск пользователей по @username — используется и в друзьях, и в других местах. */
export async function searchUsers(query: string, excludeUserId?: string): Promise<Profile[]> {
  const supabase = getSupabaseClient();
  let request = supabase.from('profiles').select('*').ilike('username', `%${query}%`).limit(20);
  if (excludeUserId) request = request.neq('id', excludeUserId);
  const { data, error } = await request;
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function sendFriendRequest(requesterId: string, addresseeId: string): Promise<void> {
  if (requesterId === addresseeId) throw new Error('Нельзя добавить в друзья самого себя');
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('friendships').insert({
    requester_id: requesterId,
    addressee_id: addresseeId,
    status: 'pending',
  });
  if (error) throw error;
}

export async function acceptFriendRequest(friendshipId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', friendshipId);
  if (error) throw error;
}

/** Отклонить входящую заявку или отменить/удалить уже существующую дружбу. */
export async function removeFriendship(friendshipId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
  if (error) throw error;
}

export interface FriendWithProfile extends Friendship {
  friend_profile: Profile;
}

/** Список принятых друзей (профиль второй стороны, кем бы она ни была — requester или addressee). */
export async function getFriends(userId: string): Promise<FriendWithProfile[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('friendships')
    .select('*, requester:requester_id(*), addressee:addressee_id(*)')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    ...row,
    friend_profile: row.requester_id === userId ? row.addressee : row.requester,
  }));
}

/** Входящие заявки в друзья (ждут решения текущего пользователя). */
export async function getIncomingRequests(userId: string): Promise<FriendWithProfile[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('friendships')
    .select('*, requester:requester_id(*)')
    .eq('status', 'pending')
    .eq('addressee_id', userId);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ ...row, friend_profile: row.requester }));
}

/** Исходящие заявки, отправленные текущим пользователем и ещё не принятые. */
export async function getOutgoingRequests(userId: string): Promise<FriendWithProfile[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('friendships')
    .select('*, addressee:addressee_id(*)')
    .eq('status', 'pending')
    .eq('requester_id', userId);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ ...row, friend_profile: row.addressee }));
}

export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('blocked_users').insert({ blocker_id: blockerId, blocked_id: blockedId });
  if (error) throw error;
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('blocked_users')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);
  if (error) throw error;
}

export async function isUserBlockedByMe(myId: string, otherId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('blocked_users')
    .select('blocker_id')
    .eq('blocker_id', myId)
    .eq('blocked_id', otherId)
    .maybeSingle();
  return !!data;
}

export async function areFriends(userA: string, userB: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('are_friends', { p_user_a: userA, p_user_b: userB });
  if (error) throw error;
  return !!data;
}
