---

name: movaro-devops
description: Docker Compose, CI/CD, Pino, health/readiness, наблюдаемость, развёртывание и восстановление.
---

# DevOps & observability

Читать docker-compose.yml, infra, .github/workflows, scripts и README. Согласованное развёртывание — Docker Compose на собственном сервере. Не добавлять Kubernetes, внешний monitoring SaaS или иной стек по умолчанию.

- Воспроизводимость: закреплённые версии Node/pnpm/образов по принятой политике, frozen lockfile, реальные healthcheck, постоянные volumes, ограничение портов, минимум привилегий, конфигурация через env. Не раскрывать PostgreSQL/служебные порты публично. Секреты вне образа, Git и CI-логов.
- Различать liveness/readiness и startup, проверять зависимость БД/схемы без раскрытия деталей наружу; порядок запуска не заменяет readiness. Graceful shutdown api/worker, ограниченные ресурсы и таймауты по измерениям.
- Pino structured logs: request/event/job correlation, действие, длительность, результат и безопасная причина сбоя. Redact auth headers, cookies, passwords, secrets, signed URLs; не писать лишние персональные данные. Аудит бизнес-действий отличать от operational logs.
- Измерять latency/error rate, DB pool/slow queries, queue lag, storage errors, health, диск/память. Порог алерта и срок хранения не выдумывать; предлагать по baseline и эксплуатационному риску. Не объявлять metrics/tracing реализованными, если есть только инструкции.
- CI: действующий quality job, pnpm check, api:check, licenses:check, test:integration, test:stack, браузерные проверки согласно workflow. Проверить текущий head SHA, не ослаблять проверку или branch protection. Изменения pipeline минимальны, permissions scoped, без незакреплённых сторонних скриптов.
- Перед deployment: окружение, образ/commit, резервная копия, проверенный restore/миграция, совместимость, rollback либо forward-fix, smoke после развёртывания. Не выполнять разрушительные команды, production миграции, rollback или deploy без отдельного разрешения. Не путать backup с проверенным восстановлением.
- При инциденте: собрать безопасные логи, состояние процессов и ресурсов, локализовать причину, фиксировать действия и последствия. Не перезапускать всё или удалять volumes как первый шаг.

Результат: воспроизводимые команды, отчёт CI/health, план релиза/rollback, ограничения и остаточные риски. Источники: https://docs.docker.com/compose/ ; https://docs.github.com/actions ; https://github.com/pinojs/pino ; https://github.com/wshobson/agents/tree/main/plugins/cicd-automation/skills/deployment-pipeline-design .
