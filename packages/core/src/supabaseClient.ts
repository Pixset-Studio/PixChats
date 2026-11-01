import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * Единая точка создания Supabase-клиента для всех платформ (web/desktop/mobile).
 * URL и anon-ключ берутся из переменных окружения — см. .env.example.
 */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kibhezfpafhitcvpkquu.supabase.co';
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpYmhlemZwYWZoaXRjdnBrcXV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxOTI4NjUsImV4cCI6MjA5OTc2ODg2NX0.HO1uskn4k7AWmFNFpFXd2vdgO8BKYz_bb8lpj2znSoI';

  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });

  return client;
}
