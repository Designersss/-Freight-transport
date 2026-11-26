# Ревизия архитектуры MOVARO — RD-03

База: d02167e1, PR #22. Ревизия выполняется в отдельной ветке, чтобы не изменять принятую историю main. Задачи #1 и #4.

## Изменения

- Внутренняя навигация Header и Sidebar через next-intl createNavigation; конфигурация локалей общая. При переключении языка сохраняется pathname и параметры, активная ссылка вычисляется из маршрута. Нативный anchor оставлен только для skip-link; общий компонент и доступная цель.
- Next.js App Router: proxy, getRequestConfig и плагин next-intl в обоих приложениях, без ручного дублирования /ru redirect.
- NestJS DatabaseModule экспортирует сервис; HealthModule импортирует модуль базы. Область провайдера не ограничена одним контроллером.
- Общие Zod-схемы server environment и безопасные сообщения ошибок вынесены в @freight/config. API и worker используют расширение схемы вместо копипаста.
- S3: один AbortSignal на HTTP-запрос и чтение потока; сохраняются лимит размера, проверка сигнатуры и finally.
- Серверный API transport отклоняет redirect; тест подтверждает, что даже явный redirect: follow не расширяет границы origin.
- Корневые правила разработки и чеклист PR.

- Fastify 5.12.8: прямой pin совпадает с зависимостью NestJS 11.2.12; @fastify/static 10.1.4 соответствует peer ^10.1.2 и содержит исправление безопасности. LogController вместо deprecated disableRequestLogging. Требуется повторный Swagger HTTP test и аудит зависимостей.
- CI для PR в любую ветку, включая этот вложенный PR, без изменения обязательных проверок.

- shadcn: согласованные components.json (new-york, CSS variables, Tailwind v4) в web/admin/ui, package imports/exports, Button и Card со слотами и вариантами на основе официального MIT registry. Сохранены компактные токены и прямой Radix Slot вместо агрегатного пакета. CLI add ещё не запускался; нельзя считать настройку проверенной.

## Источники официальной документации

- Next.js 16 App Router Link: https://nextjs.org/docs/app/api-reference/components/link
- next-intl v4: https://next-intl.dev/docs/routing/navigation ; https://next-intl.dev/docs/routing/setup
- shadcn/ui monorepo: https://ui.shadcn.com/docs/monorepo ; https://ui.shadcn.com/schema.json ; https://ui.shadcn.com/r/styles/new-york-v4/button.json ; https://ui.shadcn.com/r/styles/new-york-v4/card.json
- NestJS dynamic modules: https://docs.nestjs.com/fundamentals/dynamic-modules ; https://docs.nestjs.com/exception-filters
- Zod 4 objects: https://zod.dev/api#objects
- Prisma transactions: https://www.prisma.io/docs/orm/prisma-client/queries/transactions (при изменениях сверять с закреплённой v6)
- AWS SDK v3 S3 streaming: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-s3.html
- Node.js streams: https://nodejs.org/docs/latest-v24.x/api/stream.html#streamaddabortsignalsignal-stream
- Точные версии: https://github.com/nestjs/nest/blob/v11.2.12/packages/platform-fastify/package.json ; https://github.com/fastify/fastify/blob/v5.12.8/docs/Reference/Server.md ; https://github.com/fastify/fastify-static/releases/tag/v10.1.4

## Границы и непроверенные вопросы

Кодовая ревизия основных модулей не равна полному независимому аудиту. SQL/outbox уже используют транзакции и параметризованный запрос; не переписываем без основания. SSE остаётся закрытым до RD-04 и проверки бизнес-получателей. Не меняем авторизацию и контракт OpenAPI в данном срезе. Прочитаны основные runtime-модули API, worker, database, storage, transport и UI; отдельный построчный аудит всех тестов, CI, generated-файлов, lockfile и SQL ещё не завершён.

Не выполнены локальная установка, сборка, интеграционные и браузерные тесты после новых изменений. Требуются настоящий lockfile и pnpm check, pnpm api:check, интеграции, E2E, CI. Не сливать до приёмки.

Открыто: проверка shadcn CLI в реальном монорепозитории, лицензионный блокер SWC/caniuse-lite/libvips/Lightning CSS на macOS и Linux, обязательства поставки. Не добавлять общие разрешения в лицензионную политику до проверки. Ранее pnpm licenses:check не прошёл. В полном отчёте требуется учёт платформенных сборок.

## Повторная проверка и исправления 26.11.2026

По предоставленному локальному логу e8aec5c: typecheck 18/18, test 15/15, build 8/8, API transport 8/8, pnpm api:check успешно, Biome 3 предупреждения, licenses:check 5 REVIEW. Форматирование и lockfile отправлены f5b77b6.

- @nestjs/swagger 11.4.8 заявляет peer @fastify/static ^8 || ^9 || ^10 и @nestjs/common/core ^11.0.1. Источник: https://github.com/nestjs/swagger/blob/11.4.8/package.json . Обновлён точный pin. Требуется новый lockfile и повторный HTTP тест Swagger, проверка OpenAPI/Orval и peer dependencies. Если генерация контракта меняет файлы, проверить diff, не принимать автоматически.
- Статические методы регистрации динамических NestJS-модулей соответствуют https://docs.nestjs.com/fundamentals/dynamic-modules . Три локальных подавления noStaticOnlyClass с причиной только на классах модулей; глобальное правило остаётся включённым. Проверить, что Biome не сообщает неиспользуемые подавления.
- Лицензионная политика: ограниченные точными пакетами исключения для development/CI с явно незакрытыми обязательствами поставки; подробности в docs/third-party-licenses.md. Это инженерное решение, не юридическое заключение. Нужна ручная приёмка владельца.

Новые изменения ещё не проверены полным pnpm check, frozen install, интеграциями или CI. Не мержить.
