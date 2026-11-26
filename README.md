# Платформа управления спецтехникой

Многопользовательская биржа заявок, CRM компаний, кабинеты водителей и диспетчеров, административная панель и Telegram-бот. Название продукта пока не утверждено.

## Состояние

Этап RD-02: фундамент Backend и PostgreSQL. Бизнес-функциональность ещё не реализована.
[Основная задача #1](https://github.com/Designersss/-Freight-transport/issues/1) · [RD-01 #2](https://github.com/Designersss/-Freight-transport/issues/2) · [Roadmap](docs/roadmap.md) · [Архитектура](docs/architecture.md) · [Правила разработки](CONTRIBUTING.md)

## Локальная настройка

Установите Node.js версии из .nvmrc и pnpm версии из package.json.

```bash
npm install --global pnpm@10.34.8
pnpm install --frozen-lockfile
pnpm check
```

Первичная генерация lock-файла, если его ещё нет в ветке: `pnpm install --lockfile-only`. Затем выполните frozen install, проверки и добавьте pnpm-lock.yaml в Git. В CI разрешена только воспроизводимая установка.

Команды: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check`. Они проверяют фундамент и API, не бизнес-сценарии. Для локального запуска PostgreSQL, миграций и API см. [инструкцию](infra/README.md).

## Безопасность

Репозиторий публичный. Не коммитить секреты, реальные персональные данные, внутренние изображения, production-выгрузки. Локальный .env игнорируется. Публичный доступ к исходному коду не означает предоставление лицензии третьим лицам; решение о лицензировании продукта принимается отдельно.
