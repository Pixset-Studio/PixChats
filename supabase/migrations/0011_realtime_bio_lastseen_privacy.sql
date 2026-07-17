-- ============================================================
-- PixChats — Фаза 1: realtime для сообщений, bio, детальная приватность last_seen
-- ============================================================

-- Причина, почему сообщения не появлялись без обновления страницы: таблица
-- messages никогда не была добавлена в публикацию supabase_realtime — Supabase
-- транслирует изменения только по тем таблицам, что явно в неё включены.
alter publication supabase_realtime add table messages;

-- ---------- описание профиля пользователя ----------
alter table profiles add column bio text;

-- ---------- детальная приватность last_seen: всем / только друзьям / никому ----------
alter table profiles rename column privacy_show_last_seen to privacy_show_last_seen_old;
alter table profiles add column privacy_show_last_seen text not null default 'everyone'
  check (privacy_show_last_seen in ('everyone','friends_only','nobody'));
update profiles set privacy_show_last_seen = case when privacy_show_last_seen_old then 'everyone' else 'nobody' end;
alter table profiles drop column privacy_show_last_seen_old;
