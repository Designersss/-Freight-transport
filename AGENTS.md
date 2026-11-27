# MOVARO — обязательные правила разработки

- До изменения кода прочитать документацию официального API закреплённой версии и проверить реальные типы/peer dependencies. В PR указать ссылки и решения, а не только результат компиляции.
- SOLID, KISS, DRY; инкапсулировать состояние и инфраструктуру в сервисах, использовать DI и композицию. React — функциональные компоненты и хуки согласно документации, чистые функции для преобразований; не вводить классы ради классов.
- Внутренние ссылки — Next.js Link через next-intl createNavigation. Обычный anchor допустим для внешних URL и внутристраничных якорей. Использовать Image при подходящих сценариях, документированные server/client boundaries.
- UI — единая библиотека shadcn/ui; использовать официальный registry, не изобретать доступные примитивы без основания. Семантика, клавиатура, обе темы и RU/EN.
- Сервер: NestJS modules/providers/DI, Fastify API, Prisma транзакции, параметризованные запросы; права и границы компаний проверять на сервере. Не открывать маршруты без авторизации.
- Не ослаблять strict TypeScript, тесты, frozen lockfile, security/license checks. Не коммитить секреты и чужие данные. Не заявлять, что непроверенный код работает.
- До merge: review всех изменённых файлов, реальные тесты, CI и ручная приёмка владельца. Отдельно фиксировать открытые вопросы и технический долг.

## Design Quality Gate (RD-03.1)

- Перед любой задачей UI/UX прочитать [DESIGN.md](DESIGN.md), [movaro-design](.agents/skills/movaro-design/SKILL.md), актуальные требования issue и существующие токены/компоненты. Утверждённые решения владельца важнее внешних рекомендаций; конфликт с доступностью или безопасностью явно эскалировать.
- Для внешних навыков использовать только изученные текстовые рекомендации и официальную документацию; не запускать сторонние установщики, бинарники или MCP и не передавать секреты. Новую зависимость или копирование стороннего кода согласовывать после проверки лицензии и закреплённой версии.
- Для UI PR приложить реальные результаты проверки по матрице dark/light, RU/EN, desktop/mobile, клавиатуре и состояниям; указать сравнение с референсом, отклонения и непроверенное. Скриншоты без персональных данных. Не заменять функциональные тесты визуальным ревью. Merge только после CI и ручной приёмки.

## Маршрутизация навыков MOVARO

Инструкции — собственные Markdown-файлы репозитория. При работе в ChatGPT их нужно прочитать из текущей ветки; автоматическая загрузка не предполагается. Не загружать все навыки без причины. Для UI всегда применять DESIGN.md, movaro-design и movaro-review; дополнительно выбирать навыки по таблице ниже. Для остальных PR применять movaro-review и релевантный инженерный навык.

| Задача | Навык |
| --- | --- |
| React, Next.js, shadcn, API-клиент | [movaro-frontend](.agents/skills/movaro-frontend/SKILL.md) |
| Сценарии, формы, таблицы, тексты | [movaro-ux](.agents/skills/movaro-ux/SKILL.md) |
| Клавиатура, контраст, ARIA, адаптация | [movaro-accessibility](.agents/skills/movaro-accessibility/SKILL.md) |
| Переходы и микроанимации | [movaro-motion](.agents/skills/movaro-motion/SKILL.md) |
| Тесты, дефекты, браузерные проверки | [movaro-testing](.agents/skills/movaro-testing/SKILL.md) |
| Скорость, большие списки и календарь | [movaro-performance](.agents/skills/movaro-performance/SKILL.md) |
| Любой PR, сохранение согласованных замечаний | [movaro-review](.agents/skills/movaro-review/SKILL.md) |

[Реестр внешних источников](docs/design-skill-sources.md) — справочный, не список установленных зависимостей. При противоречии приоритет: безопасность/права, утверждённый контракт и актуальный issue, затем локальные правила, затем внешние рекомендации. Не менять согласованный стек, требования или CI из-за внешнего навыка.

## Backend & Architecture Quality Gate

Для серверной задачи прочитать docs/architecture.md, актуальный issue и текущий код; выбрать навыки ниже. movaro-backend и movaro-review обязательны при изменении серверного runtime; movaro-architecture — при изменении границ/инвариантов. movaro-security — при любом изменении доступа, tenant-данных, нового endpoint или доверенной границы. movaro-testing применяется для всех изменений поведения, movaro-performance — для измеряемых проблем скорости. Не загружать все навыки без причины.

| Задача | Навык |
| --- | --- |
| Границы модулей, ADR, инварианты, новые домены | [movaro-architecture](.agents/skills/movaro-architecture/SKILL.md) |
| NestJS/Fastify, бизнес-логика, сервисы | [movaro-backend](.agents/skills/movaro-backend/SKILL.md) |
| REST, OpenAPI/Orval, SSE, контракты | [movaro-api](.agents/skills/movaro-api/SKILL.md) |
| Prisma, SQL, миграции, транзакции, бронирования | [movaro-database](.agents/skills/movaro-database/SKILL.md) |
| Авторизация, роли, tenant, файлы, безопасность | [movaro-security](.agents/skills/movaro-security/SKILL.md) |
| pg-boss, outbox, worker, события | [movaro-async](.agents/skills/movaro-async/SKILL.md) |
| Telegram, email, SeaweedFS/S3, webhook | [movaro-integrations](.agents/skills/movaro-integrations/SKILL.md) |
| Docker Compose, CI, Pino, релиз и инциденты | [movaro-devops](.agents/skills/movaro-devops/SKILL.md) |

В PR по backend указать бизнес-инварианты, права, транзакции/повторы, совместимость контрактов, миграции/восстановление и наблюдаемость по применимости. Приложить результаты реальных негативных, конкурентных, API и интеграционных тестов на актуальном commit; при недоступности стенда gate остаётся открытым. Не объявлять реализацию production-ready по одним инструкциям. Не ослаблять существующий quality CI; ручная приёмка и явное разрешение на merge обязательны. [Источники backend-навыков](docs/backend-skill-sources.md) — справочный реестр, не установленные пакеты.
