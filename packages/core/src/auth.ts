import { getSupabaseClient } from './supabaseClient';
import { generateAndStoreKeyBundle } from './crypto';
import type { Profile } from './types';

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{5,32}$/;

export interface UsernameCheckResult {
  available: boolean;
  reason?: 'invalid_format' | 'taken';
}

/**
 * Проверка доступности @username до отправки формы регистрации.
 * Сравнение регистронезависимое (см. индекс lower(username) в миграции).
 */
export async function checkUsernameAvailable(username: string): Promise<UsernameCheckResult> {
  if (!USERNAME_PATTERN.test(username)) {
    return { available: false, reason: 'invalid_format' };
  }

  const supabase = getSupabaseClient();

  const { data: banned } = await supabase.from('banned_usernames').select('username').ilike('username', username).maybeSingle();
  if (banned) return { available: false, reason: 'taken' };

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .ilike('username', username)
    .maybeSingle();

  if (error) throw error;
  return { available: !data, reason: data ? 'taken' : undefined };
}

export interface SignUpParams {
  email: string;
  password: string;
  username: string;
  displayName: string;
  privacyAccepted: boolean;
}

/**
 * Регистрация по email. Создаёт auth.users-запись и профиль в одной операции.
 * Identity keys (X3DH bundle) генерируются на клиенте отдельно (Фаза 2) и
 * дозаписываются в profiles через updateProfileKeys — на этапе регистрации
 * достаточно базовых полей.
 */
export async function signUpWithEmail({ email, password, username, displayName, privacyAccepted }: SignUpParams) {
  const supabase = getSupabaseClient();

  const usernameCheck = await checkUsernameAvailable(username);
  if (!usernameCheck.available) {
    throw new Error(
      usernameCheck.reason === 'invalid_format'
        ? 'Юзернейм должен быть 5-32 символа: латиница, цифры, подчёркивание'
        : 'Этот юзернейм уже занят'
    );
  }
  if (!privacyAccepted) {
    throw new Error('Нужно принять политику конфиденциальности');
  }

  // username/display_name/privacy_accepted передаются как metadata — профиль создаст
  // триггер на БД (см. 0003/0012), это работает независимо от того, требуется ли
  // подтверждение email (пока не подтверждён — активной сессии нет).
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username, display_name: displayName, privacy_accepted: 'true' } },
  });
  if (authError) throw authError;
  if (!authData.user) throw new Error('Не удалось создать пользователя');

  // Генерация и загрузка identity key bundle возможна только если сессия уже активна
  // (email подтверждать не требуется — auto-confirm включён в настройках Supabase).
  // Если сессии нет, ключи будут сгенерированы при первом входе — см. ensureKeyBundle().
  if (authData.session) {
    const bundle = await generateAndStoreKeyBundle(authData.user.id);
    const { error: keysError } = await supabase
      .from('profiles')
      .update({
        public_identity_key: bundle.identityPublicKey,
        public_signed_prekey: bundle.signedPreKeyPublic,
        signed_prekey_signature: bundle.signedPreKeySignature,
        public_one_time_prekeys: bundle.oneTimePreKeysPublic,
      })
      .eq('id', authData.user.id);
    if (keysError) throw keysError;
  }

  return authData;
}

export async function signInWithEmail(email: string, password: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/** Подтверждение регистрации кодом из письма (вместо перехода по ссылке). */
export async function verifySignupCode(email: string, code: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: 'signup' });
  if (error) throw error;
  return data;
}
export async function requestLoginCode(email: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  if (error) throw error;
}

/** Проверяет введённый пользователем код из письма и завершает вход. */
export async function verifyLoginCode(email: string, code: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) throw error;
  return data;
}

/** Запрос сброса пароля (отправка ссылки или 6-значного OTP-кода восстановления на email). */
export async function requestPasswordReset(email: string, redirectTo?: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: redirectTo || (typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined),
  });
  if (error) throw error;
}

/** Подтверждение OTP-кода восстановления из письма и установка нового пароля. */
export async function verifyRecoveryCodeAndSetNewPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { data, error: otpError } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: code.trim(),
    type: 'recovery',
  });
  if (otpError) throw otpError;
  if (!data.session && !data.user) {
    throw new Error('Не удалось верифицировать сессию сброса пароля');
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
  });
  if (updateError) throw updateError;
}

/** Смена пароля для уже авторизованного пользователя или сессии сброса. */
export async function updateUserPassword(newPassword: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/** Google — нативный провайдер Supabase, включается тумблером в Dashboard. */
export async function signInWithGoogle(redirectTo?: string) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
  if (error) throw error;
}

/**
 * VK ID и Яндекс ID — через Supabase Custom OAuth/OIDC Providers.
 * Провайдер регистрируется в Supabase Dashboard (Authentication > Providers > Custom Providers)
 * под именами 'vk' и 'yandex' (алиасы задаются там же).
 * Если на практике окажется, что VK ID/Яндекс ID не полностью совместимы со стандартным
 * OIDC discovery — переключаем эти два вызова на Edge Function-обёртку без изменений в UI.
 */
export async function signInWithVK(redirectTo?: string) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'vk' as any,
    options: { redirectTo },
  });
  if (error) throw error;
}

export async function signInWithYandex(redirectTo?: string) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'yandex' as any,
    options: { redirectTo },
  });
  if (error) throw error;
}

const PROFILE_CACHE_STORAGE_KEY = 'pixchats:cached_my_profile_v1';
let memoryCachedProfile: Profile | null = null;
let memoryProfileFetchedAt = 0;
let lastSeenUpdatedAt = 0;
let inflightProfilePromise: Promise<Profile | null> | null = null;

export function getCachedCurrentProfile(): Profile | null {
  if (memoryCachedProfile) return memoryCachedProfile;
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Profile;
    if (parsed && parsed.id && parsed.username) {
      memoryCachedProfile = parsed;
      return parsed;
    }
  } catch {}
  return null;
}

export function setCachedCurrentProfile(profile: Profile | null): void {
  memoryCachedProfile = profile;
  memoryProfileFetchedAt = profile ? Date.now() : 0;
  if (typeof window === 'undefined') return;
  try {
    if (profile) {
      localStorage.setItem(PROFILE_CACHE_STORAGE_KEY, JSON.stringify(profile));
    } else {
      localStorage.removeItem(PROFILE_CACHE_STORAGE_KEY);
    }
    window.dispatchEvent(new CustomEvent('pixchats:profile_updated', { detail: profile }));
  } catch {}
}

export async function signOut() {
  setCachedCurrentProfile(null);
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Проверяет, есть ли у профиля уже загруженный identity key bundle, и если нет —
 * генерирует и загружает. Нужно на случай, если при регистрации не было активной
 * сессии (email ещё не подтверждён) — тогда ключи появятся при первом успешном входе.
 */
export const PROFILE_SELECT_WITHOUT_OTK =
  'id, username, display_name, bio, avatar_url, role, is_verified, verified_at, is_pixset_employee, banned_until, banned_permanently, frozen, privacy_who_can_message, privacy_show_last_seen, privacy_who_can_add_to_groups, last_seen, theme, created_at, public_identity_key, public_signed_prekey, signed_prekey_signature';

export function hydrateProfileRowEnvelopes(raw: any): Profile {
  if (!raw || typeof raw !== 'object') return raw as Profile;
  const p = { ...raw } as Profile;
  const admStr = typeof p.public_signed_prekey === 'string' ? p.public_signed_prekey : '';
  if (admStr.startsWith('pxadm:v1:')) {
    try {
      const parsed = JSON.parse(admStr.slice('pxadm:v1:'.length));
      if (parsed && typeof parsed === 'object') {
        if (parsed.penaltyMeta) {
          if (!p.ban_reason && parsed.penaltyMeta.banReason) p.ban_reason = parsed.penaltyMeta.banReason;
          if (!p.frozen_reason && parsed.penaltyMeta.frozenReason) p.frozen_reason = parsed.penaltyMeta.frozenReason;
          if (!p.frozen_at && parsed.penaltyMeta.frozenAt) p.frozen_at = parsed.penaltyMeta.frozenAt;
          if (!p.moderator_comment && parsed.penaltyMeta.moderatorComment) {
            p.moderator_comment = parsed.penaltyMeta.moderatorComment;
          }
        }
        if (!p.ban_reason && parsed.ban_reason) p.ban_reason = parsed.ban_reason;
        if (!p.frozen_reason && parsed.frozen_reason) p.frozen_reason = parsed.frozen_reason;
        if (!p.frozen_at && parsed.frozen_at) p.frozen_at = parsed.frozen_at;
        if (!p.moderator_comment && parsed.moderator_comment) p.moderator_comment = parsed.moderator_comment;
        if (Array.isArray(parsed.customRoleIds)) {
          p.custom_role_ids = parsed.customRoleIds;
        }
      }
    } catch {}
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('pixchats:profile_row_hydrated', { detail: p }));
    } catch {}
  }
  return p;
}

export async function ensureKeyBundle(profile: Profile): Promise<void> {
  if (profile.public_identity_key) return;

  const supabase = getSupabaseClient();
  const bundle = await generateAndStoreKeyBundle(profile.id);
  const patch: Record<string, any> = {
    public_identity_key: bundle.identityPublicKey,
    public_one_time_prekeys: bundle.oneTimePreKeysPublic,
  };
  if (!profile.public_signed_prekey || !profile.public_signed_prekey.startsWith('pxadm:')) {
    patch.public_signed_prekey = bundle.signedPreKeyPublic;
  }
  if (!profile.signed_prekey_signature || !profile.signed_prekey_signature.startsWith('pxext:')) {
    patch.signed_prekey_signature = bundle.signedPreKeySignature;
  }
  const { error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', profile.id);
  if (error) throw error;
}

export async function getCurrentProfile(forceRefresh = false): Promise<Profile | null> {
  const now = Date.now();
  if (!forceRefresh && memoryCachedProfile && now - memoryProfileFetchedAt < 180_000) {
    return memoryCachedProfile;
  }

  if (!forceRefresh && inflightProfilePromise) {
    return inflightProfilePromise;
  }

  inflightProfilePromise = (async () => {
    try {
      const supabase = getSupabaseClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        setCachedCurrentProfile(null);
        return null;
      }

      if (!forceRefresh && memoryCachedProfile && memoryCachedProfile.id === userId && Date.now() - memoryProfileFetchedAt < 180_000) {
        return memoryCachedProfile;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select(PROFILE_SELECT_WITHOUT_OTK)
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;

      const profile = data ? hydrateProfileRowEnvelopes(data) : null;
      setCachedCurrentProfile(profile);

      // Обновляем last_seen не чаще чем раз в 10 минут, чтобы экономить квоты Supabase
      if (profile && Date.now() - lastSeenUpdatedAt > 600_000) {
        lastSeenUpdatedAt = Date.now();
        supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', userId).then(() => {});
      }

      return profile;
    } finally {
      inflightProfilePromise = null;
    }
  })();

  return inflightProfilePromise;
}

/** true, если есть активная сессия (вошёл), независимо от того, создан ли уже profiles-профиль. */
export async function hasActiveSession(): Promise<boolean> {
  if (memoryCachedProfile && Date.now() - memoryProfileFetchedAt < 120_000) {
    return true;
  }
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    setCachedCurrentProfile(null);
    return false;
  }
  return true;
}

export interface CompleteOAuthProfileParams {
  username: string;
  displayName: string;
}

/**
 * После первого входа через Google/VK/Яндекс у пользователя есть auth.users-запись,
 * но ещё нет строки в profiles (там обязателен username, которого OAuth не даёт).
 * Эта функция вызывается со страницы /complete-profile.
 */
export async function completeOAuthProfile({ username, displayName }: CompleteOAuthProfileParams) {
  const supabase = getSupabaseClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error('Нет активной сессии');

  const usernameCheck = await checkUsernameAvailable(username);
  if (!usernameCheck.available) {
    throw new Error(
      usernameCheck.reason === 'invalid_format'
        ? 'Юзернейм должен быть 5-32 символа: латиница, цифры, подчёркивание'
        : 'Этот юзернейм уже занят'
    );
  }

  const { error: profileError } = await supabase.from('profiles').insert({
    id: userId,
    username,
    display_name: displayName,
  });
  if (profileError) throw profileError;

  const bundle = await generateAndStoreKeyBundle(userId);
  const { error: keysError } = await supabase
    .from('profiles')
    .update({
      public_identity_key: bundle.identityPublicKey,
      public_signed_prekey: bundle.signedPreKeyPublic,
      signed_prekey_signature: bundle.signedPreKeySignature,
      public_one_time_prekeys: bundle.oneTimePreKeysPublic,
    })
    .eq('id', userId);
  if (keysError) throw keysError;
}

export function isStaff(profile?: Profile | null): boolean {
  if (!profile) return false;
  return profile.role === 'admin' || profile.role === 'moderator' || profile.role === 'developer';
}

export function isDeveloperProfile(profile?: Profile | null): boolean {
  if (!profile) return false;
  return profile.role === 'developer';
}

