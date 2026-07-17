# PixChats — Фаза 1

## Статус: Фаза 1 завершена полностью

Реализовано:
- Схема БД + RLS + триггеры защиты role/is_verified: `supabase/migrations/0001_init.sql`, `0002_role_security.sql`
- Регистрация email + генерация identity key bundle (заглушка на Web Crypto, в Фазе 2 заменится на libsignal-client), проверка `@username`
- OAuth: Google (нативно), VK и Яндекс (через Custom OIDC — проверить на практике), с шагом `/complete-profile` для выбора username после первого OAuth-входа
- Создание групп/каналов (публичных/приватных), вступление в публичные
- Окно чата: сообщения в реальном времени (Supabase Realtime), отправка, различение subscriber (read-only в каналах)
- Админ-панель `/admin`: метрики, статус систем, логи ошибок, поиск пользователей, выдача верификации, назначение ролей (только developer)
- Настройки `/settings`: смена аватара (Supabase Storage), юзернейма, отображаемого имени, тема (тёмная/светлая), приватность (кто может писать первым, показывать ли last seen)
- Друзья `/friends`: поиск по @username, заявки (входящие/исходящие), принятие/отклонение, список друзей с кнопкой "Написать" (создаёт личный чат)
- Вход по одноразовому коду с почты (`/login`, переключатель "Пароль / Код с почты") — как 2FA-альтернатива паролю
- Нижняя навигация (Чаты / Контакты / Настройки / Профиль) и папки чатов (Все / Личные / Группы / Каналы) — ближе к Telegram
- Русские шаблоны писем — см. `supabase/email-templates-ru.md`, вставить вручную в Authentication → Email Templates
- Профиль чата `/chat-info` (клик по шапке группы/канала) и профиль пользователя `/user` (клик по шапке личного чата) — просмотр, для owner/admin группы/канала доступно редактирование (аватар, название, описание, юзернейм)
- Кастомная галочка верификации (`components/VerifiedBadge.tsx`, файл `public/badges/verified.png`) — используется везде вместо emoji ✔
- Глобальный поиск на странице чатов (`@юзернейм` или имя/название) — среди пользователей и публичных групп/каналов
- Друзья теперь добавляются через этот поиск (кнопка на `/user`), вкладка «Друзья» ищет только среди уже добавленных
- Подтверждение регистрации кодом с почты вместо ссылки (`verifySignupCode`)
- Живое появление сообщений без перезагрузки (Realtime включён для таблицы `messages` миграцией 0011) + время отправки в каждом сообщении
- `/privacy` — политика конфиденциальности, обязательный чекбокс согласия при регистрации (152-ФЗ)
- Вход через Google скрывается для посетителей из России (гео-IP лукап, `lib/geo.ts`)
- Плавные анимации появления страниц/сообщений, переход темы

## Запуск

1. Создать проект на supabase.com (бесплатный тариф)
2. Применить миграции **строго по порядку** в SQL Editor (каждый файл — отдельным запросом):
   - `0001_init.sql`
   - `0002_role_security.sql`
   - `0003_auto_create_profile.sql`
   - `0004_fix_admin_stats_security.sql`
   - `0005_fix_chat_members_recursion.sql`
   - `0006_friends_privacy_avatars.sql`
   - `0007_fix_chats_returning_rls.sql`
   - `0008_fix_direct_chat_members_insert.sql`
   - `0009_fix_bootstrap_role_trigger.sql`
   - `0010_chat_avatars_storage.sql`
   - `0011_realtime_bio_lastseen_privacy.sql`
   - `0012_privacy_consent.sql`
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
