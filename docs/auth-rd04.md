# RD-04 — авторизация и границы доступа MOVARO

Задача #5, родитель #1. Основание: решения владельца 26.11.2026 и принятый RD-03 (#22). Это проектирование первого среза, не реализованный runtime.

## Подтверждённые требования

- Четыре взаимоисключающие роли: PLATFORM_ADMIN, COMPANY_OWNER, DISPATCHER, DRIVER (технические имена предлагаются здесь). Публичная регистрация только для последних трёх; роль после назначения не редактируется самим пользователем.
- Имя и фамилия обязательны. Возраст водителя и фото необязательны. Не требовать возраст для завершения регистрации. Данные компании, категории и назначения техники — последующие этапы.
- Email/пароль и Telegram; для Telegram не требовать email/пароль. Привязка только после доказанного владения обоими аккаунтами. Не связывать по совпадению имени, username или непроверенной почты. Глобальный администратор — отдельный Web Admin, без публичной регистрации и Telegram-входа.
- Подтверждение реального email ссылкой, сброс пароля одноразовой ссылкой на 15 минут, список сессий и отзыв. Деактивация с проверкой активных операций и необходимой историей; не обещать физическое удаление без отдельной политики хранения и юридического review.
- Первый PLATFORM_ADMIN создаётся защищённой серверной командой, без секретов в CLI arguments, Git и логах.
- Реальные формы RU/EN, dark/light, общая UI-библиотека. Принимаются в браузере.

## Предлагаемая архитектура

Единственный runtime авторизации — NestJS API (Better Auth как библиотека, без параллельного Next auth backend). Общие контракты и схемы в packages/auth или contracts по реальной необходимости; Next web/admin потребляют API. Серверный guard получает сессию из cookie, проверяет состояние пользователя и серверную роль; UI не является границей безопасности. Точные origin, host-only HttpOnly cookies, Secure в HTTPS, CSRF/origin validation. Никакого хранения session token в localStorage. Топология reverse proxy и cookie isolation Web/Admin требуют отдельной проверки перед включением маршрутов. Не открывать production Admin до проверки guards и негативных тестов.

Применяем Better Auth 1.7.28, уже проверенный в RD-02 изолированным PostgreSQL/Testcontainers и Fastify adapter (не production runtime). Сначала сверить схему и API точной версии; миграции управляются Prisma, не автоматически при старте приложения. Не дублировать хранение паролей/сессий в собственных таблицах.

Логические сущности (не физическая схема):

- User — устойчивый ID, имя, фамилия, роль, статус, timestamps; данные идентификации и сессии принадлежат Better Auth. Не возвращать внутренние поля/секреты через публичный API.
- Account — уникальность идентичности по provider + provider account ID; credential и Telegram принадлежат одному User при подтверждённой привязке.
- Session — серверные сессии, отзыв и проверка деактивации. Не полагаться на устаревший cookie cache для авторизации.
- Verification — токены подтверждения/сброса по поддерживаемой схеме Better Auth, не логировать, проверять срок/одноразовость.
- DriverProfile — дополнительные необязательные данные водителя. Возраст nullable, не вводить дату рождения без согласования. Фото — через private storage после проверки прав и типа файла.

Назначение роли и профиль не должны принимать произвольные поля от клиента. Данные и права проверять сервером; уникальные ограничения и конкурентные тесты на дублирующую регистрацию/привязку. Никакого доступа к бизнес-операциям до завершения onboarding. Отдельно проверять запрет входа/отзыва активных сессий деактивированного аккаунта.

## Критические вопросы реализации

1. Better Auth 1.7.28 требует строковое поле email в core user schema, а email sign-up проверяет формат. Telegram-only регистрация не должна требовать email согласно утверждённому ТЗ. До выбора физической схемы выполнить compatibility spike на точной версии: поддерживаемый способ идентификации без настоящего email, изоляция от email login/reset/verification и implicit linking, исключение коллизий. Не создавать вымышленные реальные email, не отмечать непроверенную почту verified, не менять ядро Better Auth вручную. Если поддерживаемый вариант отсутствует, вынести альтернативу на согласование до реализации Telegram. Не объявлять сценарий готовым.
2. Email delivery: реальный транспорт, в dev/test локальный почтовый приёмник и настоящие письма; production требует настроенный SMTP/провайдер и безопасную конфигурацию. Не делать no-op sendVerificationEmail и не выводить токены в логи. Проверить доставку, срок, повторное использование, отсутствие enumeration и rate limits.
3. Telegram: официальный механизм входа, проверка подписи/issuer/audience/nonce/state и replay защиты по выбранному протоколу. Не использовать username как ID; не доверять полям клиента. Точный протокол и поддерживаемая интеграция проверяются отдельно до кода.
4. Деактивация и активные операции: до появления бизнес-модулей не имитировать успешную проверку активных заявок. Определить контракт policy и не открывать неполноценную операцию в production. Отдельно политика хранения/удаления персональных данных.

## Последовательность

1. Архитектурный документ, совместимость Better Auth, миграции и конфигурация.
2. Реальная регистрация/email verification/login/logout/reset, транспорт почты, тесты реальной БД и HTTP.
3. UI login/signup/role selection/reset, Zod + React Hook Form, общие компоненты, локализация, E2E.
4. Telegram login/link/unlink с негативными и конкурентными тестами.
5. Роли, policies, admin bootstrap, отдельные защищённые кабинеты и сессии; проверка границ API и SSR.
6. Профиль, настройки, деактивация по применимым правилам; полный CI и ручная приёмка.

Каждый срез не подменяет следующего. Не сливать PR до зелёного CI и разрешения владельца. Перед реализацией проверять официальные документы/API закреплённых версий.

## Проверенные исходники

- https://github.com/better-auth/better-auth/blob/v1.7.28/packages/core/src/db/schema/user.ts — email пока обязательный; комментарий о возможном изменении в v2.
- https://github.com/better-auth/better-auth/blob/v1.7.28/packages/core/src/types/init-options.ts — emailVerification, requireEmailVerification, sendResetPassword, resetPasswordTokenExpiresIn, trustedOrigins, session/cookieCache и accountLinking.
- https://github.com/better-auth/better-auth/blob/v1.7.28/packages/better-auth/src/api/routes/sign-up.ts — email sign-up и проверка email.
- https://github.com/better-auth/better-auth/blob/v1.7.28/packages/better-auth/src/plugins/generic-oauth/index.ts — generic OAuth; не подтверждает совместимость Telegram-only.
- scripts/auth-compat/compat.test.mjs — принятый тест Fastify, PostgreSQL, session и SSE; не заменяет тесты production auth.

## Compatibility spike: email-less OAuth (только тест)

Добавлен scripts/auth-compat/email-less-oauth.test.mjs в существующий изолированный Testcontainers runner (последовательный запуск, без новых зависимостей). Проверяется documented genericOAuth mapping на реальной БД: исходный профиль без email отклоняется без mapping; детерминированный внутренний идентификатор в зарезервированной зоне .invalid не является почтой пользователя и остаётся emailVerified=false; повторный вход по тому же provider ID не дублирует запись, второй subject изолирован, state tampering отклоняется, пароль не создаётся. Симулируется только внешний OAuth provider через getToken/getUserInfo; это не подтверждает Telegram OIDC, подписи/JWKS или доставку почты. Источники: https://github.com/better-auth/better-auth/blob/v1.7.28/packages/better-auth/src/plugins/generic-oauth/types.ts ; https://github.com/better-auth/better-auth/blob/v1.7.28/packages/better-auth/src/plugins/generic-oauth/generic-oauth.test.ts .

Перед выбором production модели необходимо проверить резервирование namespace на ВСЕХ email endpoints и запрещение доставки/verification/reset для внутреннего идентификатора, привязку настоящего email только с подтверждением владения, изоляцию ролей и явное связывание, проверку Telegram issuer/audience/nonce/state и replay. Не выдавать внутренний идентификатор за реальный email и не показывать его в UI. Локальный прогон 26.11.2026: 2/2 Testcontainers, 0 падений, 3 прежние миграции, сборка 9/9 из кеша; исправления Biome отправлены 52d9de3. Реальный Telegram ещё не проверен.

## Физическая модель — первый migration срез

Prisma управляет стандартными таблицами Better Auth 1.7.28 (user/account/session/verification и rateLimit для дальнейшего database-backed rate limiting), сохраняя физические camelCase поля для ранее проверенного pg adapter. ID Better Auth — TEXT, время — TIMESTAMPTZ(6); никаких runtime schema migrations. Добавлены уникальность provider+account, email, session token и rate limit key, внешние ключи, индексы и ограничения нормализации/неподтверждённого внутреннего email @telegram.invalid.

Профиль MOVARO — отдельная таблица user_profiles, один User → максимум один профиль с обязательной ролью и именем/фамилией. Отсутствие профиля означает незавершённый onboarding; будущие guards должны отказать в бизнес-доступе. Пока у водителя только одно дополнительное поле, nullable driverAge хранится в общем профиле с CHECK только для DRIVER; отдельный DriverProfile не создаём без необходимости. Возраст, фото необязательны, положительный возраст при наличии; окончательная верхняя граница не согласована. Фото — ключ приватного объекта, загрузка пока не реализована. Статус ACTIVE/DEACTIVATED, FK RESTRICT не даёт случайно удалить пользователя с профилем. Смена роли, выдача admin, проверка деактивации и email namespace на HTTP остаются будущими server policies, не гарантия одной миграции. Не добавляем FK к существующим user_event_streams до реализации миграции бизнес-получателей и проверки прежних тестов.

Testcontainers больше не запускает Better Auth runtime migrations: read-only план getMigrations должен не требовать создания таблиц, колонок и индексов. Добавлен тест реальной Prisma модели и SQL constraints, включая конкурентную уникальность provider account, необязательный возраст и FK. Владелец подтвердил 26.11.2026: Prisma validate, реальная генерация клиента, build 9/9 (6 cached), 4/4 migrations, 3/3 Testcontainers без пропусков. Исправления форматирования отправлены 2e0d34c. Финальный CI ещё не подтверждён. Источники точной версии: https://github.com/better-auth/better-auth/blob/v1.7.28/packages/core/src/db/get-tables.ts ; https://github.com/better-auth/better-auth/blob/v1.7.28/packages/better-auth/src/db/get-migration.ts ; https://github.com/better-auth/better-auth/blob/v1.7.28/packages/core/src/db/database-index.ts . Prisma 6: https://www.prisma.io/docs/orm/prisma-migrate/workflows/customizing-migrations .

## Auth package и SMTP

Добавлен @freight/auth с закреплёнными Better Auth 1.7.28, pg 8.16.3, Nodemailer 10.6.1 (встроенные TS типы, MIT-0, Node >=20), Zod. Factory задаёт подтверждение email, 15 минут сброса пароля, отзыв сессий при reset, database rate limiting, выключенный cookie cache и implicit linking, запрет deleteUser; пароль 12–128 символов (инженерный выбор). SMTP использует TLS/STARTTLS с обязательной проверкой сертификата в production, незашифрованный режим только для локального dev/test без credentials. Внутренние .invalid адреса никогда не получают письма. Ссылки mail формируются Better Auth, проверяются по origin/path; ошибки доставки не включают исходный ответ SMTP. Тексты пока двуязычные; локализацию писем доработать с UI.

Пакет ещё не подключён к маршрутам NestJS; это реальный factory и SMTP transport, а не работающий публичный auth API. Перед экспозицией проверить HTTP allowlist, reserved-email namespace на всех входах, защищённый proxy/IP для rate limit, проверки профиля и деактивации, реальные SMTP письма в локальном изолированном тесте. Не включать публичные routes до этих проверок. Потребуется реальный lockfile, typecheck, unit, build, license review и интеграция. Источники: https://github.com/nodemailer/nodemailer/blob/v10.6.1/package.json ; https://github.com/nodemailer/nodemailer/blob/v10.6.1/src/nodemailer.ts ; https://github.com/nodemailer/nodemailer/blob/v10.6.1/LICENSE ; https://nodemailer.com/smtp ; https://github.com/better-auth/better-auth/blob/v1.7.28/packages/core/src/types/init-options.ts .

## Email HTTP срез

Локальная проверка предыдущего пакета: frozen lockfile, typecheck 23/23, test 18/18 задач, build 10/10, auth 13/13, license tests 9/9, 729 пакетов, 0 unreviewed, Testcontainers 3/3. Коммит feb9dcf. @types/bun 1.3.4 с точечным override @types/node 24.0.0 и node:test в auth устраняет конфликты без skipLibCheck.

AuthModule подключается явно в createApp; main включает его только AUTH_ENABLED=true в dev/test. Production активация запрещена до приёмки guards, onboarding, deactivation и proxy topology. Публичный адаптер допускает только перечисленные email/session routes, строгие JSON schemas, exact Origin на POST, callback URLs только из конфигурации, ограничение 16 KiB, IP из Fastify без trustProxy, не возвращает raw token. Не реализованы CORS/Next proxy, профиль и role selection, admin boundary, production deploy. Для tests используется реальный SMTP Mailpit v1.34.0 (MIT, upstream https://github.com/axllent/mailpit/releases/tag/v1.34.0), локальные опубликованные порты, контейнер останавливается в finally. Новый интеграционный тест проверяет signup, mail verification, cookie session, reset expiry/one-time/revocation. Не подтверждён запуск; lockfiles необходимо обновить настоящими package managers. До RD-18 требуется review образа Mailpit, не включать в production.
