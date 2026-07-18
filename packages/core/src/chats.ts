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

  const pairKey = [userId, otherUserId].sort().join(':');

  // Если чат уже существует — просто возвращаем его, приватность собеседника
  // на продолжение уже начатой переписки не влияет.
  const { data: existingChat } = await supabase.from('chats').select('*').eq('direct_pair_key', pairKey).maybeSingle();
  if (existingChat) return existingChat as Chat;

  // Приватность проверяем только при создании НОВОЙ переписки.
  const { data: otherProfile, error: profileError } = await supabase
    .from('profiles')
    .select('privacy_who_can_message')
    .eq('id', otherUserId)
    .single();
  if (profileError) throw profileError;

  if (otherProfile.privacy_who_can_message === 'nobody') {
    throw new Error('Этот пользователь не принимает сообщения от новых собеседников');
  }
  const { data: blockedByThem } = await supabase.rpc('is_blocked', { p_blocker: otherUserId, p_blocked: userId });
  if (blockedByThem) throw new Error('Вы не можете написать этому пользователю');
  const { data: blockedByMe } = await supabase.rpc('is_blocked', { p_blocker: userId, p_blocked: otherUserId });
  if (blockedByMe) throw new Error('Вы заблокировали этого пользователя — сначала разблокируйте его в профиле');
  if (otherProfile.privacy_who_can_message === 'friends_only') {
    const { data: friendCheck } = await supabase.rpc('are_friends', { p_user_a: userId, p_user_b: otherUserId });
    if (!friendCheck) {
      throw new Error('Этот пользователь принимает сообщения только от друзей');
    }
  }

  const { data: chat, error } = await supabase
    .from('chats')
    .insert({ type: 'direct', created_by: userId, direct_pair_key: pairKey })
    .select()
    .single();

  if (error) {
    // 23505 = unique_violation — параллельный запрос успел создать чат первым, просто возвращаем его
    if ((error as any).code === '23505') {
      const { data: existing, error: fetchError } = await supabase
        .from('chats')
        .select('*')
        .eq('direct_pair_key', pairKey)
        .single();
      if (fetchError) throw fetchError;
      return existing as Chat;
    }
    throw error;
  }

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
/** Подсчёт участников/подписчиков чата (доступно только его участникам — того требует RLS). */
export async function getChatMemberCount(chatId: string): Promise<number> {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from('chat_members')
    .select('*', { count: 'exact', head: true })
    .eq('chat_id', chatId);
  if (error) throw error;
  return count ?? 0;
}

/** Роль текущего пользователя в конкретном чате (null, если не состоит). */
export async function getMyChatRole(chatId: string, userId: string): Promise<string | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('chat_members')
    .select('member_role')
    .eq('chat_id', chatId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.member_role ?? null;
}

export interface UpdateChatInfoParams {
  title?: string;
  description?: string;
  username?: string | null;
}

/** Редактирование названия/описания/юзернейма группы или канала. RLS дополнительно проверяет права owner/admin. */
export async function updateChatInfo(chatId: string, params: UpdateChatInfoParams): Promise<void> {
  const supabase = getSupabaseClient();
  const patch: Record<string, string | null> = {};
  if (params.title !== undefined) patch.title = params.title;
  if (params.description !== undefined) patch.description = params.description;
  if (params.username !== undefined) patch.username = params.username;

  const { error } = await supabase.from('chats').update(patch).eq('id', chatId);
  if (error) throw error;
}

/** Загрузка нового аватара группы/канала в бакет chat-avatars (папка = chatId). RLS: только owner/admin. */
export async function uploadChatAvatar(chatId: string, file: File): Promise<string> {
  const supabase = getSupabaseClient();
  const ext = file.name.split('.').pop() ?? 'png';
  const path = `${chatId}/avatar.${ext}`;

  const { error: uploadError } = await supabase.storage.from('chat-avatars').upload(path, file, {
    upsert: true,
    cacheControl: '3600',
  });
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from('chat-avatars').getPublicUrl(path);
  const avatarUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;

  const { error: updateError } = await supabase.from('chats').update({ avatar_url: avatarUrl }).eq('id', chatId);
  if (updateError) throw updateError;

  return avatarUrl;
}

/** Выйти из группы или отписаться от канала. */
export async function leaveChat(chatId: string, userId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('chat_members').delete().eq('chat_id', chatId).eq('user_id', userId);
  if (error) throw error;
}

/** Список участников/подписчиков чата — для отображения списком (кликабельно на профиль). */
export async function getChatMembers(chatId: string): Promise<Profile[]> {
  const supabase = getSupabaseClient();
  const { data: memberRows, error } = await supabase.from('chat_members').select('user_id').eq('chat_id', chatId);
  if (error) throw error;
  const ids = (memberRows ?? []).map((r) => r.user_id);
  if (ids.length === 0) return [];
  const { data: profiles, error: profileError } = await supabase.from('profiles').select('*').in('id', ids);
  if (profileError) throw profileError;
  return (profiles ?? []) as Profile[];
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
