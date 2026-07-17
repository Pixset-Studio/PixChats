import type { Profile } from '@pixchats/core';

/** "в сети", "был(а) в 14:32" или "недавно", если пользователь скрыл last_seen. */
export function formatLastSeen(profile: Pick<Profile, 'last_seen' | 'privacy_show_last_seen'>): string {
  if (!profile.privacy_show_last_seen || !profile.last_seen) return 'недавно';

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
