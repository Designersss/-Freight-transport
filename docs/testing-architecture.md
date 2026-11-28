# MOVARO — архитектура тестирования и производительность CI

Статус: первый срез рефакторинга RD-04, PR #24. Цель — ускорение обратной связи без потери проверяемых требований. Не меняем бизнес-логику, стек, зависимости, branch protection и обязательную ручную приёмку.

## Baseline

[CI #122](https://github.com/Designersss/-Freight-transport/actions/runs/46091265146), head 0eb326e6ff71119642ddbd279e1dfb1ebbdf1a0f, Ubuntu 24.04, pinned Node/pnpm. Frozen install, audit, OpenAPI, lint и typecheck прошли. Turbo API build 16.589 s (5/5), typecheck graph 45.6 s (23/23), test graph 3.891 s (17/18 tasks), API 32/33 tests. document.test.ts ожидал только два health path, но контракт уже содержит 32 paths / 36 operations. Последующие build, E2E, integration, license и real auth suites были skipped, полного baseline времени пока нет.

Typecheck graph включает production builds Next Web (компиляция 21.3 s), Next Admin (23.7 s) и Storybook (30.94 s); они перекрываются по времени, складывать их нельзя. Часть логов build воспроизводится из локального Turbo cache на этапе tests: это не доказательство повторной физической сборки. Quick Checks #62 typecheck 23/23, 309 lint files. Общий прогон после исправлений нужен для настоящих данных по медленным сценариям.

## Распределение проверок

- Unit: Vitest 4.1.12 / node:test — правила пароля, даты, username, IP, file policy, mapping, DTO, чистые вычисления. Дешёвые edge cases остаются.
- Contract/HTTP: Nest/Fastify inject, точный публичный allowlist, реальные коды, DTO, cookie/Origin, Orval drift. Публичный контракт проверяем в итоговом документе, а не независимыми дублирующими списками.
- Integration: PostgreSQL 17/Prisma 6.19.0, pg-boss, SeaweedFS 4.51, Mailpit, Better Auth 1.7.28, 18 compat files. Реальные constraints, транзакции, конкурентность, revoke, replay, права, cleanup и отказ внешней системы остаются обязательными.
- Controlled browser: Playwright 1.60.0 + axe, UI состояния с управляемыми ответами, темы/локали/viewport и accessibility. Не считать его реальным backend E2E.
- Real E2E: signup → email → proof → login → role cabinet → settings/logout, отдельный Admin, ключевые переходы credential/session. Не проходить все комбинации серверной валидации через браузер.
- Stack smoke: реальные процессы, зависимости, запуск и перезапуск, health/readiness. Performance/security/load — отдельно, по риску, не вместо функциональных тестов.

## Срез 1

1. Устаревший assertion из document.test.ts заменён точным allowlist методов и путей, перенесённым из auth-paths.test.ts: 34 auth + 2 health. Уникальность operationId проверяется на итоговом документе. DTO/security/secret exclusions, Swagger dev/prod и readiness assertions сохранены. Один самостоятельный test case объединён с проверкой композиции; число наблюдаемых утверждений не уменьшается.
2. В turbo.json только Web/Admin/Storybook typecheck использует ^build вместо обязательной собственной сборки. Next typegen + tsc и Storybook tsc сохраняются. Остальные tasks и dependency builds, включая Prisma generation, прежние. Полный production build остаётся в quality. Проверить clean-run graph, API/TS и время; если проблема с generated types — исправить явную зависимость, не ослаблять tsc.
3. Дополнен обязательный movaro-testing skill. Не внедряются сторонние библиотеки или скрипты.

## Следующие срезы (план, не реализовано)

1. Инвентаризировать все тесты и assertions: требования #5, дубликаты, время, внешние зависимости, негативные/конкурентные сценарии. Разбить крупные auth.spec.ts и общий integration runner по доменам с общими fixtures без зависимости от порядка. Переносить утверждение только после проверки эквивалентности. Добавить test.step для диагностики длинных сценариев без утечки данных.
2. Измерить реальный baseline отдельных suites. Проверить граф Turbo test: не убирать dependency builds до проверки source/dist imports. Устранить лишний build и повторный setup, если подтверждено измерением.
3. Спроектировать CI DAG: независимые static/unit, build/browser, database/storage/worker/real auth и security/license lanes; при необходимости общий build artifact только после проверки размера/передачи и platform consistency. Сравнить setup overhead, runner time и wall-clock. Сохранить status quality как строгий агрегатор всех обязательных job результатов, без ослабления ветки и без пропуска обязательного job при ошибке соседнего. Не переносить обязательные тесты исключительно на nightly.
4. Для Playwright проверить безопасный параллелизм/sharding и стоимость 4 web servers, оставить fresh context. Для real auth и PostgreSQL сначала изоляция: отдельная БД или schema там, где допустимо, выделенный S3 namespace, отдельные mailboxes, отсутствие общих reset/cleanup. Не увеличивать --test-concurrency=1 вслепую.
5. Сравнить время и результаты, повторить полный quality, составить ручную приёмку. Оптимизацию считать успешной только при сохранённой карте покрытия и реальном измерении.

## Изученные навыки и источники

- [wshobson e2e-testing-patterns](https://github.com/wshobson/agents/blob/main/plugins/developer-essentials/skills/e2e-testing-patterns/SKILL.md), blob b3f258d2afc635866a7d264d6f817b467c037e2b: разделение уровней, независимые сценарии, проверки публичного поведения. Не переносим Cypress, механический POM или обязательные testid вместо семантических locators.
- [Currents Playwright best practices](https://github.com/currents-dev/playwright-best-practices-skill/blob/main/playwright-best-practices/SKILL.md), blob 0da736253c343081ab8c0cb9802729a707c23196: каталог просмотрен; [performance](https://github.com/currents-dev/playwright-best-practices-skill/blob/main/playwright-best-practices/infrastructure-ci-cd/performance.md), blob e3a6293288b252baf6e7ab12e501eb9bc4b715fd: изучены parallelism, isolation, resource management. Не использовать рекомендации skip, общего mutable state или блокировки стилей для ускорения.
- [Turbo task graph](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks), [package-specific tasks](https://turborepo.dev/docs/reference/package-configurations), [Next CLI typegen](https://nextjs.org/docs/app/api-reference/cli/next): зависимость от ^build, самостоятельная генерация типов. Сверены фактические scripts/tsconfig закреплённых пакетов.
- [Vitest performance](https://vitest.dev/guide/improving-performance), [Playwright sharding](https://playwright.dev/docs/test-sharding), [Testcontainers containers](https://node.testcontainers.org/features/containers/), [GitHub jobs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs): профилирование, изоляция и план DAG. Общая документация может включать новые API — перед кодом сверять pinned versions. Не внедрены новые CLI, инструменты или настройки из этих источников.
- Matt Pocock TDD: найден каталог, прямой исходник по проверенному пути недоступен; не объявляется изученным upstream skill. Действующие правила TDD остаются.

Upstream материалы — справочные, не импортированы и не исполнены. Полного лицензионного аудита upstream нет; собственный skill написан для MOVARO. Локальный pinned toolchain недоступен, доказательство нового результата — CI на новом head.

## Срез 2 — разбиение controlled browser suite

Исходный auth.spec.ts: 1320 строк, 16 синтаксических объявлений test, 237 вызовов expect. Разделён на пять файлов по доменам: login/reset, registration, profile/username/photo, Telegram, account/email/deactivation. Сохранены дословно тела всех сценариев и параметризующие циклы; проверено статическое равенство исходных блоков и всех объявлений test, 237/237 expect. Общий beforeEach с fallback Telegram settings вынесен в registerAuthFixtures; hook регистрируется явно в каждом файле, fresh page и порядок локальных route overrides не меняются. Full suite и 2 Chromium projects сохраняются. Разбиение само по себе не доказывает ускорение: fullyParallel уже был включён. CI #63 (46091641205): frozen install/api:check PASSED, единственный formatter error в turbo.json, typecheck skipped. Формат исправлен без изменения JSON semantics.

Инвентаризация: 40 изменённых тестовых файлов на 44e9043, 18 auth-compat файлов прочитаны по структуре/утверждениям. schema-readiness.test.mjs временно изменяет общие таблицы, колонки, triggers/constraints; параллельный запуск на той же БД небезопасен. email-auth-http.test.mjs — 1249 строк и 277 вызовов assert в двух верхнеуровневых сценариях; отдельный кандидат на разбиение с независимым setup. Не удалены security, DB, SMTP, S3, role, concurrency или UI assertions. Полная карта требований и полный каталог неизменённых тестов ещё не завершены.

## Срез 3 — изоляция readiness и HTTP suites

Quick Checks #64 (46092113531) на 1173bc5: frozen install, api:check (5/5, 14.856 s), Biome 315 files, typecheck 20/20 tasks, 25.169 s. Baseline #122 typecheck 23/23, 45.6 s; разница 20.431 s (~44.8% меньше), сравнение отдельных CI runs, не benchmark с повторениями. Next/Storybook production builds исключены только из typecheck; next typegen и tsc подтверждены. Полный build и quality не подтверждены.

Readiness DDL/migration fault injection выполняется отдельно в freight_auth_readiness. Runner создаёт её через createdb -T freight_auth_compat после свежего db:deploy, до запуска любых тестов; соединения исходного migration process уже закрыты, при ошибке clone runner прекращает работу. Тест проверяет loopback и точное имя БД до любого изменения. Обычная compat DB не подвергается DDL fault injection. Обе БД существуют только в disposable Testcontainers PostgreSQL; browser DB по-прежнему создаётся отдельно и мигрируется с нуля. Отдельный subprocess readiness не делит состояние с остальными; все группы пока выполняются последовательно. Не увеличиваем concurrency до проверки isolation и runtime baseline.

email-auth-http.test.mjs разделён по двум уже независимым test blocks: SMTP/Fastify/photo/reset и username-session-http.test.mjs (claim, profile, roles, credential/session rotation, rate limit). Тела сценариев сохранены дословно, 277/277 assert calls, без изменения setup/cleanup внутри тестов. Runner регистрирует 19 файлов вместо 18 (все исходные плюс новый), отдельная readiness группа и обычная compat группа. Фактический запуск ещё не подтверждён. Источники: PostgreSQL 17 createdb https://www.postgresql.org/docs/17/app-createdb.html, Testcontainers exec/stop https://node.testcontainers.org/features/containers/, Node 24.22.3 test runner https://nodejs.org/docs/latest-v24.x/api/test.html. Новых зависимостей нет.
