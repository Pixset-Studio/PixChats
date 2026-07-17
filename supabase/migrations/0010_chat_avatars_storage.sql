-- ============================================================
-- PixChats — Фаза 1: Storage для аватарок групп/каналов
-- ============================================================
-- Отдельный бакет от личных avatars — там папка = user_id, здесь папка = chat_id,
-- и загружать/менять может только owner/admin этого чата (используем уже
-- существующую is_chat_owner_or_admin из 0005).

insert into storage.buckets (id, name, public)
values ('chat-avatars', 'chat-avatars', true)
on conflict (id) do nothing;

create policy "chat_avatars_public_read" on storage.objects
  for select using (bucket_id = 'chat-avatars');

create policy "chat_avatars_owner_admin_insert" on storage.objects
  for insert with check (
    bucket_id = 'chat-avatars'
    and is_chat_owner_or_admin(((storage.foldername(name))[1])::uuid, auth.uid())
  );

create policy "chat_avatars_owner_admin_update" on storage.objects
  for update using (
    bucket_id = 'chat-avatars'
    and is_chat_owner_or_admin(((storage.foldername(name))[1])::uuid, auth.uid())
  );

create policy "chat_avatars_owner_admin_delete" on storage.objects
  for delete using (
    bucket_id = 'chat-avatars'
    and is_chat_owner_or_admin(((storage.foldername(name))[1])::uuid, auth.uid())
  );
