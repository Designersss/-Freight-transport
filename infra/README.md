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

Интеграционный тест: задайте TEST_DATABASE_URL для отдельной одноразовой тестовой БД с применённой миграцией и запустите pnpm test:integration. CI использует одноразовый контейнер. Не используйте production URL. Миграция outbox создаёт инфраструктурную таблицу; доставка событий будет добавлена отдельно.
