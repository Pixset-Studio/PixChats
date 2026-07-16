-- ============================================================
-- PixChats — Фаза 1: закрытие admin_stats_overview проверкой роли
-- ============================================================
-- Supabase Advisor пометил admin_stats_overview как CRITICAL: Security Definer View.
-- Причина: представление выполняется с правами владельца (обходит RLS), а прямой
-- доступ к нему через Supabase API ничем не ограничен — любой authenticated
-- пользователь мог прочитать полную статистику, а не только admin/developer.
--
-- Решение: закрыть прямой SELECT на представление и открыть доступ только через
-- функцию, которая явно проверяет is_staff() перед выдачей данных.

revoke all on public.admin_stats_overview from public, anon, authenticated;

create or replace function public.get_admin_stats_overview()
returns admin_stats_overview
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_staff() then
    raise exception 'insufficient privileges';
  end if;
  return (select * from admin_stats_overview);
end;
$$;

grant execute on function public.get_admin_stats_overview() to authenticated;
