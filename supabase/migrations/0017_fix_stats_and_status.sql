-- ============================================================
-- PixChats — Фаза 1: фикс "subquery must return only one column" в статистике
-- ============================================================
-- Возврат составного типа (returns admin_stats_overview) из plpgsql-функции
-- в некоторых случаях приводит именно к такой ошибке при построении строки
-- результата. Возврат через row_to_json полностью обходит эту проблему —
-- PostgREST/supabase-js получают тот же набор полей, просто через JSON.

create or replace function public.get_admin_stats_overview()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
begin
  if not can_view_admin_stats() then
    raise exception 'insufficient privileges';
  end if;
  select row_to_json(t) into result from admin_stats_overview t;
  return result;
end;
$$;

-- ---------- ручная самопроверка статуса систем ----------
-- Полноценный мониторинг по расписанию (cron/Edge Function) — задача побольше,
-- пока даём рабочую кнопку "Проверить сейчас" в админке: если запрос к БД
-- прошёл успешно, значит Supabase точно в порядке — как минимум это не будет
-- вечной пустотой в интерфейсе.
create or replace function public.record_self_status_check(p_latency_ms integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not can_view_admin_stats() then
    raise exception 'insufficient privileges';
  end if;
  insert into system_status_checks (service, status, latency_ms)
  values ('supabase', 'operational', p_latency_ms);
end;
$$;
