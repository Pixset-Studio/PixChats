-- ============================================================
-- PixChats — Фаза 1: блокировка теперь реально запрещает переписку
-- ============================================================
-- Раньше блокировка была только "для галочки" — таблица blocked_users
-- существовала, но ничто не мешало заблокированному всё равно отправлять
-- сообщения в личный чат. Добавляем реальную проверку в RLS: если в личном
-- чате кто-то из пары заблокировал другого — insert в messages отклоняется.

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
    and not exists (
      select 1 from chat_members other
      where other.chat_id = messages.chat_id
        and other.user_id != auth.uid()
        and (select type from chats where id = messages.chat_id) = 'direct'
        and (is_blocked(other.user_id, auth.uid()) or is_blocked(auth.uid(), other.user_id))
    )
  );
