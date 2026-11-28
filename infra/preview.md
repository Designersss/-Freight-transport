# Закрытый контейнерный preview RD-04

Не production и не публичный staging. На выделенном Linux VPS используется существующий Compose project и его volumes. Все HTTP endpoints, PostgreSQL, S3 и Mailpit остаются на loopback. Нельзя проксировать этот режим наружу через Nginx. Для браузера допустим только SSH-туннель. Реальный внешний Telegram OAuth, HTTPS ingress и production runtime требуют отдельной реализации и проверки.

Один общий образ собирает четыре приложения с закреплёнными Node/pnpm и frozen lockfile. Контейнеры запускаются от пользователя node с отдельными командами; секреты передаются только API и worker согласно их потребностям, не в build context и не в UI. Образ пока содержит dev dependencies. Host networking выбран только для закрытого preview: существующие PostgreSQL/S3/SMTP адреса loopback сохраняются, но отсутствует изоляция сетевого пространства от хоста. Не использовать на общем или production сервере. Next dev необходим для существующего запрета Admin auth в production. Никакие auth gates не меняются.

## Подготовка

В корне своего checkout проверить Git SHA, отдельную staging БД и bucket, актуальность миграций, наличие резервной копии и отсутствие ручных процессов на портах 3000, 3001, 4000. Убедиться, что DATABASE_URL указывает на локальную staging БД, POSTGRES_* согласованы с ней, .env имеет права 600 и содержит независимые AUTH_SECRET и AUTH_ADMIN_SECRET. Не выводить .env или полный compose config в логи. Не применять миграции к неизвестной БД. Проверить образ до запуска.

```bash
docker compose -f docker-compose.yml -f compose.preview.yml --profile local-mail config --quiet
docker compose -f docker-compose.yml -f compose.preview.yml --profile local-mail build api
docker compose -f docker-compose.yml -f compose.preview.yml --profile local-mail up -d --no-build --wait --wait-timeout 240
docker compose -f docker-compose.yml -f compose.preview.yml --profile local-mail ps
```

Сборка не использует env secrets. При повторном обновлении сначала проверить резервирование, migrations и совместимость, затем пересобрать образ. Базовый Compose без overlay остаётся локальной инфраструктурой. Не менять project name, чтобы сохранить volumes.

## Проверки

```bash
curl -fsS http://127.0.0.1:4000/api/v1/health/ready
curl -fsS http://127.0.0.1:3000/api/auth/get-session
curl -fsS http://127.0.0.1:3001/api/auth/get-session
ss -ltnp
docker compose -f docker-compose.yml -f compose.preview.yml --profile local-mail logs --tail=30 worker
```

Ожидается ready, два null, только loopback для application ports и Worker started. У worker нет отдельного readiness endpoint; статус running сам по себе не подтверждает обработку очередей. Проверить работу после закрытия SSH, а затем после согласованной перезагрузки VPS. Docker restart policy восстанавливает процессы после завершения или перезапуска Docker, но не перезапускает контейнер только из-за unhealthy. Проверять health и логи отдельно.

Для остановки использовать stop нужного сервиса. Не удалять volumes. Полный quality, сборка образа, реальный runtime и повторный запуск после reboot проверяются отдельно до утверждения стенда. Этот режим не разрешает production activation.
