# MOVARO — Storybook (RD-03)

Каталог расположен в отдельном private workspace apps/storybook. Не подключается к runtime Web/Admin, не использует API и не публикуется как часть платформы. Примеры и тестовые данные только в stories. Storybook 10.6.9, React 19, Vite 7.3.8, Tailwind 4 через PostCSS; закреплённые версии. Локальный dev server слушает 127.0.0.1:6006.

## Запуск

- pnpm storybook — локальный каталог.
- pnpm storybook:build — статическая сборка для проверки.
- pnpm --filter @freight/storybook typecheck — проверка типов.
- pnpm check включает сборку каталога; Turbo учитывает storybook-static.

Общие Manrope, UI-примитивы и CSS-токены импортируются из workspace; стили не дублируются. Toolbar Theme/Language меняет data-theme и lang в iframe, тексты историй RU/EN. Истории демонстрируют реальные компоненты, а не бизнес-страницы. FormExample — исключительно изолированный тестовый сценарий, не реализация production формы. Интерактивные play-функции проверяют click и валидацию при открытии истории; автоматизированный браузерный runner и E2E остаются отдельным шагом. Addon a11y включён, ручная клавиатурная проверка также обязательна.

Официальные источники:
- https://storybook.js.org/docs/get-started/frameworks/react-vite
- https://storybook.js.org/docs/essentials/toolbars-and-globals
- https://storybook.js.org/docs/writing-tests/interaction-testing
- https://storybook.js.org/docs/writing-tests/accessibility-testing
- https://github.com/storybookjs/storybook/blob/v10.6.9/code/frameworks/react-vite/package.json

Требуется установка с реальным обновлением pnpm-lock.yaml, форматирование, сборка, проверка типов, лицензионный аудит и проверка историй в браузере. До этого срез не принят. Предыдущий локальный прогон UI (607 пакетов, 0 REVIEW, 138 файлов без предупреждений) ещё не зафиксирован в remote на момент подготовки.
