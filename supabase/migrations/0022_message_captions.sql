-- ============================================================
-- PixChats — Фаза 1: подписи к файлам/фото/видео/аудио
-- ============================================================

alter table messages add column caption text;
alter table messages add column caption_position text not null default 'below'
  check (caption_position in ('above','below'));
