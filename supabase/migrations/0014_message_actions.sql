-- ============================================================
-- PixChats — Фаза 1: ответы, редактирование, удаление, закреп, пересылка
-- ============================================================

alter table messages add column reply_to_id uuid references messages(id);
alter table messages add column edited_at timestamptz;
alter table messages add column is_deleted boolean not null default false;
alter table messages add column forwarded_from_chat_id uuid references chats(id);

alter table chats add column pinned_message_id uuid references messages(id);

-- Раньше UPDATE на messages был вообще никем не разрешён (RLS включён, политики
-- update не было) — редактирование/удаление/soft-delete были бы просто отклонены.
create policy messages_update_sender_or_staff on messages
  for update using (
    sender_id = auth.uid()
    or is_chat_owner_or_admin(chat_id, auth.uid())
  );
