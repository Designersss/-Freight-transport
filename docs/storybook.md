# MOVARO — Storybook (RD-03)

Каталог расположен в отдельном private workspace apps/storybook. Не подключается к runtime Web/Admin, не использует API и не публикуется как часть платформы. Примеры и тестовые данные только в stories. Storybook 10.6.9, React 19, Vite 7.3.8, Tailwind 4 через PostCSS; закреплённые версии. Локальный dev server слушает 127.0.0.1:6006.

## Запуск

- pnpm storybook — локальный каталог.
- pnpm storybook:build — статическая сборка для проверки.
- pnpm --filter @freight/storybook typecheck — проверка типов.
- pnpm check включает сборку каталога; Turbo учитывает storybook-static.

Общие Manrope, UI-примитивы и CSS-токены импортируются из workspace; стили не дублируются. Toolbar Theme/Language меняет data-theme и lang в iframe, тексты историй RU/EN. Истории демонстрируют реальные компоненты, а не бизнес-страницы. FormExample — исключительно изолированный тестовый сценарий, не реализация production формы. Интерактивные play-функции проверяют click и валидацию при открытии истории; Playwright отдельно проверяет интерактивную историю формы и семантику таблицы в статической сборке; не все play-функции покрыты отдельным автоматизированным запуском. Addon a11y включён, ручная клавиатурная проверка также обязательна.

Официальные источники:

- https://storybook.js.org/docs/get-started/frameworks/react-vite
- https://storybook.js.org/docs/essentials/toolbars-and-globals
- https://storybook.js.org/docs/writing-tests/interaction-testing
- https://storybook.js.org/docs/writing-tests/accessibility-testing
- https://github.com/storybookjs/storybook/blob/v10.6.9/code/frameworks/react-vite/package.json

26.11.2026 локальный запуск, сборка, typecheck, frozen install, lint и license check подтверждены владельцем; lockfile в 918b221, последующий E2E в 957f65c (16/16 всего). Предупреждения Vite о client directives, sourcemap и размере chunk не подавлялись. Ручная приёмка каркаса и финальный CI остаются открытыми.
