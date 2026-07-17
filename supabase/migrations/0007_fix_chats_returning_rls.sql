-- ============================================================
-- PixChats — Фаза 1: фикс RLS при создании чата (RETURNING после INSERT)
-- ============================================================
-- Проблема: createChat() делает .insert(...).select().single() — PostgREST
-- выполняет INSERT ... RETURNING, а RETURNING подчиняется SELECT-политике,
-- не только INSERT. Строка в chat_members (создатель как owner) появляется
-- отдельным запросом ПОСЛЕ вставки chats — то есть в момент RETURNING
-- создатель ещё не значится участником, и для приватных групп/каналов
-- SELECT-политика блокирует чтение только что созданной строки, что Postgres
-- репортит как "new row violates row-level security policy for table chats".
--
-- Решение: разрешить видеть чат, если ты его создал (created_by = auth.uid()),
-- независимо от наличия записи в chat_members.

drop policy if exists chats_select_member_or_public on chats;
create policy chats_select_member_or_public on chats
  for select using (
    visibility = 'public'
    or created_by = auth.uid()
    or exists (select 1 from chat_members cm where cm.chat_id = chats.id and cm.user_id = auth.uid())
  );
