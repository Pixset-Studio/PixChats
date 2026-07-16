-- ============================================================
-- PixChats — Фаза 1: базовая схема
-- ============================================================

create extension if not exists "pgcrypto";

-- ============ ТИПЫ ============
create type user_role as enum ('user','moderator','admin','developer');
create type chat_type as enum ('direct','group','channel');
create type chat_visibility as enum ('public','private');
create type chat_member_role as enum ('owner','admin','moderator','member','subscriber');

-- ============ ПРОФИЛИ ============
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null,
  avatar_url text,
  role user_role not null default 'user',
  is_verified boolean not null default false,
  verified_at timestamptz,
  public_identity_key text,       -- base64
  public_signed_prekey text,      -- base64
  signed_prekey_signature text,   -- base64
  public_one_time_prekeys jsonb,
  last_seen timestamptz default now(),
  created_at timestamptz default now(),

  constraint username_format check (username ~ '^[a-zA-Z0-9_]{5,32}$')
);
create index idx_profiles_username_lower on profiles (lower(username));

-- ============ ЧАТЫ / ГРУППЫ / КАНАЛЫ ============
create table chats (
  id uuid primary key default gen_random_uuid(),
  type chat_type not null,
  visibility chat_visibility,
  username text unique,
  title text,
  description text,
  avatar_url text,
  is_verified boolean not null default false,
  verified_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),

  constraint chat_username_format check (username is null or username ~ '^[a-zA-Z0-9_]{5,32}$'),
  constraint direct_has_no_username check (type != 'direct' or username is null),
  constraint group_channel_needs_visibility check (type = 'direct' or visibility is not null)
);
create index idx_chats_username_lower on chats (lower(username)) where username is not null;

create table chat_members (
  chat_id uuid references chats(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  member_role chat_member_role not null default 'member',
  joined_at timestamptz default now(),
  primary key (chat_id, user_id)
);

-- ============ СООБЩЕНИЯ ============
create table messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references chats(id) on delete cascade,
  sender_id uuid references profiles(id),
  ciphertext text not null,       -- base64-строка (Фаза 1: plaintext-заглушка в base64, Фаза 2: реальный шифротекст Double Ratchet)
  message_type text not null default 'text',
  media_path text,
  sent_at timestamptz default now(),
  delivered_to jsonb not null default '[]',
  read_by jsonb not null default '[]'
);
create index idx_messages_chat_sent on messages (chat_id, sent_at desc);

-- ============ ЗВОНКИ ============
create table calls (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references chats(id),
  initiator_id uuid references profiles(id),
  type text not null check (type in ('voice','video')),
  status text not null default 'ringing' check (status in ('ringing','active','ended','missed')),
  started_at timestamptz default now(),
  ended_at timestamptz
);
create index idx_calls_status on calls (status);

-- ============ АДМИНКА: АУДИТ, СТАТУС, ЛОГИ ============
create table admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  action text not null,
  target_type text,
  target_id uuid,
  details jsonb,
  created_at timestamptz default now()
);

create table system_status_checks (
  id uuid primary key default gen_random_uuid(),
  service text not null,
  status text not null check (status in ('operational','degraded','down')),
  latency_ms integer,
  checked_at timestamptz default now()
);

create table app_error_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('web','desktop','mobile')),
  user_id uuid references profiles(id),
  message text not null,
  stack text,
  created_at timestamptz default now()
);

-- ============ ПРЕДСТАВЛЕНИЕ ДЛЯ БИЗНЕС-МЕТРИК ============
create view admin_stats_overview as
select
  (select count(*) from profiles) as total_users,
  (select count(*) from profiles where last_seen > now() - interval '1 day') as dau,
  (select count(*) from profiles where last_seen > now() - interval '30 days') as mau,
  (select count(*) from chats where type = 'direct') as total_direct_chats,
  (select count(*) from chats where type = 'group') as total_groups,
  (select count(*) from chats where type = 'channel') as total_channels,
  (select count(*) from messages) as total_messages,
  (select count(*) from messages where sent_at > now() - interval '1 day') as messages_today,
  (select count(*) from calls) as total_calls,
  (select count(*) from calls where started_at > now() - interval '1 day') as calls_today;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table profiles enable row level security;
alter table chats enable row level security;
alter table chat_members enable row level security;
alter table messages enable row level security;
alter table calls enable row level security;
alter table admin_audit_log enable row level security;
alter table system_status_checks enable row level security;
alter table app_error_logs enable row level security;

-- ---------- helper: текущая роль пользователя ----------
create or replace function current_user_role()
returns user_role
language sql stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_staff()
returns boolean
language sql stable
as $$
  select current_user_role() in ('admin','developer');
$$;

-- ---------- profiles ----------
-- Все профили читаемы всеми залогиненными (нужно для поиска @username, списков участников и т.д.)
create policy profiles_select_all on profiles
  for select using (auth.role() = 'authenticated');

create policy profiles_update_self on profiles
  for update using (id = auth.uid());

-- Менять чужую role/is_verified может только developer (для role) и admin/developer (для is_verified) —
-- проверяется дополнительно в Edge Function/приложении, RLS здесь ограничивает только владельца строки для обычных полей.
create policy profiles_insert_self on profiles
  for insert with check (id = auth.uid());

-- ---------- chats ----------
create policy chats_select_member_or_public on chats
  for select using (
    visibility = 'public'
    or exists (select 1 from chat_members cm where cm.chat_id = chats.id and cm.user_id = auth.uid())
  );

create policy chats_insert_authenticated on chats
  for insert with check (auth.role() = 'authenticated' and created_by = auth.uid());

create policy chats_update_owner_or_staff on chats
  for update using (
    exists (select 1 from chat_members cm where cm.chat_id = chats.id and cm.user_id = auth.uid() and cm.member_role in ('owner','admin'))
    or is_staff()
  );

-- ---------- chat_members ----------
create policy chat_members_select_member on chat_members
  for select using (
    exists (select 1 from chat_members cm2 where cm2.chat_id = chat_members.chat_id and cm2.user_id = auth.uid())
  );

create policy chat_members_insert_self_or_owner on chat_members
  for insert with check (
    user_id = auth.uid()
    or exists (select 1 from chat_members cm2 where cm2.chat_id = chat_members.chat_id and cm2.user_id = auth.uid() and cm2.member_role in ('owner','admin'))
  );

-- ---------- messages ----------
create policy messages_select_member on messages
  for select using (
    exists (select 1 from chat_members cm where cm.chat_id = messages.chat_id and cm.user_id = auth.uid())
  );

create policy messages_insert_member_not_subscriber on messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from chat_members cm
      where cm.chat_id = messages.chat_id
        and cm.user_id = auth.uid()
        and cm.member_role != 'subscriber'   -- подписчики каналов не могут писать
    )
  );

-- ---------- calls ----------
create policy calls_select_member on calls
  for select using (
    exists (select 1 from chat_members cm where cm.chat_id = calls.chat_id and cm.user_id = auth.uid())
  );

create policy calls_insert_member on calls
  for insert with check (
    initiator_id = auth.uid()
    and exists (select 1 from chat_members cm where cm.chat_id = calls.chat_id and cm.user_id = auth.uid())
  );

create policy calls_update_member on calls
  for update using (
    exists (select 1 from chat_members cm where cm.chat_id = calls.chat_id and cm.user_id = auth.uid())
  );

-- ---------- admin / система (только staff) ----------
create policy admin_audit_log_staff_only on admin_audit_log
  for select using (is_staff());
create policy admin_audit_log_insert_staff on admin_audit_log
  for insert with check (is_staff());

create policy system_status_staff_only on system_status_checks
  for select using (is_staff());

create policy app_error_logs_staff_select on app_error_logs
  for select using (is_staff());
create policy app_error_logs_insert_any on app_error_logs
  for insert with check (auth.role() = 'authenticated');
