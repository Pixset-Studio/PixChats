-- ============================================================
-- PixChats — Фаза 1: согласие на обработку персональных данных
-- ============================================================

alter table profiles add column privacy_accepted_at timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.raw_user_meta_data ->> 'username' is not null then
    insert into public.profiles (id, username, display_name, privacy_accepted_at)
    values (
      new.id,
      new.raw_user_meta_data ->> 'username',
      coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'username'),
      case when new.raw_user_meta_data ->> 'privacy_accepted' = 'true' then now() else null end
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;
