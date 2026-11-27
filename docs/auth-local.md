# RD-04 — локальная проверка email-авторизации

Только dev/test. Production остаётся закрыт до приёмки RD-04. Не использовать реальные почтовые адреса, production БД, SMTP credentials или реальные персональные данные для проверки. Mailpit принимает тестовые письма локально и не доставляет их во внешние почтовые сервисы.

## Подготовка

В корне репозитория проверить рабочую ветку и версии Node/pnpm. Если .env уже существует, не перезаписывать его; дополнить локальный файл параметрами из .env.example. Заполнить локальные POSTGRES_PASSWORD, DATABASE_URL и S3 credentials согласно infra/README.md. Для AUTH_SECRET сгенерировать отдельное случайное значение командой openssl rand -hex 32, сохранить только в .env, не отправлять его в чат и не коммитить.

Параметры локального режима:

```dotenv
NODE_ENV=development
AUTH_ENABLED=true
MOVARO_AUTH_PREVIEW=true
AUTH_BASE_URL=http://127.0.0.1:4000
AUTH_WEB_ORIGIN=http://127.0.0.1:3000
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURITY=local
SMTP_FROM=auth@movaro.test
```

Не задавать SMTP_USER/SMTP_PASSWORD для local. AUTH_SECRET и DATABASE_URL остаются обязательными для API. Не добавлять NEXT_PUBLIC_ к секретам. Web и API должны использовать совпадающие значения origins; localhost и 127.0.0.1 не взаимозаменяемы при проверке Origin.

```bash
docker compose up -d --wait postgres seaweedfs
docker run -d --rm --name movaro-auth-mailpit \
  -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 \
  axllent/mailpit:v1.34.0
pnpm install --frozen-lockfile
```

Если Mailpit уже запущен, проверить его адрес и порты вместо запуска второго контейнера. Использовать только собственное локальное окружение. В каждом новом терминале из корня экспортировать переменные из собственного доверенного .env (shell-совместимый синтаксис), не печатать файл.

```bash
set -a
source .env
set +a
pnpm db:deploy
pnpm db:status
pnpm dev:api
```

Во втором терминале из корня:

```bash
set -a
source .env
set +a
pnpm --filter @freight/web exec next dev --hostname 127.0.0.1 --port 3000
```

Открыть http://127.0.0.1:3000/ru/login и http://127.0.0.1:8025 для тестовых писем. Не использовать localhost в браузере при приведённой конфигурации.

## Диагностика

```bash
curl -i http://127.0.0.1:4000/api/v1/health/ready
curl -i http://127.0.0.1:4000/api/v1/auth/get-session
curl -i http://127.0.0.1:3000/api/auth/get-session
```

Ожидается 200 для readiness и 200 с JSON null для обоих get-session без cookie. 404 на API auth означает, что route не зарегистрирован или адрес неверен; проверить AUTH_ENABLED и перезапуск API. 503 на Web может означать выключенный MOVARO_AUTH_PREVIEW, ошибку конфигурации или недоступный upstream; проверить предыдущие два запроса и вывод запуска процессов. 403 на POST требует проверки Origin и AUTH_WEB_ORIGIN; не отключать origin check. 429 требует соблюсти Retry-After. При AUTH_SMTP_DELIVERY_FAILED проверить локальный Mailpit и SMTP настройки. Не передавать полные письма, токены, cookie или заголовки авторизации.

## Ручная приёмка

- Зарегистрировать новый синтетический email и пароль по действующим правилам. Письмо появляется в Mailpit; вход без подтверждения отклоняется сервером и открывает экран подтверждения, без сессии.
- Перейти по ссылке из Mailpit; вернуться на login и войти с тем же email/паролем. Убедиться, что account отображает подтверждённую сессию. Выйти, открыть account повторно и проверить возврат на login.
- Проверить неверные данные, сетевой отказ, повторное письмо после допустимого интервала, восстановление пароля и недействительную ссылку. Не отключать rate limits для удобства.
- Проверить RU/EN, обе темы и мобильную ширину; отдельный E2E через Web/API/SMTP ещё требуется.

Остановка только собственного тестового почтового контейнера: docker stop movaro-auth-mailpit. Не удалять тома БД.

Источники: https://nextjs.org/docs/app/guides/environment-variables ; https://mailpit.axllent.org/docs/install/docker/ ; https://better-auth.com/docs/concepts/email .
