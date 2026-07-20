-- ============================================================
-- PixChats — Фаза 1: удаление групп/каналов владельцем, приватность добавления
-- ============================================================

-- Удаление чата: только владелец. RLS на chats пока не имеет отдельной DELETE-политики —
-- без неё delete от имени обычного пользователя будет отклонён (что и требуется по умолчанию),
-- явно разрешаем только владельцу (или staff — на случай модерации).
create policy chats_delete_owner_or_staff on chats
  for delete using (
    exists (select 1 from chat_members cm where cm.chat_id = id and cm.user_id = auth.uid() and cm.member_role = 'owner')
    or is_staff()
  );

-- ---------- приватность: кто может добавить меня в группу/канал ----------
alter table profiles add column privacy_who_can_add_to_groups text not null default 'everyone'
  check (privacy_who_can_add_to_groups in ('everyone','friends_only','nobody'));
