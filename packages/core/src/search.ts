import { getSupabaseClient } from './supabaseClient';
import type { Profile, Chat } from './types';

export interface SearchResultUser {
  kind: 'user';
  profile: Profile;
}
export interface SearchResultChat {
  kind: 'chat';
  chat: Chat;
}
export type SearchResult = SearchResultUser | SearchResultChat;

/**
 * Если запрос начинается с "@" — ищет по юзернейму (пользователи и публичные чаты).
 * Иначе — по отображаемому имени пользователя / названию чата.
 */
export async function globalSearch(query: string, myUserId: string): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const supabase = getSupabaseClient();
  const byUsername = trimmed.startsWith('@');
  const term = byUsername ? trimmed.slice(1) : trimmed;
  if (!term) return [];

  const userQuery = supabase
    .from('profiles')
    .select('*')
    .ilike(byUsername ? 'username' : 'display_name', `%${term}%`)
    .neq('id', myUserId)
    .limit(15);

  const chatQuery = supabase
    .from('chats')
    .select('*')
    .eq('visibility', 'public')
    .ilike(byUsername ? 'username' : 'title', `%${term}%`)
    .limit(15);

  const [{ data: users, error: userError }, { data: chats, error: chatError }] = await Promise.all([
    userQuery,
    chatQuery,
  ]);
  if (userError) throw userError;
  if (chatError) throw chatError;

  return [
    ...(users ?? []).map((p): SearchResultUser => ({ kind: 'user', profile: p as Profile })),
    ...(chats ?? []).map((c): SearchResultChat => ({ kind: 'chat', chat: c as Chat })),
  ];
}
