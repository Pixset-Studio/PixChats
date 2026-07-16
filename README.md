# PixChats — Фаза 1

## Статус: Фаза 1 завершена полностью

Реализовано:
- Схема БД + RLS + триггеры защиты role/is_verified: `supabase/migrations/0001_init.sql`, `0002_role_security.sql`
- Регистрация email + генерация identity key bundle (заглушка на Web Crypto, в Фазе 2 заменится на libsignal-client), проверка `@username`
- OAuth: Google (нативно), VK и Яндекс (через Custom OIDC — проверить на практике), с шагом `/complete-profile` для выбора username после первого OAuth-входа
- Создание групп/каналов (публичных/приватных), вступление в публичные
- Окно чата: сообщения в реальном времени (Supabase Realtime), отправка, различение subscriber (read-only в каналах)
- Админ-панель `/admin`: метрики, статус систем, логи ошибок, поиск пользователей, выдача верификации, назначение ролей (только developer)

## Запуск

1. Создать проект на supabase.com (бесплатный тариф)
2. Применить миграцию:
   ```
   supabase link --project-ref <ref>
   supabase db push
   ```
3. Включить в Supabase Dashboard → Authentication → Providers:
   - Email (по умолчанию включён)
   - Google (нативно, нужны Client ID/Secret из Google Cloud Console)
   - VK и Яндекс — раздел Custom Providers (Custom OAuth/OIDC Providers), issuer URL берётся из VK ID / Яндекс ID
4. Скопировать `apps/web/.env.example` → `apps/web/.env.local`, заполнить URL и anon key проекта
5. Установить зависимости и запустить:
   ```
   npm install
   npm run dev:web
   ```

## Сид разработчика @pixset
После первой регистрации вручную выполнить в Supabase SQL Editor:
```sql
update profiles set role = 'developer', is_verified = true where username = 'pixset';
```

## Дальше — Фаза 2 (E2E-шифрование)
- Замена заглушки `packages/core/src/crypto.ts` и `messages.ts` на настоящий libsignal-client (X3DH + Double Ratchet)
- Миграция локального хранения приватных ключей с localStorage на IndexedDB
- Sender Keys для групп (заложено архитектурно, не реализовано)
