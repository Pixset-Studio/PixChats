-- ============================================================
-- PixChats — Фаза 1: друзья, приватность, тема, аватарки
-- ============================================================

-- ---------- настройки профиля ----------
alter table profiles add column theme text not null default 'dark' check (theme in ('dark','light'));
alter table profiles add column privacy_who_can_message text not null default 'everyone'
  check (privacy_who_can_message in ('everyone','friends_only'));
alter table profiles add column privacy_show_last_seen boolean not null default true;

-- ---------- друзья ----------
create type friendship_status as enum ('pending','accepted');

create table friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid references profiles(id) on delete cascade,
  addressee_id uuid references profiles(id) on delete cascade,
  status friendship_status not null default 'pending',
  created_at timestamptz default now(),
  responded_at timestamptz,

  constraint no_self_friend check (requester_id != addressee_id),
  constraint unique_pair unique (requester_id, addressee_id)
);
create index idx_friendships_addressee on friendships (addressee_id, status);
create index idx_friendships_requester on friendships (requester_id, status);

alter table friendships enable row level security;

create policy friendships_select_own on friendships
  for select using (auth.uid() in (requester_id, addressee_id));

create policy friendships_insert_own on friendships
  for insert with check (requester_id = auth.uid());

-- принять/отклонить может только адресат, отменить свою заявку — только автор (через delete)
create policy friendships_update_addressee on friendships
  for update using (addressee_id = auth.uid());

create policy friendships_delete_participant on friendships
  for delete using (auth.uid() in (requester_id, addressee_id));

create or replace function public.are_friends(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from friendships
    where status = 'accepted'
      and ((requester_id = p_user_a and addressee_id = p_user_b)
        or (requester_id = p_user_b and addressee_id = p_user_a))
  );
$$;

-- ---------- Storage: аватарки ----------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatars_owner_insert" on storage.objects
  for insert with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_owner_update" on storage.objects
  for update using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_owner_delete" on storage.objects
  for delete using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
