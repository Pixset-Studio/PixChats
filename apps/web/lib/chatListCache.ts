import type { Chat, Profile, Message, MuteState } from '@pixchats/core';

/**
 * Кэш списка чатов на уровне модуля. На ПК-раскладке ChatListPanel пересоздаётся при каждом
 * переходе между страницами — без кэша список каждый раз мигал бы скелетоном и заново
 * проигрывал каскадную анимацию. С кэшем он появляется мгновенно и обновляется в фоне.
 */
export interface ChatListCache {
  profile: Profile;
  chats: Chat[];
  previews: Record<string, Message>;
  partners: Record<string, Profile>;
  unreadCounts: Record<string, number>;
  muteStates: Record<string, MuteState>;
  fetchedAt?: number;
}

let cache: ChatListCache | null = null;

export function getChatListCache(): ChatListCache | null {
  return cache;
}

export function isChatListCacheFresh(maxAgeMs = 90_000): boolean {
  if (!cache || !cache.fetchedAt) return false;
  return Date.now() - cache.fetchedAt < maxAgeMs;
}

export function setChatListCache(value: ChatListCache): void {
  cache = {
    ...value,
    fetchedAt: value.fetchedAt ?? Date.now(),
  };
}

/** Вызывать при выходе из аккаунта, чтобы следующий пользователь не увидел чужой список. */
export function clearChatListCache(): void {
  cache = null;
}

/** Мгновенно обнуляет счётчик непрочитанных для указанного чата в кэше списка чатов. */
export function clearUnreadInChatListCache(chatId: string): void {
  if (!cache || !chatId) return;
  if (cache.unreadCounts && cache.unreadCounts[chatId]) {
    cache = {
      ...cache,
      unreadCounts: {
        ...cache.unreadCounts,
        [chatId]: 0,
      },
    };
  }
}
