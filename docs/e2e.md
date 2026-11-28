# MOVARO — браузерные проверки RD-03/RD-04

Отдельный private workspace apps/e2e, Playwright Test 1.60.0 (Apache-2.0), axe-core 4.14.1 (MPL-2.0, ранее проверенная точная версия для разработки/CI). Никаких новых production-зависимостей. Проверки используют собранный Web, собранную защищённую Admin, dev Admin и статическую сборку Storybook; портами 3100/3101/3102/6106 не занимаем обычные локальные 3000/3001/6006. Запущенные чужие процессы не переиспользуем.

Локально:

```bash
pnpm install --frozen-lockfile
pnpm e2e:install
pnpm build
pnpm test:e2e
```

В CI после полного build устанавливаем Chromium с системными зависимостями и запускаем controlled E2E в отдельном обязательном browser job. Real auth E2E выполняется в integration job с собственным runtime build и Chromium. Таймаут каждого job 20 минут, все результаты обязательны для quality. Тесты без retry и skip. При падении — trace/screenshot в игнорируемом test-results.

Сценарии: RU/EN и query, cookie темы после reload и навигации, клавиатурный skip link, dev-admin anonymous login и отсутствие защищённой навигации, production admin закрыт (404), валидация формы Storybook в RU/dark и EN/light, семантика таблицы, отсутствие горизонтального переполнения, axe по тегам WCAG 2.0/2.1 A/AA. Два Chromium-проекта — desktop и эмуляция мобильного viewport 375px. Это не реальный мобильный браузер и не полноценный WCAG-аудит. WebKit/Firefox, другие компоненты/размеры, ручная проверка и реальные бизнес-сценарии после RD-04 остаются открытыми.

Исторические результаты RD-03 ниже не являются подтверждением текущей ветки RD-04. Источники: https://playwright.dev/docs/test-configuration ; https://playwright.dev/docs/test-webserver ; https://playwright.dev/docs/accessibility-testing ; https://github.com/microsoft/playwright/blob/v1.60.0/packages/playwright-test/package.json ; https://github.com/dequelabs/axe-core/blob/v4.14.1/LICENSE .

26.11.2026 владелец подтвердил локальный запуск macOS ARM64: Chromium 148.0.7778.96, typecheck прошёл, build 9/9, все 16 E2E прошли за 59,8 с без retry/skip, license policy 8/8, 724 установленных пакета, 0 непроверенных. Изменения и lockfile в 957f65c. Финальный CI на Linux ещё не подтверждён. Browser binaries отдельно не распространяются.

## CI runner compatibility

Run 45881174837 прошёл frozen install, OpenAPI, lint, typecheck, unit и build, но не установил Chromium: ubuntu-latest использовал Ubuntu 26.04, которую Playwright 1.60.0 не поддерживает. Закрепляем ubuntu-24.04 для всех рабочих CI jobs, не исключая браузерные, лицензионные или интеграционные проверки. Источники: https://github.com/microsoft/playwright/blob/v1.60.0/packages/playwright-core/src/server/registry/nativeDeps.ts ; https://github.com/actions/runner-images . Повторный Linux CI обязателен.

## RD-04 — реальная email-авторизация в браузере

Отдельная конфигурация playwright.auth.config.ts запускается обязательным шагом Better Auth and SSE integration with PostgreSQL Testcontainers. Использует временный PostgreSQL с отдельной БД freight_auth_browser, Mailpit v1.34.0 и реальные Web/API/Admin на loopback-портах 3110/4110/3111. Случайные тестовые учётные данные, SMTP только локально; production не активируется. Playwright не переиспользует запущенные серверы, trace, screenshot и video отключены для этого сценария из-за одноразовых ссылок и cookies. После тестов Testcontainers удаляет временные контейнеры. Обычные desktop/mobile E2E и интеграционные тесты сохранены.

Сценарий Chromium desktop, RU: email-first signup, получение настоящего письма через Mailpit API, явное подтверждение ссылки, создание пароля/роли/профиля/username, отсутствие сессии до и после complete, отдельный вход, проверка кабинета водителя, настроек, фото, смены пароля, сессий и logout/replay. Отдельный Admin сценарий проверяет bootstrap и границу cookie. Это не полная матрица UI или тест всех ролей; новый полный quality ещё не подтверждён.

Локально после frozen install, сборки и установки Chromium:

```bash
npm --prefix scripts/auth-compat ci --ignore-scripts --no-audit --no-fund
node scripts/auth-compat/testcontainers.mjs
```

Требуется локальный Docker, свободные порты 3110/4110/3111 и настроенное изолированное локальное S3 (см. infra/README.md). Не подключать production БД, SMTP или bucket. Источники: https://playwright.dev/docs/test-webserver ; https://playwright.dev/docs/api/class-apirequestcontext ; https://mailpit.axllent.org/docs/api-v1/ ; https://node.testcontainers.org/features/containers/ .

## Изоляция axe в браузерных тестах Storybook

CI 45986801409: 27 из 28 E2E прошли; desktop-тест таблицы завершился ошибкой Axe is already running. Storybook 10.6.9 автоматически запускает axe в afterEach, а Playwright отдельно вызывает expectAccessible. В тестовых URL устанавливаем globals=a11y.manual:!true, чтобы в этих preview только Playwright запускал аудит. Обычный Storybook сохраняет автоматический аудит и a11y.test=error. Правила, область проверки, assertions, число тестов и CI не меняются. Повторный запуск должен подтвердить устранение гонки.

Источники: https://storybook.js.org/docs/writing-tests/accessibility-testing ; https://github.com/storybookjs/storybook/blob/v10.6.9/code/addons/a11y/src/preview.tsx ; https://github.com/storybookjs/storybook/blob/v10.6.9/code/core/src/preview-api/modules/preview-web/parseArgsParam.ts .

## RD-04 — регистрация и настройки профиля

Email-first завершает профиль и credential в одной транзакции до первого входа. GET /profile возвращает сохранённый профиль активной сессии, null — только для подтверждённой Telegram identity до завершения onboarding. Старый POST /profile удалён, прямой API возвращает 405, Web bridge не пропускает POST. При отсутствии email-профиля доступ отклоняется без формы создания. Редактирование имени, фамилии, даты рождения — POST /profile/settings; роль неизменна.

Реальный email E2E проверяет профиль, созданный при регистрации, readback/reload и недоступность прежнего POST /profile через Web. Контролируемые UI-тесты RU/dark и EN/light в обоих Chromium проектах проверяют локальную валидацию даты, календарь и сохранение ввода при 503 в ProfileSettings, axe и overflow. Оставшиеся комбинации тем/локалей и ручная визуальная приёмка ещё открыты.

Проверки фото профиля RD-04: отдельные контролируемые тесты RU/dark и EN/light на desktop/mobile Chromium (инициалы, локальный отказ файла, upload/replace, отмена и подтверждение удаления, axe/overflow), реальный RU desktop email-auth сценарий через Web/API/PostgreSQL/S3 проверяет загрузку, сохранение после reload и удаление. Для реального запуска требуются изолированные S3_* и доступный SeaweedFS, как в quality workflow. Результаты ещё не подтверждены; остальные комбинации и ручная проверка внешнего вида остаются открыты.

RD-04 персональные данные: EN/light контролируемый сценарий на desktop/mobile Chromium проверяет невалидную дату, сохранение черновика после 503, повтор и обновлённое имя; реальный RU desktop email-auth сценарий сохраняет имя/дату и проверяет reload. Результаты не подтверждены.

Telegram UI: добавлены контролируемые тесты capability/start (EN login, RU signup) и Telegram-only onboarding (EN), без внешнего запроса к Telegram, desktop/mobile Chromium. Проверяют отсутствие email/password/photo на шагах, suggestion/registration payload, активный профиль после reload, отказ внешнего redirect. Реальный browser OAuth callback и полная матрица тем/локалей пока не подтверждены.

Telegram settings: controlled EN/light desktop/mobile Chromium сценарий проверяет server permissions, callback error, первоначальную привязку, постоянный статус без кнопки отвязки и отказ внешнего redirect. Результаты не подтверждены; RU/dark и реальный OAuth требуют приёмки.

Email change: controlled tests cover settings form, unchanged old address, stale-session error, RU/EN fragment confirmation, explicit POST only, second-stage success, sign-in link and invalid missing fragment. Real SMTP HTTP scenario separately registered in auth compatibility; actual browser/mail roundtrip and dark/light matrix not yet confirmed.

Cabinets: real browser driver sign-in now redirects to /ru/cabinet/driver, direct visits to owner/dispatcher show denied without role content, settings link opens /ru/account, logout blocks direct driver cabinet access. Server role matrix is covered separately in cabinet-access integration fixture. Results and RU/EN dark/light visual matrix not confirmed.

RD-04 Admin: прежний dev demo test заменён anonymous login/locale/validation/absence of protected sidebar, production page+API denial. Изолированная auth-browser конфигурация дополнительно поднимает Admin 3111, synthetic CLI bootstrap via stdin, login, reload, public cookie isolation, logout/replay; результаты не подтверждены.

RD-04 deactivation: new PostgreSQL/runtime test covers confirmation, origin, stale session, two simultaneous requests, retained identity/Telegram/credential, reset and email-change invalidation, revoked sessions and rejection of late inserts. Browser settings confirmation and actual test runs remain open.

Deactivation settings: controlled UI case covers explicit confirmation, cancel with focus restoration, no request before confirmation, stale session error, server-confirmed success and removal of private settings, return to login and refusal to reopen account. Actual browser/PG results remain unconfirmed.

## RD-04 — обратная связь при восстановлении пароля

Контролируемые Playwright тесты проверяют отказ reset API, очистку пароля, успешный повтор, переход на login?reset=done и локализованное role=status, отличное от сообщения о регистрации. RU/EN × dark/light × Chromium desktop/mobile — 8 экземпляров тестов; axe и overflow включены. Это проверка UI с тестовыми ответами, а не доказательство реального восстановления credential. Результаты ещё не подтверждены.

## Выборочный запуск controlled auth suites

После рефакторинга auth.spec.ts содержит login/recovery; auth-registration.spec.ts — регистрацию; auth-profile.spec.ts — профиль, username и фото; auth-telegram.spec.ts — Telegram; auth-account.spec.ts — email change и деактивацию. auth-fixtures.ts регистрирует общую подготовку fallback Telegram settings отдельно в каждом файле. Все прежние сценарии остаются в стандартном test:e2e; отдельная конфигурация реального auth E2E не изменена.

```bash
pnpm --filter @freight/e2e exec playwright test tests/auth-registration.spec.ts
pnpm --filter @freight/e2e exec playwright test tests/auth-profile.spec.ts --project=chromium-desktop
pnpm --filter @freight/e2e exec playwright test --list
```

Выборочный запуск предназначен для локальной диагностики, не замена обязательной полной матрицы. Web servers из общей конфигурации пока стартуют даже при выборе одного файла. Новые результаты запуска ещё не подтверждены.

Интеграционный runner отдельно создаёт disposable DB freight_auth_readiness (клон свежей мигрированной compat DB до тестовых записей) для DDL fault injection; обычные auth-compat тесты не используют её. Реальный браузер сохраняет отдельную свежую freight_auth_browser. Все группы пока последовательны. Результат новой изоляции требует полного CI.

В полном CI оба browser-capable jobs устанавливают только Chromium headless shell с системными зависимостями (playwright install --with-deps --only-shell chromium). Текущие Playwright configs используют default headless Chromium, не custom channel. Локальная установка и ручной headed запуск не изменены. Admin real E2E использует next dev; повторный production build Admin в integration исключён, полный build и production Admin gate остаются в browser job. Фактический результат нового CI ещё открыт.
