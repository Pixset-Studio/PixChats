import { getSupabaseClient } from './supabaseClient';

export interface LinkedIdentity {
  provider: string;
  identityId: string;
}

/** Список уже привязанных способов входа (email считается отдельно через наличие пароля). */
export async function getLinkedIdentities(): Promise<LinkedIdentity[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error) throw error;
  return (data?.identities ?? []).map((i) => ({ provider: i.provider, identityId: i.identity_id }));
}

/**
 * Привязка OAuth-провайдера к уже вошедшему аккаунту.
 * Требует включённой опции "Manual Linking" в Supabase (Authentication → Settings) —
 * иначе Supabase будет считать это попыткой входа в другой аккаунт, а не привязкой.
 */
async function linkProvider(provider: 'google' | 'vk' | 'yandex', redirectTo?: string) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.linkIdentity({ provider: provider as any, options: { redirectTo } });
  if (error) throw error;
}

export const linkGoogle = (redirectTo?: string) => linkProvider('google', redirectTo);
export const linkVK = (redirectTo?: string) => linkProvider('vk', redirectTo);
export const linkYandex = (redirectTo?: string) => linkProvider('yandex', redirectTo);

/** Привязка email+пароля к аккаунту, у которого их ещё нет (например, вход был только через Google). */
export async function linkEmailPassword(email: string, password: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.updateUser({ email, password });
  if (error) throw error;
}
