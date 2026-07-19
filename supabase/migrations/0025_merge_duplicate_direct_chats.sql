-- ============================================================
-- PixChats — Фаза 1: слияние дублей личных чатов + бэкфилл direct_pair_key
-- ============================================================
-- Причина, почему дубли всё ещё появлялись: колонка direct_pair_key (0019)
-- была добавлена БЕЗ бэкфилла — у всех direct-чатов, созданных до этой
-- миграции, она осталась NULL. Уникальный индекс не видел NULL как конфликт,
-- поэтому для "старых" пар новый чат всё равно создавался поверх старого.
--
-- Правило слияния: для каждой пары людей с несколькими direct-чатами
-- оставляем тот, где БОЛЬШЕ сообщений (при равенстве — более старый),
-- остальные удаляем (сообщения/участники уносятся каскадом).

do $$
declare
  rec record;
begin
  for rec in (
    select pair_key, array_agg(chat_id order by msg_count desc, created_at asc) as chat_ids
    from (
      select
        c.id as chat_id,
        c.created_at,
        (select string_agg(user_id::text, ':' order by user_id) from chat_members where chat_id = c.id) as pair_key,
        (select count(*) from messages where chat_id = c.id) as msg_count
      from chats c
      where c.type = 'direct'
    ) t
    where pair_key is not null
    group by pair_key
  )
  loop
    if array_length(rec.chat_ids, 1) > 1 then
      delete from chats where id = any(rec.chat_ids[2:array_length(rec.chat_ids, 1)]);
    end if;
    update chats set direct_pair_key = rec.pair_key where id = rec.chat_ids[1];
  end loop;
end $$;
