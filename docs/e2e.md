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
