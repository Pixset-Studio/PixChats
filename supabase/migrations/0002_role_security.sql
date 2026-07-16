-- ============================================================
-- PixChats — Фаза 1: защита полей role / is_verified
-- ============================================================
-- Проблема: политика profiles_update_self разрешает пользователю обновлять
-- СВОЙ профиль целиком, включая role и is_verified — то есть можно назначить
-- себя developer'ом напрямую через Supabase API, минуя фронтенд-проверки.
-- Решение: триггер, который откатывает эти поля к старому значению, если
-- обновление делает не staff соответствующего уровня.

create or replace function enforce_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role user_role;
begin
  select role into actor_role from profiles where id = auth.uid();

  -- role: менять может только developer, и не самому себе на developer
  if new.role is distinct from old.role then
    if actor_role is distinct from 'developer' then
      new.role := old.role;
    end if;
  end if;

  -- is_verified / verified_at: менять может admin или developer
  if new.is_verified is distinct from old.is_verified then
    if actor_role not in ('admin','developer') then
      new.is_verified := old.is_verified;
      new.verified_at := old.verified_at;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_profiles_privileged_fields
  before update on profiles
  for each row execute function enforce_profile_privileged_fields();

-- Аналогично для chats.is_verified — менять может только admin/developer
create or replace function enforce_chat_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role user_role;
begin
  select role into actor_role from profiles where id = auth.uid();

  if new.is_verified is distinct from old.is_verified then
    if actor_role not in ('admin','developer') then
      new.is_verified := old.is_verified;
      new.verified_at := old.verified_at;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_chats_privileged_fields
  before update on chats
  for each row execute function enforce_chat_privileged_fields();
