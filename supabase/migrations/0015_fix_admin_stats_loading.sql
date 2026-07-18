-- ============================================================
-- PixChats — Фаза 1: фикс "бесконечной загрузки" в обзоре админки
-- ============================================================
-- Причина: get_admin_stats_overview() проверял is_staff() (только admin/developer),
-- а UI показывает блок статистики ВСЕМ staff-ролям, включая moderator. Для
-- moderator запрос падал с ошибкой доступа — админ/page.tsx не ловил исключение,
-- setStats() никогда не вызывался, и блок навсегда оставался в состоянии "Загрузка...".

create or replace function public.can_view_admin_stats()
returns boolean
language sql
stable
as $$
  select current_user_role() in ('admin','developer','moderator');
$$;

create or replace function public.get_admin_stats_overview()
returns admin_stats_overview
language plpgsql
security definer
set search_path = public
as $$
begin
  if not can_view_admin_stats() then
    raise exception 'insufficient privileges';
  end if;
  return (select * from admin_stats_overview);
end;
$$;
