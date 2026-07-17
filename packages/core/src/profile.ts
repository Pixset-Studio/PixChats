import { getSupabaseClient } from './supabaseClient';
import { checkUsernameAvailable } from './auth';
import type { Profile } from './types';

export interface UpdateProfileParams {
  displayName?: string;
  username?: string;
  bio?: string;
}

/** Смена отображаемого имени, юзернейма и/или описания профиля. */
export async function updateProfile(userId: string, params: UpdateProfileParams): Promise<void> {
  const supabase = getSupabaseClient();
  const patch: Record<string, string> = {};

  if (params.username) {
    const check = await checkUsernameAvailable(params.username);
    if (!check.available) {
      throw new Error(
        check.reason === 'invalid_format'
          ? 'Юзернейм должен быть 5-32 символа: латиница, цифры, подчёркивание'
          : 'Этот юзернейм уже занят'
      );
    }
    patch.username = params.username;
  }
  if (params.displayName) {
    patch.display_name = params.displayName;
  }
  if (params.bio !== undefined) {
    patch.bio = params.bio;
  }

  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) throw error;
}

/** Загружает новый файл аватара в Storage (бакет avatars/<userId>/...) и обновляет profiles.avatar_url. */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const supabase = getSupabaseClient();
  const ext = file.name.split('.').pop() ?? 'png';
  const path = `${userId}/avatar.${ext}`;

  const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, {
    upsert: true,
    cacheControl: '3600',
  });
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path);
  const avatarUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`; // бастер кэша, чтобы новая аватарка сразу отобразилась

  const { error: updateError } = await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', userId);
  if (updateError) throw updateError;

  return avatarUrl;
}

export async function setTheme(userId: string, theme: 'dark' | 'light'): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('profiles').update({ theme }).eq('id', userId);
  if (error) throw error;

  if (typeof window !== 'undefined') {
    localStorage.setItem('pixchats:theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export interface PrivacySettings {
  privacy_who_can_message: 'everyone' | 'friends_only';
  privacy_show_last_seen: 'everyone' | 'friends_only' | 'nobody';
}

export async function updatePrivacySettings(userId: string, settings: PrivacySettings): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('profiles').update(settings).eq('id', userId);
  if (error) throw error;
}
