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

// Лёгкий список колонок профиля без тяжёлого массива одноразовых криптоключей public_one_time_prekeys
const LIGHT_PROFILE_FIELDS =
  'id, username, display_name, bio, avatar_url, role, is_verified, is_pixset_staff, custom_badge_text, custom_role_id, banned_until, ban_reason, frozen, frozen_reason, moderator_comment, privacy_who_can_message, privacy_show_last_seen, privacy_who_can_add_to_groups, last_seen, theme, created_at';

const profileByIdCache = new Map<string, { profile: Profile; fetchedAt: number }>();
const directPartnerIdByChatCache = new Map<string, string>();

/** Для списка direct-чатов: профиль собеседника по каждому chat_id (не свой) с кэшированием в памяти. */
export async function getDirectChatPartners(chatIds: string[], myUserId: string): Promise<Record<string, Profile>> {
  if (chatIds.length === 0) return {};
  const supabase = getSupabaseClient();
  const now = Date.now();

  const missingMemberChatIds = chatIds.filter((cid) => !directPartnerIdByChatCache.has(`${myUserId}:${cid}`));
  if (missingMemberChatIds.length > 0) {
    const { data: memberRows, error: memberError } = await supabase
      .from('chat_members')
      .select('chat_id, user_id')
      .in('chat_id', missingMemberChatIds)
      .neq('user_id', myUserId);
    if (memberError) throw memberError;
    for (const row of memberRows ?? []) {
      directPartnerIdByChatCache.set(`${myUserId}:${row.chat_id}`, row.user_id);
    }
  }

  const partnerIdByChat: Record<string, string> = {};
  const partnerIdsSet = new Set<string>();
  for (const cid of chatIds) {
    const pid = directPartnerIdByChatCache.get(`${myUserId}:${cid}`);
    if (pid) {
      partnerIdByChat[cid] = pid;
      partnerIdsSet.add(pid);
    }
  }

  const partnerIds = Array.from(partnerIdsSet);
  if (partnerIds.length === 0) return {};

  const missingProfileIds = partnerIds.filter((pid) => {
    const cached = profileByIdCache.get(pid);
    return !cached || now - cached.fetchedAt > 180_000;
  });

  if (missingProfileIds.length > 0) {
    let { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select(LIGHT_PROFILE_FIELDS)
      .in('id', missingProfileIds);
    if (profileError) {
      const fallback = await supabase.from('profiles').select('*').in('id', missingProfileIds);
      profiles = fallback.data as any;
    }
    for (const p of (profiles ?? []) as any[]) {
      profileByIdCache.set(p.id, { profile: p as Profile, fetchedAt: now });
    }
  }

  const result: Record<string, Profile> = {};
  for (const cid of chatIds) {
    const pid = partnerIdByChat[cid];
    const cached = pid ? profileByIdCache.get(pid) : undefined;
    if (cached) result[cid] = cached.profile;
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
  avatarUrl?: string | null;
}

/** Редактирование названия/описания/юзернейма/Base64-аватара группы или канала. RLS дополнительно проверяет права owner/admin. */
export async function updateChatInfo(chatId: string, params: UpdateChatInfoParams): Promise<void> {
  const supabase = getSupabaseClient();
  const patch: Record<string, string | null> = {};
  if (params.title !== undefined) patch.title = params.title;
  if (params.description !== undefined) patch.description = params.description;
  if (params.username !== undefined) patch.username = params.username;
  if (params.avatarUrl !== undefined) patch.avatar_url = params.avatarUrl;

  const { error } = await supabase.from('chats').update(patch).eq('id', chatId);
  if (error) throw error;
}

/** Конвертирует аватар группы/канала в сжатый Base64 Data URL (без загрузки в Supabase Storage) и сохраняет в chats.avatar_url. */
export async function uploadChatAvatar(chatId: string, file: File): Promise<string> {
  const supabase = getSupabaseClient();
  const avatarUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл аватара'));
    reader.onload = () => {
      if (typeof document === 'undefined') {
        resolve(String(reader.result));
        return;
      }
      const img = new Image();
      img.onerror = () => resolve(String(reader.result));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        const target = Math.min(256, minDim);
        canvas.width = target;
        canvas.height = target;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, target, target);
        resolve(canvas.toDataURL('image/webp', 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

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

/** Полное удаление группы/канала (только владелец). Сообщения и участники уходят каскадом. */
export async function deleteChat(chatId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('chats').delete().eq('id', chatId);
  if (error) throw error;
}

/**
 * Добавить пользователя в группу/канал напрямую (owner/admin чата).
 * Учитывает приватность добавляемого (privacy_who_can_add_to_groups):
 * 'nobody' — отказ, 'friends_only' — только если добавляющий у него в друзьях.
 */
export async function addMemberToChat(chatId: string, targetUserId: string, actingUserId: string, chatType: string): Promise<void> {
  const supabase = getSupabaseClient();

  const { data: targetProfile, error: profileError } = await supabase
    .from('profiles')
    .select('privacy_who_can_add_to_groups')
    .eq('id', targetUserId)
    .single();
  if (profileError) throw profileError;

  if (targetProfile.privacy_who_can_add_to_groups === 'nobody') {
    throw new Error('Этот пользователь запретил добавлять себя в группы/каналы');
  }
  if (targetProfile.privacy_who_can_add_to_groups === 'friends_only') {
    const { data: friendCheck } = await supabase.rpc('are_friends', { p_user_a: actingUserId, p_user_b: targetUserId });
    if (!friendCheck) {
      throw new Error('Этот пользователь принимает добавление в группы только от друзей');
    }
  }

  const { error } = await supabase.from('chat_members').insert({
    chat_id: chatId,
    user_id: targetUserId,
    member_role: chatType === 'channel' ? 'subscriber' : 'member',
  });
  if (error) throw error;
}

/** Удалить участника/подписчика из чата (владелец/админ). RLS также разрешает self-leave. */
export async function removeMember(chatId: string, targetUserId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('chat_members').delete().eq('chat_id', chatId).eq('user_id', targetUserId);
  if (error) throw error;
}

/** Список участников/подписчиков чата — для отображения списком (кликабельно на профиль). */
export async function getChatMembers(chatId: string): Promise<Profile[]> {
  const supabase = getSupabaseClient();
  const { data: memberRows, error } = await supabase.from('chat_members').select('user_id').eq('chat_id', chatId);
  if (error) throw error;
  const ids = (memberRows ?? []).map((r) => r.user_id);
  if (ids.length === 0) return [];
  const now = Date.now();
  const missingIds = ids.filter((id) => {
    const cached = profileByIdCache.get(id);
    return !cached || now - cached.fetchedAt > 120_000;
  });
  if (missingIds.length > 0) {
    let { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select(LIGHT_PROFILE_FIELDS)
      .in('id', missingIds);
    if (profileError) {
      const fallback = await supabase.from('profiles').select('*').in('id', missingIds);
      profiles = fallback.data as any;
    }
    for (const p of (profiles ?? []) as any[]) {
      profileByIdCache.set(p.id, { profile: p as Profile, fetchedAt: now });
    }
  }
  return ids.map((id) => profileByIdCache.get(id)?.profile).filter(Boolean) as Profile[];
}

/** Найти id уже существующего личного чата с пользователем, не создавая новый. */
export async function getExistingDirectChatId(userId: string, otherUserId: string): Promise<string | null> {
  const supabase = getSupabaseClient();
  const pairKey = [userId, otherUserId].sort().join(':');
  const { data } = await supabase.from('chats').select('id').eq('direct_pair_key', pairKey).maybeSingle();
  return data?.id ?? null;
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

/** Проверяет, является ли чат личным облаком «Избранное» (Сохранённые сообщения). */
export function isSavedMessagesChat(chat: Chat | null | undefined, myUserId?: string): boolean {
  if (!chat) return false;
  if (chat.type === 'direct' && chat.title === 'Избранное') return true;
  if (myUserId && chat.direct_pair_key === `${myUserId}:${myUserId}`) return true;
  if (chat.direct_pair_key) {
    const parts = chat.direct_pair_key.split(':');
    if (parts.length === 2 && parts[0] && parts[0] === parts[1]) return true;
  }
  return false;
}

/** Возвращает (или создаёт) личный облачный чат «Избранное» (Сохранённые сообщения) с самим собой. */
export async function getOrCreateSavedMessagesChat(userId?: string): Promise<Chat> {
  const supabase = getSupabaseClient();
  let uid = userId;
  if (!uid) {
    const { data: sessionData } = await supabase.auth.getSession();
    uid = sessionData.session?.user.id;
  }
  if (!uid) throw new Error('Нужно войти в аккаунт');

  const pairKey = `${uid}:${uid}`;
  const { data: existing } = await supabase
    .from('chats')
    .select('*')
    .eq('direct_pair_key', pairKey)
    .maybeSingle();

  if (existing) {
    // Убедимся, что пользователь числится в chat_members
    await supabase
      .from('chat_members')
      .upsert(
        { chat_id: existing.id, user_id: uid, member_role: 'owner' },
        { onConflict: 'chat_id,user_id' }
      )
      .then(() => {});
    return existing as Chat;
  }

  const { data: created, error } = await supabase
    .from('chats')
    .insert({
      type: 'direct',
      title: 'Избранное',
      description: 'Личное облачное хранилище заметок, пересланных сообщений и файлов',
      created_by: uid,
      direct_pair_key: pairKey,
    })
    .select()
    .single();

  if (error) {
    if ((error as any).code === '23505') {
      const { data: retry } = await supabase
        .from('chats')
        .select('*')
        .eq('direct_pair_key', pairKey)
        .single();
      if (retry) return retry as Chat;
    }
    throw error;
  }

  await supabase.from('chat_members').insert({
    chat_id: created.id,
    user_id: uid,
    member_role: 'owner',
  });

  return created as Chat;
}

