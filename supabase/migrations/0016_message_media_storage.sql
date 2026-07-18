-- ============================================================
-- PixChats — Фаза 1: хранилище для файлов в сообщениях (любые типы)
-- ============================================================

insert into storage.buckets (id, name, public)
values ('message-media', 'message-media', true)
on conflict (id) do nothing;

create policy "message_media_public_read" on storage.objects
  for select using (bucket_id = 'message-media');

create policy "message_media_member_insert" on storage.objects
  for insert with check (
    bucket_id = 'message-media'
    and is_chat_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );
