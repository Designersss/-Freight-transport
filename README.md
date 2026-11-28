# MOVARO — платформа управления спецтехникой

Многопользовательская биржа заявок, CRM компаний, кабинеты водителей и диспетчеров, административная панель и Telegram-бот. Название MOVARO утверждено; технический namespace @freight сохраняется.

## Состояние

Текущий этап — RD-04 (регистрация, авторизация и роли), итоговое ревью в Draft PR #24. Фундамент RD-02 и UI RD-03 используются в текущей реализации. NestJS/Fastify, PostgreSQL/Prisma, pg-boss, SeaweedFS, OpenAPI/Orval, Better Auth и внутренняя основа SSE. Auth доступен только в preview dev/test; production activation, полный quality CI и ручная приёмка текущего этапа не подтверждены. Бизнес-модули аренды и компаний — последующие этапы.
[Основная задача #1](https://github.com/Designersss/-Freight-transport/issues/1) · [RD-01 #2](https://github.com/Designersss/-Freight-transport/issues/2) · [RD-02 #3](https://github.com/Designersss/-Freight-transport/issues/3) · [RD-03 #4](https://github.com/Designersss/-Freight-transport/issues/4) · [RD-04 #5](https://github.com/Designersss/-Freight-transport/issues/5) · [Roadmap](docs/roadmap.md) · [Архитектура](docs/architecture.md) · [Правила разработки](CONTRIBUTING.md)

## Локальная настройка

Установите Node.js версии из .nvmrc и pnpm версии из package.json.

```bash
npm install --global pnpm@10.34.8
pnpm install --frozen-lockfile
pnpm check
```

Lockfile хранится в Git. При изменении зависимостей обновите его отдельно и проверьте frozen install. В CI разрешена только воспроизводимая установка.

Команды: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check`. Они включают статические проверки, unit-тесты и сборку; для проверки реальных сценариев дополнительно нужны браузерные, HTTP, PostgreSQL, SMTP и S3 тесты. Для запуска PostgreSQL, SeaweedFS, API, worker, интеграционных проверок и ручной приёмки см. [инструкцию](infra/README.md). Политика зависимостей: [лицензии](docs/third-party-licenses.md). В полном CI также выполняется pnpm audit --audit-level=moderate. Quick Checks на Draft PR проверяет frozen install, OpenAPI, lint и typecheck; полный quality запускается на контрольной точке Ready for review. См. [AGENTS.md](AGENTS.md).

Для локальной проверки авторизации RD-04 см. [инструкцию запуска и диагностики](docs/auth-local.md).

## Безопасность

Репозиторий публичный. Не коммитить секреты, реальные персональные данные, внутренние изображения, production-выгрузки. Локальный .env игнорируется. Публичный доступ к исходному коду не означает предоставление лицензии третьим лицам; решение о лицензировании продукта принимается отдельно.
