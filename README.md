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

## Деплой на GitHub Pages (бесплатно, без карты, без экранов выбора тарифа)

1. Создать репозиторий на GitHub (публичный — тогда Pages бесплатны без каких-либо условий) и запушить туда весь код
2. **Settings → Secrets and variables → Actions → New repository secret**, добавить:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. **Settings → Pages → Source** → выбрать **GitHub Actions** (не "Deploy from a branch")
4. Запушить любой коммит в `main` — workflow `.github/workflows/deploy.yml` соберёт статическую версию и опубликует её автоматически
5. Через 1-2 минуты сайт будет доступен по адресу `https://<ваш-username>.github.io/<имя-репозитория>/`
6. **Обязательно**: в Supabase → Authentication → URL Configuration → Redirect URLs добавить `https://<ваш-username>.github.io/<имя-репозитория>/chats/` — иначе OAuth-вход (Google/VK/Яндекс) откажется редиректить обратно на сайт после входа

Важно: из-за GitHub Pages пришлось убрать динамический маршрут `/chats/[id]` и заменить на `/chat/?id=...` — статический экспорт не умеет заранее сгенерировать страницу под каждый будущий UUID чата, а с query-параметром это один и тот же статический файл для всех чатов, id читается на клиенте. На поведении внутри приложения это никак не сказалось.

## Дальше — Фаза 2 (E2E-шифрование)
- Замена заглушки `packages/core/src/crypto.ts` и `messages.ts` на настоящий libsignal-client (X3DH + Double Ratchet)
- Миграция локального хранения приватных ключей с localStorage на IndexedDB
- Sender Keys для групп (заложено архитектурно, не реализовано)
