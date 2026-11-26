# MOVARO — дизайн-система (RD-03)

Задача #4, родитель #1. Название MOVARO утверждено владельцем 26.11.2026.
Репозиторий и технический namespace @freight не переименовываем.

## Утверждённое направление

Мягкий тёмный интерфейс с умеренной глубиной поверхностей, кобальтовый акцент,
Manrope, компактная типографика 13/12 px, заголовки 24–28 px, Lucide 16 px,
радиусы карточек 12–16 px, контролов 8–12 px. Dark по умолчанию, light обязательно.
RU/EN. Не копируем чужие логотипы или данные. Финальные оттенки и размеры
принимает владелец в браузере.

## Первый срез

- apps/web и apps/admin — отдельные Next.js App Router приложения, порты 3000/3001.
- packages/ui — общий Header, PageLayout, семантические токены, cookie предпочтения темы.
- packages/i18n — общие RU/EN сообщения, локали в URL, next-intl.
- Tailwind подключён; первая палитра предварительная, не финальный визуальный дизайн.
- Название MOVARO в wordmark и metadata. Фирменный знак отдельно согласуется.
- Нет бизнес-данных и фиктивной авторизации. Admin в production закрыт до RD-04.

## До приёмки RD-03

- Настоящий pnpm-lock.yaml, frozen install, lint, typecheck, unit, build, license check.
- Локальный Manrope (проверить OFL и обязанности), shadcn/ui primitives и общие
  компоненты Sidebar/Header/PageLayout, формы, таблицы и состояния.
- Storybook, Playwright, клавиатура и адаптивность; обе темы и обе локали.
- Ручная приёмка владельцем. Не сливать draft PR до полного выполнения #4.
- Ролевую навигацию и авторизацию завершить в RD-04.

## Второй срез

- Manrope через локальный npm-пакет @fontsource-variable/manrope@5.3.0; CSS и WOFF2 входят в сборку. Не обращаться к Google Fonts.
- Первые примитивы на основе паттернов shadcn/ui (Radix Slot, CVA, cn), Card и Button; адаптированы под токены MOVARO. Tailwind сканирует общий пакет UI.
- AppShell и адаптивный Sidebar в dev-admin. Web остаётся публичным. Только существующий маршрут, без вымышленных разделов и данных. Production admin закрыт на уровне layout до RD-04.
- Сохранение темы через cookie оставлено для совместимости и SSR; точечное исключение Biome только для фиксированного несекретного предпочтения.
- Обновить lockfile, проверить реальное применение шрифта, лицензии, браузер и сборку. Storybook, формы, таблицы и состояния остаются открытыми.

## Третий срез — формы, таблицы и состояния

После принятия архитектурной ревизии PR #23 (merge 8b0e647) владелец подтвердил продолжение, но не финальный визуальный стиль.

- Общий набор UI-примитивов на основе официального MIT registry shadcn new-york-v4 (Radix): Input, Textarea, Label, Separator, Field/FieldGroup/FieldSet/FieldError, Table со слотами, Alert, Empty, Skeleton, Badge. Сохранены семантические элементы и передача React props/ref; адаптация компактности и токенов, отдельные пакеты Radix вместо установки агрегатного пакета. Токен input общий для обеих тем; dark-модификаторы не полагаются на системную тему.
- FieldError удаляет повторяющиеся сообщения, использует стабильные ключи. Поля привязываются к label через id/htmlFor; ошибки через aria-invalid и aria-describedby. Строки приходят от вызывающего кода/локализации, не захардкожены в UI.
- Table — семантические примитивы; при реализации таблиц данных использовать TanStack Table по официальной документации. Сортировку/фильтрацию/пагинацию не имитируем.
- Для бизнес-форм применить React Hook Form + Zod по документации, а не создавать собственный менеджер форм. Пока нет бизнес-форм и фиктивных записей в Web/Admin.
- Добавлены SSR markup-тесты примитивов. Это не заменяет тестирование поведения в браузере.

Источники: https://github.com/shadcn-ui/ui/tree/main/apps/v4/registry/new-york-v4/ui ; https://ui.shadcn.com/docs/components/radix/field ; https://ui.shadcn.com/docs/forms/react-hook-form ; https://ui.shadcn.com/docs/components/radix/data-table ; https://www.radix-ui.com/primitives/docs/components/label ; https://www.radix-ui.com/primitives/docs/components/separator .

Новые зависимости @radix-ui/react-label 2.1.8 и @radix-ui/react-separator 1.1.8 требуют реального pnpm install, lockfile, lint/typecheck/test/build и license check. Проверки после среза ещё не выполнялись. Следующий срез: Storybook с тестовыми историями, обе темы/локали, Playwright на реальных маршрутах, интеграция form/data-table и ручная приёмка. Не публиковать Storybook в production Web/Admin.
