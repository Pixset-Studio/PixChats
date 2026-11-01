import { getSupabaseClient } from './supabaseClient';
import { checkUsernameAvailable, getCachedCurrentProfile, setCachedCurrentProfile } from './auth';
import type { Profile } from './types';

export interface UpdateProfileParams {
  displayName?: string;
  username?: string;
  bio?: string;
  avatarUrl?: string;
}

/** Смена отображаемого имени, юзернейма, описания и/или Base64-аватара профиля. */
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
  if (params.avatarUrl !== undefined) {
    patch.avatar_url = params.avatarUrl;
  }

  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) throw error;

  const cached = getCachedCurrentProfile();
  if (cached && cached.id === userId) {
    setCachedCurrentProfile({ ...cached, ...patch });
  }
}

/** Конвертирует файл в сжатый Base64 Data URL (без загрузки в Supabase Storage) и сохраняет в profiles.avatar_url. */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
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

  const { error: updateError } = await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', userId);
  if (updateError) throw updateError;

  const cached = getCachedCurrentProfile();
  if (cached && cached.id === userId) {
    setCachedCurrentProfile({ ...cached, avatar_url: avatarUrl });
  }

  return avatarUrl;
}

export type AppTheme = 'pixchats' | 'industrial' | 'arcade' | 'minimal' | 'byteblaster' | 'byte_blaster' | 'dark' | 'light';

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

  const cached = getCachedCurrentProfile();
  if (cached && cached.id === userId) {
    setCachedCurrentProfile({ ...cached, ...settings });
  }
}
