// Supabase Edge Function: admin-delete-user
// Деплой: supabase functions deploy admin-delete-user
// Секреты берутся автоматически из окружения проекта (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) —
// их не нужно задавать вручную, Supabase подставляет их для Edge Functions сама.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Нет авторизации' }), { status: 401 });
    }

    // Клиент от имени вызывающего — чтобы проверить его роль через обычный RLS-контекст
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user: caller },
    } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Не авторизован' }), { status: 401 });
    }

    const { data: callerProfile } = await callerClient.from('profiles').select('role').eq('id', caller.id).single();
    if (!callerProfile || (callerProfile.role !== 'admin' && callerProfile.role !== 'developer')) {
      return new Response(JSON.stringify({ error: 'Недостаточно прав' }), { status: 403 });
    }

    const { targetUserId } = await req.json();
    if (!targetUserId) {
      return new Response(JSON.stringify({ error: 'Не указан targetUserId' }), { status: 400 });
    }

    // Только service_role умеет удалять пользователей из auth.users —
    // удаление каскадно снесёт и строку в profiles (ON DELETE CASCADE).
    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { error } = await adminClient.auth.admin.deleteUser(targetUserId);
    if (error) throw error;

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
