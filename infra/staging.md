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

Nginx с TLS и Basic Auth на всех application locations. Не проксировать API, S3, DB, SMTP и Mailpit напрямую. Перезаписывать Host, X-Forwarded-Host, X-Forwarded-Proto, X-Forwarded-For, x-movaro-proxy-ip и x-movaro-proxy-secret; последний из отдельного root-only snippet. Authorization, Forwarded и x-movaro-client-ip не передавать upstream. Не писать query strings, OAuth codes, cookies и secrets в логи. Проверить неизвестные Host, обход basic auth, прямые loopback запросы без assertion (auth endpoints 403/404), запросы через ingress с поддельными заголовками, Web/Admin sessions, Secure cookies, redirects, реальные OAuth и SMTP flows. Healthchecks внутри UI используют собственный доверенный loopback assertion, не раскрывают секрет в команде. Наличие staging flag не доказывает правильность Nginx — обязательна проверка реального ingress.

## Telegram OAuth

В BotFather → Login Widget зарегистрировать HTTPS Web origin и точный callback `/api/auth/telegram/callback`. Использовать Client ID и Client Secret, не Bot API token. На VPS создать игнорируемый Git и Docker build файлом `.env.telegram` с правами 600 и только двумя переменными: `AUTH_TELEGRAM_CLIENT_ID`, `AUTH_TELEGRAM_CLIENT_SECRET`. Compose передаёт этот необязательный файл в API, но не Web/Admin/Worker. При отсутствии файла Telegram остаётся выключенным. Не выводить resolved Compose config или содержимое файла в логи. После настройки выполнить `config --quiet` и `up -d --no-build --no-deps --wait api` с теми же тремя Compose files и профилем local-mail. Пересборка образа при изменении только credentials не нужна. Проверить readiness и Web `/api/auth/telegram/status`, затем реальный OAuth, включая отмену, callback и сессию. Для отключения переместить файл в защищённый каталог вне репозитория и пересоздать API; не удалять аккаунты/volumes.

Полный quality, browser smoke и реальные интеграции остаются открытыми. Host networking и dev dependencies сохраняются как ограничения временного staging, не production deployment.
