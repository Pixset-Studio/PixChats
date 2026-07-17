import type { Profile } from '@pixchats/core';
import { areFriends } from '@pixchats/core';

/** Форматирует last_seen без учёта приватности — использовать только когда видимость уже разрешена. */
export function formatLastSeenRaw(profile: Pick<Profile, 'last_seen'>): string {
  if (!profile.last_seen) return 'давно не был(а) в сети';

  const lastSeen = new Date(profile.last_seen);
  const now = new Date();
  const diffMs = now.getTime() - lastSeen.getTime();

  if (diffMs < 5 * 60 * 1000) return 'в сети';

  const isToday = lastSeen.toDateString() === now.toDateString();
  const time = lastSeen.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `был(а) в ${time}`;

  const date = lastSeen.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  return `был(а) ${date} в ${time}`;
}

/**
 * Определяет, можно ли viewerId видеть время захода target, и возвращает готовую строку.
 * Правила: 'everyone' — видно всем; 'friends_only' — только друзьям; 'nobody' — никому
 * (кроме самого владельца профиля, он всегда видит своё).
 */
export async function resolveLastSeenLabel(target: Profile, viewerId: string): Promise<string> {
  if (target.id === viewerId) return formatLastSeenRaw(target);

  if (target.privacy_show_last_seen === 'nobody') return 'скрыто';

  if (target.privacy_show_last_seen === 'friends_only') {
    const friends = await areFriends(viewerId, target.id);
    if (!friends) return 'скрыто';
  }

  return formatLastSeenRaw(target);
}
