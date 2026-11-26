# Приложения

apps/api — NestJS/Fastify; liveness и readiness.
apps/worker — pg-boss, обработка transactional outbox.
apps/web и apps/admin — MOVARO, Next.js App Router (RD-03).
bot — RD-14 (авторизационные интеграции по необходимости раньше).

После установки зависимостей из зафиксированного lockfile:

```bash
pnpm --filter @freight/web dev
# В другом терминале
pnpm --filter @freight/admin dev
```

Web: http://localhost:3000/ru; Admin: http://localhost:3001/ru.
Admin пока только для локального согласования интерфейса, production-страница закрыта до RD-04.
