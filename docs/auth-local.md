# RD-04 — локальная проверка авторизации

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
docker compose --profile local-mail up -d --wait postgres seaweedfs mailpit
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

Начинать ручную приёмку после успешного quality на актуальном PR. Использовать только синтетические данные и отдельную БД/bucket.

- Ввести новый email в signup. Получить письмо в Mailpit; до завершения регистрации вход отклоняется, нет аккаунта и сессии. Открыть ссылку, явно подтвердить почту, затем задать пароль (6–128 символов), роль, имя, фамилию, дату рождения и username. Для владельца указать название компании. Фото отсутствует на всех шагах. Ссылка действует 60 минут, повторное открытие требуется после перезагрузки до завершения. См. [registration-wizard.md](registration-wizard.md).
- Завершить регистрацию, убедиться в переходе на login без автоматической сессии, войти с новым паролем. Проверить кабинет своей роли, отказ доступа к чужим ролям, настройки, logout и возврат на login при прямом открытии account. Повторить для трёх публичных ролей.
- Проверить восстановление: запрос письма, одноразовая ссылка на 15 минут, новый пароль, статус об успешном изменении на login, отказ старого пароля и повторного использования ссылки. Проверить ошибки, повтор после сетевого сбоя и rate limits без обхода ограничений.
- В настройках проверить имя, фамилию, дату рождения (ручной ввод и календарь), username не чаще раза в неделю, фото после подтверждения email, смену пароля, отзыв сессий, подтверждаемую смену email (старый и новый адрес), постоянную привязку Telegram и деактивацию. Для деактивации использовать отдельный тестовый аккаунт.
- Проверить RU/EN, dark/light, desktop/mobile, клавиатуру и видимый фокус. Автоматические тесты описаны в [e2e.md](e2e.md); результаты полного quality и ручной приёмки текущего head ещё не подтверждены.

Остановка своих dev-процессов — Ctrl+C. Для Compose Mailpit: `docker compose --profile local-mail stop mailpit`. Для своего проекта Compose: `docker compose down` без -v. Не удалять тома БД.

Источники: https://nextjs.org/docs/app/guides/environment-variables ; https://mailpit.axllent.org/docs/install/docker/ ; https://better-auth.com/docs/concepts/email .

## Чистая БД до первого релиза

С 27.11.2026 действует greenfield-правило AGENTS.md. В ветке RD-04 переработана ещё не слитая auth migration и удалены промежуточные миграции возраста. Локальная одноразовая БД, на которой применялись предыдущие версии этой ветки, не подходит для нового checksum. Для проверки использовать новую изолированную пустую dev/test БД, выполнить pnpm db:deploy и pnpm db:status. Не запускать reset, удаление volume или очистку данных на неизвестном/общем/production окружении. Основная ветка и реальные данные не изменялись.

Для dev/test фотографий при AUTH_ENABLED=true API требует S3_* из .env и запущенный SeaweedFS. При ручных auth-compat проверках нужен изолированный локальный bucket; CI уже поднимает его перед auth-compat. Маршрут /api/v1/auth/profile/photo и Web bridge /api/auth/profile/photo принимают JPEG/PNG бинарным POST до 2 MiB, GET собственного фото, DELETE без тела. Клиенту не выдаётся ключ S3. UI настроек подключён; активная сессия и подтверждённый реальный email обязательны также на API/SQL. Telegram-only не получает доступ к фото. Production auth gate сохранён.

Telegram dev/test: AUTH_TELEGRAM_CLIENT_ID и AUTH_TELEGRAM_CLIENT_SECRET из BotFather OAuth settings задаются только API в некоммитимом env. В BotFather разрешить фактический HTTPS Web origin и точный redirect URI `<AUTH_WEB_ORIGIN>/api/auth/telegram/callback`. Не использовать bot token вместо OAuth client secret. Web bridge остаётся под MOVARO_AUTH_PREVIEW=true, production gate закрыт; интерфейсы входа, onboarding и постоянной привязки подключены; выбор Telegram при входе и регистрации виден, но заблокирован с объяснением до включения capability. Реальный внешний Telegram OAuth ещё требует отдельного безопасного тестового окружения. Не логировать callback query, cookies, code/state, OAuth credentials. Для CI используются только локальные подписанные fixture tokens.

## Первый глобальный администратор (dev/test)

API: дополнительно задать AUTH_ADMIN_ORIGIN=http://127.0.0.1:3001 и независимый AUTH_ADMIN_SECRET (openssl rand -hex 32, хранить только в защищённом env). После сборки auth и применения миграций на проверенной dev/test БД оператор запускает pnpm --filter @freight/auth admin:create. Команда принимает только JSON через stdin из доверенного источника (email, password, firstName, lastName, birthDate в YYYY-MM-DD); пароль от 16 символов, не передавать через argv, историю команд, чат, Git или лог. Оператор подтверждает принадлежность email. Повторный запуск отклоняется, существующего пользователя не повышаем до admin. Не запускать на production или общей БД. Admin UI подключён в dev/test.

После создания первого admin в dev/test и запуска API, в отдельном терминале с теми же AUTH_ADMIN_ORIGIN и AUTH_BASE_URL запустить pnpm --filter @freight/admin exec next dev --hostname 127.0.0.1 --port 3001. Открыть http://127.0.0.1:3001/ru/login. Admin secret нужен только API, не приложению Admin. Без действительной admin session главная перенаправляет на login; обычная Web cookie не даёт доступ. Production остаётся закрыт. MFA/recovery администратора и production ingress/TLS остаются условиями последующей проверки.

## Worker и доверенный ingress

Для проверки cleanup и очередей запустить `pnpm dev:worker` в отдельном терминале с тем же доверенным локальным env и доступным S3. Не включать PROFILE_PHOTO_SCAN_ENABLED без подтверждённой изоляции namespace одной БД; см. [инфраструктурную инструкцию](../infra/README.md).

В прямом локальном режиме не задавать AUTH_PROXY_SECRET. За reverse proxy нужен отдельный 64-символьный hex secret, одинаково настроенный только в доверенных ingress/Web/Admin/API. Ingress обязан перезаписывать оба заголовка x-movaro-proxy-ip и x-movaro-proxy-secret, а upstream должны быть недоступны для обхода ingress. Произвольный X-Forwarded-For не является доверенным источником. Без доверенного режима клиенты за общим proxy могут делить IP-бюджет. Не публиковать секреты и не отключать проверки для исправления 403/429; production topology и нагрузочные лимиты ещё не приняты.
