# RD-03 — браузерные проверки

Отдельный private workspace apps/e2e, Playwright Test 1.60.0 (Apache-2.0), axe-core 4.14.1 (MPL-2.0, ранее проверенная точная версия для разработки/CI). Никаких новых production-зависимостей. Проверки используют собранный Web, собранную защищённую Admin, dev Admin и статическую сборку Storybook; портами 3100/3101/3102/6106 не занимаем обычные локальные 3000/3001/6006. Запущенные чужие процессы не переиспользуем.

Локально:

```bash
pnpm install --frozen-lockfile
pnpm e2e:install
pnpm build
pnpm test:e2e
```

В CI после build устанавливаем Chromium с системными зависимостями и запускаем E2E в том же обязательном quality job. Таймаут job 20 минут вместо 15, ни одна прежняя проверка не удалена. Тесты без retry и skip. При падении — trace/screenshot в игнорируемом test-results.

Сценарии: RU/EN и query, cookie темы после reload и навигации, клавиатурный skip link, dev-admin активная навигация, production admin закрыт (404), валидация формы Storybook в RU/dark и EN/light, семантика таблицы, отсутствие горизонтального переполнения, axe по тегам WCAG 2.0/2.1 A/AA. Два Chromium-проекта — desktop и эмуляция мобильного viewport 375px. Это не реальный мобильный браузер и не полноценный WCAG-аудит. WebKit/Firefox, другие компоненты/размеры, ручная проверка и реальные бизнес-сценарии после RD-04 остаются открытыми.

Источники: https://playwright.dev/docs/test-configuration ; https://playwright.dev/docs/test-webserver ; https://playwright.dev/docs/accessibility-testing ; https://github.com/microsoft/playwright/blob/v1.60.0/packages/playwright-test/package.json ; https://github.com/dequelabs/axe-core/blob/v4.14.1/LICENSE .

26.11.2026 владелец подтвердил локальный запуск macOS ARM64: Chromium 148.0.7778.96, typecheck прошёл, build 9/9, все 16 E2E прошли за 59,8 с без retry/skip, license policy 8/8, 724 установленных пакета, 0 непроверенных. Изменения и lockfile в 957f65c. Финальный CI на Linux ещё не подтверждён. Browser binaries отдельно не распространяются.

## CI runner compatibility

Run 45881174837 прошёл frozen install, OpenAPI, lint, typecheck, unit и build, но не установил Chromium: ubuntu-latest использовал Ubuntu 26.04, которую Playwright 1.60.0 не поддерживает. Закрепляем ubuntu-24.04 для всего quality job, не исключая браузерные, лицензионные или интеграционные проверки. Источники: https://github.com/microsoft/playwright/blob/v1.60.0/packages/playwright-core/src/server/registry/nativeDeps.ts ; https://github.com/actions/runner-images . Повторный Linux CI обязателен.

## RD-04 — реальная email-авторизация в браузере

Отдельная конфигурация playwright.auth.config.ts запускается обязательным шагом Better Auth and SSE integration with PostgreSQL Testcontainers. Использует временный PostgreSQL с отдельной БД freight_auth_browser, Mailpit v1.34.0 и реальные Web/API на loopback-портах 3110/4110. Случайные тестовые учётные данные, SMTP только локально; production не активируется. Playwright не переиспользует запущенные серверы, trace, screenshot и video отключены для этого сценария из-за одноразовых ссылок и cookies. После тестов Testcontainers удаляет временные контейнеры. Обычные desktop/mobile E2E и интеграционные тесты сохранены.

Сценарий Chromium desktop, RU: регистрация, отказ входа до подтверждения email, получение настоящего письма через Mailpit API, переход по ссылке, вход, выход, повторное использование старой cookie и отказ доступа к account. Отдельно проверяется отсутствие сессии после регистрации и подтверждения почты. Это не полная матрица UI или тест всех ролей.

Локально после frozen install, сборки и установки Chromium:

```bash
npm --prefix scripts/auth-compat ci --ignore-scripts --no-audit --no-fund
node scripts/auth-compat/testcontainers.mjs
```

Требуется локальный Docker и свободные порты 3110/4110. Не подключать production БД или SMTP. Источники: https://playwright.dev/docs/test-webserver ; https://playwright.dev/docs/api/class-apirequestcontext ; https://mailpit.axllent.org/docs/api-v1/ ; https://node.testcontainers.org/features/containers/ .

## Изоляция axe в браузерных тестах Storybook

CI 45986801409: 27 из 28 E2E прошли; desktop-тест таблицы завершился ошибкой Axe is already running. Storybook 10.6.9 автоматически запускает axe в afterEach, а Playwright отдельно вызывает expectAccessible. В тестовых URL устанавливаем globals=a11y.manual:!true, чтобы в этих preview только Playwright запускал аудит. Обычный Storybook сохраняет автоматический аудит и a11y.test=error. Правила, область проверки, assertions, число тестов и CI не меняются. Повторный запуск должен подтвердить устранение гонки.

Источники: https://storybook.js.org/docs/writing-tests/accessibility-testing ; https://github.com/storybookjs/storybook/blob/v10.6.9/code/addons/a11y/src/preview.tsx ; https://github.com/storybookjs/storybook/blob/v10.6.9/code/core/src/preview-api/modules/preview-web/parseArgsParam.ts .

## RD-04 — экран завершения регистрации

После подтверждённого входа /account запрашивает серверный профиль. При null отображает обязательные имя/фамилию и одну из трёх публичных ролей; дата рождения обязательна для всех ролей, название компании — для владельца. POST через существующий auth bridge, роль берётся из ответа сервера. При 409 читаем существующий профиль, при 401 возвращаемся на вход; ошибки сохраняют введённые данные. После успешного создания показывается сохранённый профиль, повторное открытие читает БД. Бизнес-кабинеты ещё не открываются. Production gate сохранён.

Существующий реальный email E2E дополнен заполнением профиля водителя с датой рождения, проверкой DTO и reload. Контролируемые UI-тесты RU/dark и EN/light в обоих Chromium проектах проверяют локальную валидацию и сохранение ввода при 503, axe и overflow. Оставшиеся комбинации тем/локалей и ручная визуальная приёмка ещё открыты.
