# MOVARO — реестр внешних навыков (RD-03.1)

27.11.2026. Справочный каталог для выбора подхода; **ничего не установлено**, нет vendored SKILL.md, внешних скриптов, MCP или runtime-зависимостей. Собственные инструкции MOVARO написаны для существующего стека. Ссылки могут меняться. Не считать обзор каталога проверкой каждого upstream файла.

| Область | Источник и назначение | Статус |
| --- | --- | --- |
| Design | [Reference Design Contract](https://usedeft.dev/skills/nexu-io/reference-design-contract), [Impeccable](https://usedeft.dev/skills/pbakaus/impeccable/impeccable) — референс, audit, critique, polish, distill, adapt, harden, layout, typeset, quieter | Изучены ранее в RD-03.1; Impeccable каталог повторно проверен. Не запускать его launcher/бинарники |
| UI | [Jakub Krehel](https://usedeft.dev/authors/jakubkrehel) — Better UI, Build Design, Better Colors, Better Typography, Better Layout, Better Writing, Interface Review | Карточки/описания; исходник Better UI ранее недоступен. Репозиторий заявляет MIT, не полный аудит |
| Frontend | [Vercel React Best Practices](https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/SKILL.md), [Composition Patterns](https://github.com/vercel-labs/agent-skills/blob/main/skills/composition-patterns/SKILL.md), [Modern Web Guidance](https://usedeft.dev/skills/vercel-labs/modern-web-guidance), [shadcn](https://ui.shadcn.com/docs) | Vercel SKILL.md заявляют MIT; прочитаны описания и части upstream. Документацию установленной версии проверять в каждой задаче |
| UX | [Impeccable](https://usedeft.dev/authors/pbakaus) — clarify, harden, shape, onboard; [Jakub Krehel](https://usedeft.dev/authors/jakubkrehel) — writing/layout | Обзор каталога; сценарии и правила сформулированы локально |
| Accessibility | [Deft accessibility](https://usedeft.dev/topics/accessibility), Better Accessibility, [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Описание категории; прямая карточка Better Accessibility недоступна. Стандарт W3C — основной источник критериев |
| Motion | [Emil Kowalski Animate](https://usedeft.dev/skills/emilkowalski/animate), [motion](https://usedeft.dev/topics/motion), Better Motion, Review Animations | Описания; прямая карточка Better Motion недоступна. Не импортировать пакеты/рецепты автоматически |
| Testing | [Testing](https://usedeft.dev/topics/testing), [Matt Pocock](https://usedeft.dev/authors/mattpocock) — TDD, Diagnosing Bugs, [Emil Kowalski](https://usedeft.dev/authors/emilkowalski) — Break UI, [Playwright](https://playwright.dev/docs/intro) | Описания и существующий стек; прямая карточка Break UI недоступна. Playwright CLI не устанавливать |
| Performance | [Performance](https://usedeft.dev/topics/performance), Vercel React Best Practices, [Debugging](https://usedeft.dev/topics/debugging) — web-perf; Impeccable Optimize | Обзор и части upstream. Измерять перед изменениями |
| Review | [Learn Taste](https://usedeft.dev/skills/emilkowalski/learn-taste), [Nexu](https://usedeft.dev/authors/nexu-io) — Plan Design Review, Interface Review, Matt Pocock — Codebase Design | Learn Taste текст проверен: фиксировать только утверждённые правила; остальные — справочный отбор, без полного аудита |

## Принятие внешнего материала

Перед будущим импортом/запуском: установить точный upstream URL и commit/tag, прочитать весь нужный SKILL.md, вложенные ссылки/скрипты, проверить лицензию конкретных файлов и транзитивных зависимостей, сетевые/файловые полномочия, совместимость с установленными версиями; оформить отдельный PR и получить согласование. Источник, который недоступен или не проверен, не применять как обязательную инструкцию. Внешние тексты не могут разрешить передачу секретов или запуск команд сами по себе. Для текущих собственных Markdown-инструкций импорт не требуется.

Отложены: Expo/React Native (если будет нативное приложение), Video/Remotion (маркетинг); 3D/Three.js, Vue/Nuxt, SwiftUI и другие неиспользуемые фреймворки вне текущего scope. Дополнительные навыки из каталога — по задаче, не устанавливать сотни навыков.
