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
}

/**
 * Регистрация по email. Создаёт auth.users-запись и профиль в одной операции.
 * Identity keys (X3DH bundle) генерируются на клиенте отдельно (Фаза 2) и
 * дозаписываются в profiles через updateProfileKeys — на этапе регистрации
 * достаточно базовых полей.
 */
export async function signUpWithEmail({ email, password, username, displayName }: SignUpParams) {
  const supabase = getSupabaseClient();

  const usernameCheck = await checkUsernameAvailable(username);
  if (!usernameCheck.available) {
    throw new Error(
      usernameCheck.reason === 'invalid_format'
        ? 'Юзернейм должен быть 5-32 символа: латиница, цифры, подчёркивание'
        : 'Этот юзернейм уже занят'
    );
  }

  // username/display_name передаются как metadata — профиль создаст триггер на БД
  // (см. 0003_auto_create_profile.sql), это работает независимо от того, требуется
  // ли подтверждение email (пока не подтверждён — активной сессии нет).
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username, display_name: displayName } },
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

export async function signOut() {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Проверяет, есть ли у профиля уже загруженный identity key bundle, и если нет —
 * генерирует и загружает. Нужно на случай, если при регистрации не было активной
 * сессии (email ещё не подтверждён) — тогда ключи появятся при первом успешном входе.
 */
export async function ensureKeyBundle(profile: Profile): Promise<void> {
  if (profile.public_identity_key) return;

  const supabase = getSupabaseClient();
  const bundle = await generateAndStoreKeyBundle(profile.id);
  const { error } = await supabase
    .from('profiles')
    .update({
      public_identity_key: bundle.identityPublicKey,
      public_signed_prekey: bundle.signedPreKeyPublic,
      signed_prekey_signature: bundle.signedPreKeySignature,
      public_one_time_prekeys: bundle.oneTimePreKeysPublic,
    })
    .eq('id', profile.id);
  if (error) throw error;
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = getSupabaseClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return null;

  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

/** true, если есть активная сессия (вошёл), независимо от того, создан ли уже profiles-профиль. */
export async function hasActiveSession(): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  return !!data.session;
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
