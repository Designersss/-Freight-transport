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

Перед выбором production модели необходимо проверить резервирование namespace на ВСЕХ email endpoints и запрещение доставки/verification/reset для внутреннего идентификатора, привязку настоящего email только с подтверждением владения, изоляцию ролей и явное связывание, проверку Telegram issuer/audience/nonce/state и replay. Не выдавать внутренний идентификатор за реальный email и не показывать его в UI. Тест ещё не запущен; физическая схема и runtime не меняются.
