import { getSupabaseClient } from './supabaseClient';

export const PIXSET_STUDIO_SUPABASE_URL = 'https://zyjhvuhovimorpokiwty.supabase.co';
export const PIXSET_STUDIO_SUPABASE_KEY = 'sb_publishable_1bj04J3qsO1EqsKPQeSbmg_cBDEtreK';

export interface PixsetStudioAccount {
  id: string;
  email?: string;
  nickname: string;
  avatar_url?: string | null;
  is_admin?: boolean;
  bio?: string | null;
  country?: string | null;
  access_token?: string;
}

/**
 * Аутентификация через учётную запись Pixset Studio (https://pixset-studio.github.io).
 * Поддерживает вход как по Email, так и по Nickname.
 */
export async function authenticateWithPixsetStudio(loginId: string, password: string): Promise<PixsetStudioAccount> {
  const id = String(loginId || '').trim();
  if (!id) throw new Error('Введите никнейм или email аккаунта Pixset Studio');
  if (!password) throw new Error('Введите пароль от аккаунта Pixset Studio');

  let accessToken: string | null = null;
  let userId: string | null = null;
  let userEmail: string | undefined = undefined;

  if (id.includes('@')) {
    // Вход по почте через Auth API Pixset Studio
    const res = await fetch(`${PIXSET_STUDIO_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: PIXSET_STUDIO_SUPABASE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: id, password }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.access_token) {
      throw new Error(data?.msg || data?.error_description || 'Неверный email или пароль Pixset Studio');
    }
    accessToken = data.access_token;
    userId = data.user?.id;
    userEmail = data.user?.email;
  } else {
    // Вход по никнейму через серверную функцию login-nick студии
    const res = await fetch(`${PIXSET_STUDIO_SUPABASE_URL}/functions/v1/login-nick`, {
      method: 'POST',
      headers: {
        apikey: PIXSET_STUDIO_SUPABASE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ login: id, password }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.access_token) {
      throw new Error(
        data?.error === 'invalid_credentials'
          ? 'Неверный никнейм или пароль Pixset Studio'
          : (data?.error || 'Не удалось войти в аккаунт Pixset Studio')
      );
    }
    accessToken = data.access_token;
    userId = data.user?.id;
    userEmail = data.user?.email;
  }

  if (!accessToken || !userId) {
    throw new Error('Не удалось получить сессию Pixset Studio');
  }

  // Запрашиваем профиль игрока/пользователя из базы данных Pixset Studio
  let nickname = id.includes('@') ? id.split('@')[0] : id;
  let avatarUrl: string | null = null;
  let isAdmin = false;
  let bio: string | null = null;
  let country: string | null = null;

  try {
    const profRes = await fetch(
      `${PIXSET_STUDIO_SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=nickname,avatar_url,is_admin,country,bio`,
      {
        headers: {
          apikey: PIXSET_STUDIO_SUPABASE_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (profRes.ok) {
      const rows = await profRes.json();
      if (Array.isArray(rows) && rows[0]) {
        const row = rows[0];
        if (row.nickname) nickname = row.nickname;
        avatarUrl = row.avatar_url || null;
        isAdmin = !!row.is_admin;
        bio = row.bio || null;
        country = row.country || null;
      }
    }
  } catch (e) {
    console.warn('Не удалось загрузить детальный профиль Pixset Studio:', e);
  }

  return {
    id: userId,
    email: userEmail,
    nickname,
    avatar_url: avatarUrl,
    is_admin: isAdmin,
    bio,
    country,
    access_token: accessToken,
  };
}

/**
 * Полный вход в PixChats с учётной записью Pixset Studio.
 * Синхронизирует профиль, никнейм, аватар и бейдж сотрудника Pixset Studio.
 */
export async function signInWithPixsetStudioAccount(loginId: string, password: string): Promise<PixsetStudioAccount> {
  const pixsetAccount = await authenticateWithPixsetStudio(loginId, password);

  // Сохраняем привязанный аккаунт студии в localStorage
  if (typeof window !== 'undefined') {
    localStorage.setItem(
      'pixchats:pixset_account',
      JSON.stringify({
        id: pixsetAccount.id,
        nickname: pixsetAccount.nickname,
        email: pixsetAccount.email,
        avatar_url: pixsetAccount.avatar_url,
        is_admin: pixsetAccount.is_admin,
        linkedAt: new Date().toISOString(),
      })
    );
  }

  // Авторизуем в Supabase PixChats (если он доступен)
  try {
    const supabase = getSupabaseClient();
    const internalEmail = pixsetAccount.email || `pixset_${pixsetAccount.nickname.toLowerCase()}@pixset.studio`;

    // Сначала пробуем войти
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: internalEmail,
      password,
    });

    if (signInError || !signInData.user) {
      // Если пользователя ещё нет в PixChats — регистрируем его
      const normalizedUsername = pixsetAccount.nickname
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .toLowerCase()
        .padEnd(5, '0')
        .slice(0, 32);

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: internalEmail,
        password,
        options: {
          data: {
            username: normalizedUsername,
            display_name: pixsetAccount.nickname,
            privacy_accepted: 'true',
          },
        },
      });

      if (!signUpError && signUpData.user) {
        await supabase.from('profiles').upsert({
          id: signUpData.user.id,
          username: normalizedUsername,
          display_name: pixsetAccount.nickname,
          avatar_url: pixsetAccount.avatar_url,
          is_pixset_employee: !!pixsetAccount.is_admin,
          bio: pixsetAccount.bio || `Учётная запись Pixset Studio (@${pixsetAccount.nickname})`,
        });
      }
    } else if (signInData.user) {
      if (pixsetAccount.is_admin) {
        await supabase.from('profiles').update({ is_pixset_employee: true }).eq('id', signInData.user.id);
      }
    }
  } catch (err) {
    console.warn('[PixChats] Supabase integration note:', err);
  }

  return pixsetAccount;
}

/** Проверяет, привязан ли аккаунт Pixset Studio */
export function getSavedPixsetStudioAccount(): PixsetStudioAccount | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('pixchats:pixset_account');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Отвязывает аккаунт Pixset Studio */
export function unlinkPixsetStudioAccount(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('pixchats:pixset_account');
  }
}
