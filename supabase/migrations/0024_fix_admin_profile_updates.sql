-- ============================================================
-- PixChats — Фаза 1: фикс выдачи ролей/бана/заморозки (не работало вообще)
-- ============================================================
-- Причина: политика profiles_update_self разрешала обновлять СВОЙ профиль
-- (id = auth.uid()), и только его. Функции setUserRole/setUserVerification/
-- setPixsetEmployeeBadge/banAccount/setAccountFrozen пытались обновить ЧУЖОЙ
-- профиль (id = targetUserId) — RLS просто отклонял операцию (0 строк
-- обновлено, без явной ошибки), поэтому выглядело как "ничего не происходит".
-- Какие именно поля можно менять — по-прежнему решает триггер
-- enforce_profile_privileged_fields, эта политика лишь пускает staff к строке.

create policy profiles_update_staff on profiles
  for update using (is_staff());
