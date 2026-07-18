-- ============================================================
-- PixChats — Фаза 1: модерация и блокировка пользователей
-- ============================================================

-- ---------- бан/заморозка аккаунтов ----------
alter table profiles add column banned_until timestamptz;      -- null = не забанен; дата в прошлом = снят
alter table profiles add column banned_permanently boolean not null default false;
alter table profiles add column frozen boolean not null default false; -- может читать, не может писать

-- ---------- запрещённые юзернеймы ----------
create table banned_usernames (
  username text primary key,
  banned_by uuid references profiles(id),
  banned_at timestamptz default now()
);
alter table banned_usernames enable row level security;
create policy banned_usernames_staff_only on banned_usernames
  for all using (can_view_admin_stats())
  with check (can_view_admin_stats());

-- ---------- блокировка пользователей друг другом (обычная функция, не модерация) ----------
create table blocked_users (
  blocker_id uuid references profiles(id) on delete cascade,
  blocked_id uuid references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id != blocked_id)
);
alter table blocked_users enable row level security;

create policy blocked_users_select_own on blocked_users
  for select using (auth.uid() = blocker_id);
create policy blocked_users_insert_own on blocked_users
  for insert with check (auth.uid() = blocker_id);
create policy blocked_users_delete_own on blocked_users
  for delete using (auth.uid() = blocker_id);

create or replace function public.is_blocked(p_blocker uuid, p_blocked uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from blocked_users where blocker_id = p_blocker and blocked_id = p_blocked);
$$;

-- ---------- расширение приватности: "nobody" уже добавлен для last_seen,
-- теперь добавляем его и для privacy_who_can_message ----------
alter table profiles drop constraint if exists profiles_privacy_who_can_message_check;
alter table profiles add constraint profiles_privacy_who_can_message_check
  check (privacy_who_can_message in ('everyone','friends_only','nobody'));

-- ---------- запрет писать/отправлять сообщения замороженным аккаунтам ----------
drop policy if exists messages_insert_member_not_subscriber on messages;
create policy messages_insert_member_not_subscriber on messages
  for insert with check (
    sender_id = auth.uid()
    and not exists (select 1 from profiles where id = auth.uid() and frozen = true)
    and exists (
      select 1 from chat_members cm
      where cm.chat_id = messages.chat_id
        and cm.user_id = auth.uid()
        and cm.member_role != 'subscriber'
    )
  );
