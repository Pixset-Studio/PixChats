import { getSupabaseClient } from './supabaseClient';
import type { Chat, ChatType, ChatVisibility, Profile } from './types';

export interface CreateChatParams {
  type: Extract<ChatType, 'group' | 'channel'>;
  visibility: ChatVisibility;
  title: string;
  description?: string;
  username?: string; // обязателен для public, игнорируется для private
}

/**
 * Создаёт группу или канал и добавляет создателя как owner в chat_members.
 * Для direct-чатов используйте createDirectChat.
 */
export async function createChat(params: CreateChatParams): Promise<Chat> {
  const supabase = getSupabaseClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error('Нужно войти в аккаунт');

  if (params.visibility === 'public' && !params.username) {
    throw new Error('Для публичной группы/канала обязателен @username');
  }

  const { data: chat, error } = await supabase
    .from('chats')
    .insert({
      type: params.type,
      visibility: params.visibility,
      title: params.title,
      description: params.description ?? null,
      username: params.visibility === 'public' ? params.username : null,
      created_by: userId,
    })
    .select()
    .single();
  if (error) throw error;

  const { error: memberError } = await supabase.from('chat_members').insert({
    chat_id: chat.id,
    user_id: userId,
    member_role: 'owner',
  });
  if (memberError) throw memberError;

  return chat as Chat;
}

/** Создаёт (или возвращает существующий) личный чат с другим пользователем. */
export async function createDirectChat(otherUserId: string): Promise<Chat> {
  const supabase = getSupabaseClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error('Нужно войти в аккаунт');

  // Проверка приватности: если у собеседника стоит "только друзья", а мы не друзья — отказ.
  const { data: otherProfile, error: profileError } = await supabase
    .from('profiles')
    .select('privacy_who_can_message')
    .eq('id', otherUserId)
    .single();
  if (profileError) throw profileError;

  if (otherProfile.privacy_who_can_message === 'friends_only') {
    const { data: friendCheck } = await supabase.rpc('are_friends', { p_user_a: userId, p_user_b: otherUserId });
    if (!friendCheck) {
      throw new Error('Этот пользователь принимает сообщения только от друзей');
    }
  }

  // Ищем уже существующий direct-чат между этими двумя пользователями
  const { data: myChats } = await supabase
    .from('chat_members')
    .select('chat_id, chats!inner(type)')
    .eq('user_id', userId)
    .eq('chats.type', 'direct');

  for (const row of myChats ?? []) {
    const { data: members } = await supabase
      .from('chat_members')
      .select('user_id')
      .eq('chat_id', (row as any).chat_id);
    const ids = (members ?? []).map((m) => m.user_id);
    if (ids.includes(otherUserId) && ids.length === 2) {
      const { data: existing } = await supabase.from('chats').select('*').eq('id', (row as any).chat_id).single();
      if (existing) return existing as Chat;
    }
  }

  const { data: chat, error } = await supabase
    .from('chats')
    .insert({ type: 'direct', created_by: userId })
    .select()
    .single();
  if (error) throw error;

  await supabase.from('chat_members').insert([
    { chat_id: chat.id, user_id: userId, member_role: 'member' },
    { chat_id: chat.id, user_id: otherUserId, member_role: 'member' },
  ]);

  return chat as Chat;
}

/** Для списка direct-чатов: профиль собеседника по каждому chat_id (не свой). */
export async function getDirectChatPartners(chatIds: string[], myUserId: string): Promise<Record<string, Profile>> {
  if (chatIds.length === 0) return {};
  const supabase = getSupabaseClient();

  const { data: memberRows, error: memberError } = await supabase
    .from('chat_members')
    .select('chat_id, user_id')
    .in('chat_id', chatIds)
    .neq('user_id', myUserId);
  if (memberError) throw memberError;

  const partnerIds = Array.from(new Set((memberRows ?? []).map((r) => r.user_id)));
  if (partnerIds.length === 0) return {};

  const { data: profiles, error: profileError } = await supabase.from('profiles').select('*').in('id', partnerIds);
  if (profileError) throw profileError;

  const profileById: Record<string, Profile> = {};
  for (const p of profiles ?? []) profileById[p.id] = p as Profile;

  const result: Record<string, Profile> = {};
  for (const row of memberRows ?? []) {
    if (profileById[row.user_id]) result[row.chat_id] = profileById[row.user_id];
  }
  return result;
}
export async function searchPublicChats(query: string): Promise<Chat[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('chats')
    .select('*')
    .eq('visibility', 'public')
    .or(`title.ilike.%${query}%,username.ilike.%${query}%`)
    .limit(20);
  if (error) throw error;
  return (data ?? []) as Chat[];
}

/** Вступление в публичную группу/канал. В канале — сразу как subscriber (read-only). */
export async function joinPublicChat(chat: Chat): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error('Нужно войти в аккаунт');

  const { error } = await supabase.from('chat_members').insert({
    chat_id: chat.id,
    user_id: userId,
    member_role: chat.type === 'channel' ? 'subscriber' : 'member',
  });
  if (error) throw error;
}
