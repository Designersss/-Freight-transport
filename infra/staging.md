# Защищённый staging RD-04

Статус: подготовка к проверке. Не production. Синтетические данные, один выделенный Linux VPS, отдельные HTTPS origins Web и Admin, приватный API и Mailpit. Production API auth gate остаётся закрытым. API работает в development runtime с явным staging-флагом, только loopback и обязательным proxy secret. Web/Admin запускаются через next start. Admin production build доступен исключительно при валидном staging-конфиге и доверенном ingress assertion; обычный production без флага возвращает 404.

## Запуск

В .env добавить STAGING_WEB_ORIGIN, STAGING_ADMIN_ORIGIN (разные HTTPS origins без path), AUTH_PROXY_SECRET (отдельный случайный 64-символьный hex). Не передавать AUTH_SECRET/ADMIN_SECRET в UI. Не выводить секреты в терминал, CI, Git и access logs.

```bash
docker compose -f docker-compose.yml -f compose.preview.yml -f compose.staging.yml --profile local-mail config --quiet
docker compose -f docker-compose.yml -f compose.preview.yml -f compose.staging.yml --profile local-mail build api
docker compose -f docker-compose.yml -f compose.preview.yml -f compose.staging.yml --profile local-mail up -d --no-build --wait --wait-timeout 240
```

Staging image отдельно от preview image. Тот же project name, неизменные volumes и миграции. Перед переключением проверить backup/restore и миграции; Nginx до успешного smoke отдаёт только защищённую проверочную страницу. При rollback закрыть ingress и запустить предыдущий preview image через прежние два compose files, без удаления volumes.

## Ingress

Nginx с TLS и Basic Auth на всех application locations. Не проксировать API, S3, DB, SMTP и Mailpit напрямую. Перезаписывать Host, X-Forwarded-Host, X-Forwarded-Proto, X-Forwarded-For, x-movaro-proxy-ip и x-movaro-proxy-secret; последний из отдельного root-only snippet. Authorization, Forwarded и x-movaro-client-ip не передавать upstream. Не писать query strings, OAuth codes, cookies и secrets в логи. Проверить неизвестные Host, обход basic auth, прямые loopback запросы без assertion (auth endpoints 403/404), запросы через ingress с поддельными заголовками, Web/Admin sessions, Secure cookies, redirects, реальные Telegram bot и SMTP flows. Healthchecks внутри UI используют собственный доверенный loopback assertion, не раскрывают секрет в команде. Наличие staging flag не доказывает правильность Nginx — обязательна проверка реального ingress.

## Telegram через MOVARO Bot

Telegram выключен по умолчанию. Дополнительный Compose overlay `compose.staging.telegram.yml` активирует API и отдельный процесс бота одновременно; его не подключать до разрешённой проверки закрытого staging. Используется long polling, не OAuth и не webhook. Один процесс polling на токен, без публикации порта, без доступа к секретам БД/S3/SMTP. Оба процесса работают в существующем host networking на выделенном Linux VPS; это не сетевая изоляция от хоста. Production gate не меняется.

### Подготовка конфигурации

Вне Git и build context создать три файла с правами 600 (в корне checkout, `umask 077`, не выводить их содержимое):

- `.env.telegram-api` — только `AUTH_TELEGRAM_BOT_USERNAME` (без @, имя реального тестового бота).
- `.env.telegram-shared` — только `AUTH_TELEGRAM_BOT_INTERNAL_SECRET` (новый независимый секрет, `openssl rand -hex 32`; не использовать AUTH_SECRET, AUTH_ADMIN_SECRET или AUTH_PROXY_SECRET).
- `.env.telegram-bot` — только `TELEGRAM_BOT_TOKEN` (из BotFather).

Все три файла обязательны при подключении overlay. Bot token не передаётся API, Web, Admin или Worker; общий секрет получают только API и bot. Не помещать Telegram credentials в общий .env. Старый .env.telegram с OAuth credentials больше не читается; переместить его в защищённый каталог вне checkout и отозвать ненужные OAuth credentials. Не удалять аккаунты/volumes. Убедиться, что для тестового токена нет других poller или активного webhook; отключить старую интеграцию отдельно, без удаления pending updates. Не выполнять команды с токеном в URL или в истории shell.

В оба HTTPS server blocks Nginx установить содержимое [nginx/staging-deny-internal.conf](nginx/staging-deny-internal.conf) через include в контексте server. Не проксировать /internal или /internal/ и не добавлять публичный upstream API. Проверить `sudo nginx -t`, затем применить конфигурацию только после резервной копии и согласования. Проверить реальные правила на обоих hosts, включая нормализованные пути и Basic Auth; не выводить `nginx -T` с proxy secret.

### Запуск после контрольных проверок

Сохранить тот же Compose project name. До запуска подтвердить SHA, резервную копию и restore, отдельную staging БД, состояние миграций, закрытый ingress и отсутствие второго poller. Следующие команды предназначены для согласованного staging, не production:

```bash
dc() {
  docker compose -f docker-compose.yml -f compose.preview.yml \
    -f compose.staging.yml -f compose.staging.telegram.yml --profile local-mail "$@"
}
dc config --quiet
dc build api
dc run --rm --no-deps api pnpm db:status
# Только после проверки целевой БД и согласования миграции:
# dc run --rm --no-deps api pnpm db:deploy
dc up -d --no-build --wait --wait-timeout 240
dc ps
dc logs --tail=30 bot
```

Не выполнять up до успешного db:status или согласованного db:deploy. У bot нет HTTP listener и отдельного readiness endpoint; running не доказывает работоспособность. Проверить лог начала polling без ошибок, реальную команду /start и весь вход/регистрацию в закрытом staging. Restart policy восстанавливает завершившийся процесс, но не гарантирует доставку Telegram updates. При повторных 401/409 остановить bot, проверить токен или второй poller, не запускать дополнительные экземпляры.

### Smoke, изоляция и отключение

```bash
curl -fsS http://127.0.0.1:4000/api/v1/health/ready
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST http://127.0.0.1:4000/internal/telegram-bot \
  -H 'Content-Type: application/json' --data '{}'
ss -ltn
```

Прямой локальный запрос без Bearer должен быть отклонён (403); порты 3000/3001/4000, БД/S3/Mailpit не слушают внешние интерфейсы. На Web и Admin через Basic Auth повторить POST к /internal/telegram-bot и проверить 404 Nginx (включая /internal/ и нормализованный вариант); без Basic Auth также не должно быть доступа. Проверить публичный Web /api/auth/telegram/status через доверенный ingress, затем реальные /start, contact, approve/reject, возврат, новый login и синхронизацию в обоих направлениях. Проверить остановку/рестарт bot и восстановление черновика, отсутствие повторной выдачи сессии, отсутствие секретов в логах. Не передавать bearer через внешний ingress даже для smoke.

Для отключения Telegram сначала `dc stop bot`, затем `dc rm -f bot`, пересоздать API без Telegram overlay с прежним project name и тремя базовыми Compose files (`up -d --no-build --no-deps --force-recreate --wait api`), проверить disabled status и отказ внутреннего маршрута. Файлы секретов хранить вне checkout в защищённом месте; не удалять volumes и не откатывать БД автоматически. Остальные сервисы продолжают работать. При rollback образа проверить совместимость схемы и восстановление, не применять destructive reset.

Полный quality, browser smoke и реальные интеграции остаются открытыми. Host networking и dev dependencies сохраняются как ограничения временного staging, не production deployment.
