# MOVARO Telegram bot (RD-04)

Статус: незавершённый срез Draft PR #24. Не запускать на рабочем стенде до подключения Web-return, проверки прав, лимитов, синхронизации, лицензий и прохождения контрольных проверок.

## Архитектура

- Отдельный процесс `@freight/bot`, grammY 1.45.1, Long Polling, один экземпляр на токен, без webhook и прямого доступа к PostgreSQL.
- `telegram.ts` изолирует внешний API и валидирует update; `polling.ts` последовательно обрабатывает update ID, учитывает retry_after и завершает процесс при неверном токене или конфликте polling.
- `internal-api.ts` использует общий тип команд `@freight/auth/telegram-bot-internal`, проверяет ответы и обращается только к локальному приватному API.
- `handler.ts` хранит только краткоживущие prompts. Данные и revision черновика принадлежат серверу. После рестарта старые кнопки не работают; /start повторно читает черновик. Exactly-once доставки Telegram не гарантируется.
- `messages.ts` — RU/EN, сообщения с персональными данными защищены protect_content. Логи содержат только названия безопасных событий.
- При выборе регистрации в чате непроверенный исходный браузер не получает browser_hash. Для последующего подключения браузера требуется отдельное подтверждение.

## Конфигурация и проверки

В закрытом dev/test окружении после согласованной активации используются отдельные TELEGRAM_BOT_TOKEN, AUTH_TELEGRAM_BOT_INTERNAL_SECRET, TELEGRAM_BOT_API_ORIGIN (loopback HTTP) и AUTH_WEB_ORIGIN (HTTPS). Не передавать Bot API token в Web/Admin или публичную сборку. Приватный маршрут /internal/telegram-bot запрещён на внешнем ingress.

Команды целевой проверки после обновления lockfile и установки:

```bash
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@freight/bot --filter=@freight/api
pnpm --filter @freight/bot typecheck
pnpm --filter @freight/bot test
pnpm --filter @freight/api test
pnpm lint
pnpm licenses:report
pnpm licenses:check
```

Отдельно выполнить совместимые тесты scripts/auth-compat на изолированной PostgreSQL 17, включая telegram-bot-internal.test.mjs. Не использовать рабочую базу.

## Открытые пункты

- Реальный frozen install, форматирование Biome, strict typecheck, unit/HTTP/DB проверки, обновление лицензионного отчёта, проверка advisories. Lockfile подготовлен по точному upstream package-lock, но не регенерирован pnpm в доступном окружении.
- Неизвестный Telegram при login должен получить явный выбор регистрации, а существующий при register — вход; полноценная проверка состояния аккаунта в боте ещё не подключена.
- Web-return, исходная вкладка, безопасное переключение чата и браузера, завершение с нативной сессией Better Auth; кнопка URL не гарантирует принудительный переход или выбор исходного браузера.
- Rate limits, устойчивое восстановление polling, очистка временных записей, постоянный контейнер, конфигурация ingress и закрытого staging, отказоустойчивость после сбоя.
- Старый Telegram OIDC ещё не удалён. До окончательного review и ручной приёмки production activation запрещена.

## Источники

- [grammY 1.45.1 package.json](https://github.com/grammyjs/grammY/blob/v1.45.1/package.json)
- [grammY 1.45.1 API](https://github.com/grammyjs/grammY/blob/v1.45.1/src/core/api.ts)
- [grammY 1.45.1 client options](https://github.com/grammyjs/grammY/blob/v1.45.1/src/core/client.ts)
- [grammY upstream package-lock](https://github.com/grammyjs/commands/blob/main/package-lock.json)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [ADR](../../docs/adr-telegram-bot-auth.md)
