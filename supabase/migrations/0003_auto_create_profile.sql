-- ============================================================
-- PixChats — Фаза 1: автосоздание profiles через триггер
-- ============================================================
-- Проблема: клиентский insert в profiles сразу после signUp() падает с
-- ошибкой RLS, если в проекте включено подтверждение email — до подтверждения
-- нет активной сессии (auth.uid() пустой), а RLS требует id = auth.uid().
-- Решение: триггер на auth.users, который создаёт профиль от имени системы
-- (SECURITY DEFINER, выполняется с правами владельца функции — RLS не мешает),
-- независимо от того, подтверждён email или нет. username/display_name
-- передаются как metadata при вызове supabase.auth.signUp().

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Для OAuth-регистраций (Google/VK/Яндекс) username ещё не выбран —
  -- в этом случае профиль создаётся позже через /complete-profile, здесь пропускаем.
  if new.raw_user_meta_data ->> 'username' is not null then
    insert into public.profiles (id, username, display_name)
    values (
      new.id,
      new.raw_user_meta_data ->> 'username',
      coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'username')
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
