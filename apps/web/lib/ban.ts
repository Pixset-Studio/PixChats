import type { Profile } from '@pixchats/core';

export function isBanned(profile: Pick<Profile, 'banned_permanently' | 'banned_until'>): boolean {
  if (profile.banned_permanently) return true;
  if (profile.banned_until && new Date(profile.banned_until) > new Date()) return true;
  return false;
}
