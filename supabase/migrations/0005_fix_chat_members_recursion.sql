-- ============================================================
-- PixChats — Фаза 1: фикс infinite recursion в chat_members
-- ============================================================
-- Причина: политики select/insert на chat_members сами делают подзапрос
-- к chat_members — Postgres переоценивает ту же RLS-политику рекурсивно.
-- Решение: вынести проверку в security definer функции (обходят RLS
-- изнутри, т.к. выполняются с правами владельца), политики зовут их вместо
-- прямого подзапроса к той же таблице.

create or replace function public.is_chat_member(p_chat_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from chat_members
    where chat_id = p_chat_id and user_id = p_user_id
  );
$$;

create or replace function public.is_chat_owner_or_admin(p_chat_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from chat_members
    where chat_id = p_chat_id and user_id = p_user_id and member_role in ('owner','admin')
  );
$$;

drop policy if exists chat_members_select_member on chat_members;
create policy chat_members_select_member on chat_members
  for select using (is_chat_member(chat_id, auth.uid()));

drop policy if exists chat_members_insert_self_or_owner on chat_members;
create policy chat_members_insert_self_or_owner on chat_members
  for insert with check (
    user_id = auth.uid() or is_chat_owner_or_admin(chat_id, auth.uid())
  );
