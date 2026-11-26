# Лицензии сторонних компонентов

Репозиторий содержит коммерческий продукт в разработке. Публичный доступ к исходному коду не является лицензией на продукт. Лицензии зависимостей регулируют использование соответствующих компонентов отдельно.

## Проверка npm/pnpm

Команда `pnpm licenses:report` после frozen install и установки изолированного тестового модуля собирает уникальные name@version из физических установленных пакетов pnpm и npm, включая dev-зависимости. Она выводит группировку по заявленной лицензии и список REVIEW для непроверенных записей. `pnpm licenses:check` запускает тесты политики и завершает CI с ошибкой при любой непроверенной лицензии. Проверка охватывает физически установленные пакеты на Linux; отдельно проверяются зависимости других платформ и содержимое поставляемых артефактов.

Первый отчёт CI #28: 527 уникальных пакетов, из них 372 в workspace. Политика допускает распространённые разрешительные лицензии и следующие проверенные метаданные: BlueOak-1.0.0 (передать текст или ссылку на лицензию получателям), Python-2.0 (сохранить условия и уведомления), Unlicense (сохранить текст), точные выражения MIT OR Apache-2.0 и (MIT OR CC0-1.0) (выбираем MIT). Составные выражения не разбираются автоматически: любое новое выражение требует review. Общие условия: https://spdx.org/licenses/.

Источники: https://blueoakcouncil.org/license/1.0.0, https://github.com/nodeca/argparse/blob/2.0.1/LICENSE, https://github.com/dchest/tweetnacl-js/blob/v0.14.5/LICENSE, https://github.com/sindresorhus/type-fest/blob/v5.10.0/license-mit, https://github.com/biomejs/biome.

Исключения только для отсутствующего поля license у трёх точных версий в изолированных тестовых зависимостях:

- buildcheck@0.0.7 — MIT: https://github.com/mscdex/buildcheck/blob/v0.0.7/LICENSE.
- cpu-features@0.0.10 — MIT для Node.js-обёртки: https://github.com/mscdex/cpu-features/blob/v0.0.10/LICENSE; встроенная библиотека Google cpu_features — Apache-2.0, https://github.com/google/cpu_features.
- ssh2@1.17.0 — MIT: https://github.com/mscdex/ssh2/blob/v1.17.0/LICENSE.

Исключения не действуют при обновлении версии, изменении метаданных или появлении пакета в workspace. Это начальная инженерная политика допуска, а не утверждение о юридической чистоте всех артефактов. При изменении политики требуется отдельное обоснование в PR. Не допускается обход gate добавлением широкого исключения.

## Серверные компоненты

- PostgreSQL 17: PostgreSQL License, https://www.postgresql.org/about/licence/.
- SeaweedFS 4.51 Community: основная лицензия Apache-2.0, https://github.com/seaweedfs/seaweedfs/blob/4.51/LICENSE. Не использовать Enterprise-функции без соответствующих прав.
- Docker-образы содержат дополнительные пакеты и уведомления. Основная лицензия проекта не покрывает автоматически все компоненты образа. Проверить конкретные digest, SBOM, LICENSE/NOTICE, базовый образ и требования к распространению до production. Отдельно учитывать Docker Desktop, если используется; Docker Engine и Docker Desktop — разные продукты.
- SeaweedFS: upstream уже рассматривал лицензии встроенных статических ресурсов (https://github.com/seaweedfs/seaweedfs/issues/11336); задача закрыта в upstream, однако состав используемого образа необходимо подтвердить отдельно.

Перед распространением или поставкой продукта необходимо сохранить применимые тексты лицензий, copyright/NOTICE, проверить copyleft, сетевые и патентные условия, а при необходимости получить юридическое заключение. Не считать отчёт по метаданным доказательством полного соответствия.

## Инвентаризация образов

CI запускает `python3 scripts/report-images.py` после загрузки образов PostgreSQL и SeaweedFS. Скрипт фиксирует фактический registry digest, ID, архитектуру, список OS-пакетов из dpkg/apk и пути найденных LICENSE/NOTICE/copyright. Файловая система экспортируется из временного контейнера без запуска его кода. Это инвентаризация, не полный SBOM: статически скомпонованные библиотеки, Go-модули, веб-ресурсы и иные форматы пакетов требуют дополнительной проверки. Отсутствие базы пакетов явно помечается REVIEW. Полный review образов и фиксация production digest остаются обязательными до RD-18; тестовые образы Testcontainers/Ryuk также требуют отдельного учёта. Наличие GPL-компонента в базовом Linux-образе не тождественно GPL-лицензированию приложения, но необходимо учитывать условия распространения конкретного образа.

## Проверка уязвимостей изолированного тестового модуля

В CI после воспроизводимой установки npm ci выполняется `npm --prefix scripts/auth-compat audit --audit-level=moderate`. Наличие известных уязвимостей уровня moderate, high или critical блокирует quality; ошибки registry также не игнорируются. Это контроль отдельного npm lockfile, не полный security audit workspace, образов или приложения.

На 26.11.2026 локальный аудит обнаружил 7 moderate по цепочке testcontainers → archiver → archiver-utils → glob/minimatch. В scripts/auth-compat/package.json добавлен точечный override archiver-utils → glob@14.0.2 (GHSA-3g3m-2fjr-6pw4); обновлён настоящий npm lockfile, minimatch разрешён в 11.0.9 (GHSA-g3hv-75wg-m249), отдельная ветка readdir-glob использует 5.1.9. Транзитивный testcontainers обновился до 12.2.2 при неизменном @testcontainers/postgresql@12.2.1. npm ci, npm audit (0 vulnerabilities), реальный PostgreSQL Testcontainers / Better Auth / SSE и licenses:check локально прошли; 518 установленных уникальных пакетов, 0 непроверенных лицензий. Override выходит за заявленный major-диапазон archiver-utils; при обновлении родительской зависимости пересмотреть необходимость override и повторить интеграционные проверки. Не применять npm audit fix --force без review.

## RD-03 — Manrope и UI

- @fontsource-variable/manrope@5.3.0 — OFL-1.1, разрешён только точный пакет с этой лицензией. https://fontsource.org/fonts/manrope/about ; https://openfontlicense.org/ofl-faq/ . Не продаём шрифт отдельно и сохраняем исходную лицензию и copyright. Перед приёмкой скопировать оригинальный LICENSE из установленного пакета в public/licenses/manrope.txt обоих приложений; проверить наличие в поставке. Полный review production-артефактов остаётся открытым.
- Компоненты адаптированы по подходу shadcn/ui (MIT), https://github.com/shadcn-ui/ui ; оригинальная MIT-лицензия сохранена в docs/licenses/shadcn.txt. Radix Slot, CVA, clsx, tailwind-merge — проверяются общим отчётом лицензий.

## RD-03 — лицензии инструментов frontend (26.11.2026)

Локальный прогон на macOS ARM64 для e8aec5c: 597 установленных пакетов, 453 workspace, 5 REVIEW. Это не ошибка исполнения приложения. Проверены upstream-условия и, где доступны, manifest и LICENSE соответствующих версий; полное исследование содержимого npm tarball и бинарных компонентов не выполнено. Следующие записи допускаются **только для разработки и CI** по точным name@version, заявленной лицензии и источнику workspace. Новые версии и другие платформы требуют отдельного review. Linux x64/arm64 glibc включены как зафиксированные в lockfile целевые варианты; их фактическая установка ещё не подтверждена.

| Компонент                                                                                                 | Лицензия           | Условия и проверка до распространения                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @swc/core-darwin-arm64, @swc/core-linux-x64-gnu, @swc/core-linux-arm64-gnu 1.16.22                        | Apache-2.0 AND MIT | Соблюдать обе лицензии, сохранить copyright, применимые NOTICE и уведомления о модификациях; проверить лицензии всех встроенных Rust-компонентов конкретного бинарника.                                                                                                                                                                         |
| caniuse-lite 1.0.30001828                                                                                 | CC-BY-4.0          | При распространении данных сохранить атрибуцию caniuse.com, предоставленные copyright, ссылку на лицензию и указать изменения, если были. Проверить, попадают ли данные в клиентский bundle.                                                                                                                                                    |
| lightningcss и lightningcss-darwin-arm64, lightningcss-linux-x64-gnu, lightningcss-linux-arm64-gnu 1.33.0 | MPL-2.0            | Компилятор CSS. При распространении покрытых MPL файлов/бинарника сохранить notices и предоставить соответствующий исходный код покрытых файлов, включая изменения. MPL не требует автоматически лицензировать весь отдельный код приложения под MPL. Проверить фактический состав поставки.                                                    |
| @img/sharp-libvips-darwin-arm64, @img/sharp-libvips-linux-x64, @img/sharp-libvips-linux-arm64 1.3.4       | LGPL-3.0-or-later  | Нативная библиотека обработки изображений; upstream перечисляет дополнительные библиотеки, включая LGPLv3, MPL 1.1 и патентные условия AOM. При распространении проверить точные исходники, тексты GPL/LGPL и notices, условия замены/перелинковки библиотеки и условия всех встроенных компонентов. Не считать один manifest полной проверкой. |

Источники:

- SWC v1.16.22: https://github.com/swc-project/swc/blob/v1.16.22/LICENSE ; https://github.com/swc-project/swc/blob/v1.16.22/packages/core/scripts/npm/darwin-arm64/package.json ; https://github.com/swc-project/swc/blob/v1.16.22/packages/core/scripts/npm/linux-x64-gnu/package.json ; https://github.com/swc-project/swc/blob/v1.16.22/packages/core/scripts/npm/linux-arm64-gnu/package.json .
- caniuse-lite: https://github.com/browserslist/caniuse-lite#license ; https://creativecommons.org/licenses/by/4.0/legalcode.en .
- Lightning CSS v1.33.0: https://github.com/parcel-bundler/lightningcss/blob/v1.33.0/LICENSE ; https://www.mozilla.org/en-US/MPL/2.0/FAQ/ .
- sharp-libvips v1.3.4: https://github.com/lovell/sharp-libvips/blob/v1.3.4/THIRD-PARTY-NOTICES.md ; https://www.gnu.org/licenses/lgpl-3.0.html .

Отчёт печатает REVIEWED FOR DEVELOPMENT; RELEASE REVIEW для этих пакетов. Нулевое число REVIEW не означает разрешения распространять бинарники. До RD-18 необходимы SBOM фактических артефактов, сбор LICENSE/NOTICE, проверка LGPL/MPL и атрибуции данных, а также юридическая оценка при необходимости. Пока не публикуем готовые дистрибутивы и образы MOVARO. Не разрешаем GPL/MPL/LGPL/CC-BY глобально; не отключаем блокирующую проверку неизвестных записей.

- argparse@3.0.4 — PSF-2.0. Сохранять лицензию и copyright, документировать изменения при распространении производной версии. https://github.com/nodeca/argparse/blob/3.0.4/LICENSE
