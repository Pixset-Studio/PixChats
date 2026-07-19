-- ============================================================
-- PixChats — Фаза 1: непрочитанные сообщения + мьют уведомлений
-- ============================================================

create table chat_read_state (
  user_id uuid references profiles(id) on delete cascade,
  chat_id uuid references chats(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, chat_id)
);
alter table chat_read_state enable row level security;

create policy chat_read_state_select_own on chat_read_state
  for select using (user_id = auth.uid());
create policy chat_read_state_insert_own on chat_read_state
  for insert with check (user_id = auth.uid());
create policy chat_read_state_update_own on chat_read_state
  for update using (user_id = auth.uid());

create table chat_mutes (
  user_id uuid references profiles(id) on delete cascade,
  chat_id uuid references chats(id) on delete cascade,
  muted_forever boolean not null default false,
  muted_until timestamptz,
  primary key (user_id, chat_id)
);
alter table chat_mutes enable row level security;

create policy chat_mutes_select_own on chat_mutes
  for select using (user_id = auth.uid());
create policy chat_mutes_insert_own on chat_mutes
  for insert with check (user_id = auth.uid());
create policy chat_mutes_update_own on chat_mutes
  for update using (user_id = auth.uid());
create policy chat_mutes_delete_own on chat_mutes
  for delete using (user_id = auth.uid());
