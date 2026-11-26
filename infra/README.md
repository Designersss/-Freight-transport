# Инфраструктура

RD-02: локальный PostgreSQL 17 и API. Скопируйте .env.example в .env и задайте непустой уникальный POSTGRES_PASSWORD; заполните DATABASE_URL (пароль в URL должен быть percent-encoded).

Пример структуры URL: postgresql://freight:YOUR_ENCODED_PASSWORD@127.0.0.1:5432/freight?connect_timeout=2&pool_timeout=2

```bash
docker compose up -d --wait postgres
pnpm install --frozen-lockfile
pnpm db:deploy
pnpm db:status
pnpm dev:api
```

Liveness: GET http://127.0.0.1:4000/api/v1/health.
Readiness: GET http://127.0.0.1:4000/api/v1/health/ready — 200 только при доступности мигрированной БД, иначе 503.

PostgreSQL доступен только через loopback. Том сохраняет данные. Не используйте docker compose down -v без осознанного удаления данных. Образ dev закреплён по major; production digest и резервирование — RD-18.

Интеграционный тест: задайте TEST_DATABASE_URL для отдельной одноразовой тестовой БД с применённой миграцией и запустите pnpm test:integration. CI использует одноразовый контейнер. Не используйте production URL. Миграции создают outbox_events и event_publications.

## Worker и очередь

В другом терминале после миграций: `pnpm dev:worker`. Worker создаёт служебную схему pg-boss в той же PostgreSQL, регистрирует очередь outbox-relay и запускает её при старте и каждую минуту. Лимит обработки — до 10 пакетов за задачу, размер пакета OUTBOX_BATCH_SIZE (100 по умолчанию). Повторные попытки выполняются pg-boss; будущие циклы подбирают оставшиеся события.

Бизнес-модули вызывают appendOutboxEvent внутри своей транзакции. Relay блокирует только выбранные строки через FOR UPDATE SKIP LOCKED и в той же транзакции создаёт запись event_publications с уникальным event_id и отмечает исходное событие processed_at. Повторы и конкурентные запуски не дублируют публикации. processed_at означает публикацию в БД, а не отправку Telegram или SSE; attempts отражает число успешных транзакционных обработок, не все неудачные попытки. Порядок доставки внешним потребителям, права доступа, retention и отдельные идемпотентные обработчики будут проектироваться при подключении SSE/уведомлений. Не обещаем exactly-once внешних эффектов.

pg-boss и его схема управляются worker при запуске; production-миграции служебной схемы и разделение прав требуют проверки перед развёртыванием.

Документация pg-boss: https://pgboss.io/introduction и https://pgboss.io/api/scheduling.
