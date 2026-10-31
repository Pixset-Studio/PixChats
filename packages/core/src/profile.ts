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
    const { data: current } = await supabase.from('profiles').select('username').eq('id', userId).single();
    if (current?.username !== params.username) {
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

export type AppTheme = 'pixchats' | 'byte_blaster' | 'matrix' | 'crimson' | 'midnight' | 'dark' | 'light';

export async function setTheme(userId: string, theme: AppTheme): Promise<void> {
  // Сначала применяем тему визуально (с плавным переходом цветов), потом сохраняем в профиль —
  // так переключение мгновенное и не зависит от скорости сети.
  if (typeof window !== 'undefined') {
    const root = document.documentElement;
    root.classList.add('theme-transition');
    localStorage.setItem('pixchats:theme', theme);
    root.setAttribute('data-theme', theme);
    window.setTimeout(() => root.classList.remove('theme-transition'), 450);
  }

  const supabase = getSupabaseClient();
  try {
    // В базе данных колонка theme может иметь check (dark, light) — если новая тема, сохраняем dark как совместимость
    const dbTheme = (theme === 'light') ? 'light' : 'dark';
    await supabase.from('profiles').update({ theme: dbTheme }).eq('id', userId);
  } catch (err) {
    console.warn('Could not persist theme to profiles table:', err);
  }
}

export interface PrivacySettings {
  privacy_who_can_message: 'everyone' | 'friends_only' | 'nobody';
  privacy_show_last_seen: 'everyone' | 'friends_only' | 'nobody';
  privacy_who_can_add_to_groups: 'everyone' | 'friends_only' | 'nobody';
}

export async function updatePrivacySettings(userId: string, settings: PrivacySettings): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('profiles').update(settings).eq('id', userId);
  if (error) throw error;
}
