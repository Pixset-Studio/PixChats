-- ============================================================
-- PixChats — Фаза 1: фикс триггера защиты role/is_verified
-- ============================================================
-- Проблема: триггер enforce_profile_privileged_fields (0002) откатывал ЛЮБОЕ
-- изменение role/is_verified, если auth.uid() не резолвился в developer/admin.
-- В SQL Editor Supabase запросы выполняются без JWT-контекста (auth.uid() = null),
-- поэтому даже ручной "update profiles set role = 'developer' ..." откатывался
-- обратно тем же триггером — инструкция по назначению первого разработчика
-- физически не могла сработать.
--
-- Решение: ограничение включается только когда запрос реально пришёл от
-- обычного пользователя через приложение (auth.role() = 'authenticated').
-- Ручные правки из SQL Editor / service_role идут в обход, как и задумывалось.

create or replace function public.enforce_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role user_role;
begin
  if auth.role() = 'authenticated' then
    select role into actor_role from profiles where id = auth.uid();

    if new.role is distinct from old.role and actor_role is distinct from 'developer' then
      new.role := old.role;
    end if;

    if new.is_verified is distinct from old.is_verified and actor_role not in ('admin','developer') then
      new.is_verified := old.is_verified;
      new.verified_at := old.verified_at;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.enforce_chat_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role user_role;
begin
  if auth.role() = 'authenticated' then
    select role into actor_role from profiles where id = auth.uid();

    if new.is_verified is distinct from old.is_verified and actor_role not in ('admin','developer') then
      new.is_verified := old.is_verified;
      new.verified_at := old.verified_at;
    end if;
  end if;

  return new;
end;
$$;
