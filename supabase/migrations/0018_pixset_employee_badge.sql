-- ============================================================
-- PixChats — Фаза 1: бейдж "Сотрудник Pixset Studio" (отдельно от role)
-- ============================================================

alter table profiles add column is_pixset_employee boolean not null default false;

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

    if new.is_pixset_employee is distinct from old.is_pixset_employee and actor_role not in ('admin','developer') then
      new.is_pixset_employee := old.is_pixset_employee;
    end if;
  end if;

  return new;
end;
$$;
