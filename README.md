# Платформа управления спецтехникой

Многопользовательская биржа заявок, CRM компаний, кабинеты водителей и диспетчеров, административная панель и Telegram-бот. Название продукта пока не утверждено.

## Состояние

Этап RD-02: инфраструктура и фундамент Backend, в процессе приёмки. NestJS/Fastify, PostgreSQL/Prisma, pg-boss, SeaweedFS, OpenAPI/Orval, внутренняя основа SSE. Бизнес-функциональность и production-авторизация ещё не реализованы.
[Основная задача #1](https://github.com/Designersss/-Freight-transport/issues/1) · [RD-01 #2](https://github.com/Designersss/-Freight-transport/issues/2) · [RD-02 #3](https://github.com/Designersss/-Freight-transport/issues/3) · [Roadmap](docs/roadmap.md) · [Архитектура](docs/architecture.md) · [Правила разработки](CONTRIBUTING.md)

## Локальная настройка

Установите Node.js версии из .nvmrc и pnpm версии из package.json.

```bash
npm install --global pnpm@10.34.8
pnpm install --frozen-lockfile
pnpm check
```

Lockfile хранится в Git. При изменении зависимостей обновите его отдельно и проверьте frozen install. В CI разрешена только воспроизводимая установка.

Команды: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check`. Они проверяют фундамент и API, не бизнес-сценарии. Для запуска PostgreSQL, SeaweedFS, API, worker, интеграционных проверок и ручной приёмки см. [инструкцию](infra/README.md). Политика зависимостей: [лицензии](docs/third-party-licenses.md).

Для локальной проверки авторизации RD-04 см. [инструкцию запуска и диагностики](docs/auth-local.md).

## Безопасность

Репозиторий публичный. Не коммитить секреты, реальные персональные данные, внутренние изображения, production-выгрузки. Локальный .env игнорируется. Публичный доступ к исходному коду не означает предоставление лицензии третьим лицам; решение о лицензировании продукта принимается отдельно.
