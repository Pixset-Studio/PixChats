-- ============================================================
-- PixChats — Migration 0028: Жалобы на сообщения и автомодерация
-- ============================================================

create table if not exists public.message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  chat_id uuid references public.chats(id) on delete cascade,
  reason text not null,
  details text,
  created_at timestamptz not null default now(),
  constraint unique_reporter_per_message unique (reporter_id, message_id)
);

alter table public.message_reports enable row level security;

-- Пользователь может просматривать свои отправленные жалобы
drop policy if exists message_reports_select_own on public.message_reports;
create policy message_reports_select_own on public.message_reports
  for select using (
    reporter_id = auth.uid() or
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer', 'moderator'))
  );

-- Авторизованный пользователь может отправлять жалобу
drop policy if exists message_reports_insert_own on public.message_reports;
create policy message_reports_insert_own on public.message_reports
  for insert with check (
    reporter_id = auth.uid()
  );

-- Функция автоматической заморозки пользователя при достижении 3 жалоб от разных людей
create or replace function public.check_and_auto_freeze_user(p_reported_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unique_reporters int;
begin
  select count(distinct reporter_id) into v_unique_reporters
  from public.message_reports
  where reported_user_id = p_reported_user_id;

  if v_unique_reporters >= 3 then
    update public.profiles
    set frozen = true
    where id = p_reported_user_id;
    return true;
  end if;

  return false;
end;
$$;
