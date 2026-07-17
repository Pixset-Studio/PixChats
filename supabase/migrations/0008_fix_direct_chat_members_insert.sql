-- ============================================================
-- PixChats — Фаза 1: фикс insert в chat_members при создании direct-чата
-- ============================================================
-- Проблема: createDirectChat() вставляет сразу 2 строки в chat_members (себя
-- и собеседника). Для строки собеседника прежняя политика требовала, чтобы
-- текущий пользователь уже был owner/admin ЭТОГО чата — но такой записи ещё
-- нет, чат только что создан (classic chicken-egg). Insert падал целиком,
-- чат оставался без участников, из-за чего сообщения потом отклонялись RLS.
--
-- Решение: создателю чата (chats.created_by) разрешено добавлять участников,
-- даже если он ещё не отмечен как owner/admin в chat_members.

create or replace function public.is_chat_creator(p_chat_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from chats where id = p_chat_id and created_by = p_user_id);
$$;

drop policy if exists chat_members_insert_self_or_owner on chat_members;
create policy chat_members_insert_self_or_owner on chat_members
  for insert with check (
    user_id = auth.uid()
    or is_chat_owner_or_admin(chat_id, auth.uid())
    or is_chat_creator(chat_id, auth.uid())
  );
