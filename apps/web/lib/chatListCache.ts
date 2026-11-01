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
}

let cache: ChatListCache | null = null;

export function getChatListCache(): ChatListCache | null {
  return cache;
}

export function setChatListCache(value: ChatListCache): void {
  cache = value;
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
