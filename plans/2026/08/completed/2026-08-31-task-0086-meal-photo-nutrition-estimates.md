# TASK-0086 — Оценка калорий и БЖУ по фото еды

## Статус и gate

- Оператор одобрил рекомендуемый вариант 2 2026-08-31.
- Реализация, Quality Review и Architecture Review завершены с `ACCEPT`.
- Изменение реализует существующую архитектуру `estimated` Meal evidence;
  новая ADR, миграция или entity не требуются.
- Не разрешены deployment, staging/production writes, Google Sheets actions,
  OAuth reconnect, secrets, commit и push.

## Проблема

При достаточно понятном фото ужина Coach сохранил только названия продуктов и
оставил калории и БЖУ неизвестными, сославшись на отсутствие точных граммов.
Текущие MCP-инструкции допускают фото-оценку, но делают её необязательной и
несколько раз запрещают «выдумывать» nutrients. Модель выбирает самый
консервативный путь, хотя существующий Meal contract уже поддерживает
`estimated` quantity, method, confidence и nutrient snapshot.

## Цель

Использовать фото и полезное текстовое описание для немедленной best-effort
оценки порций, калорий и БЖУ. Оценка должна быть честно приблизительной, но
точные граммы не являются условием полезной записи.

## Scope

1. Сделать фото/текстовую оценку поведением по умолчанию, когда продукты и
   масштаб достаточно различимы.
2. Сохранять для каждого оценённого item количество/unit, method, confidence и
   calories/protein/fat/carbs через существующий `record_meal`.
3. Использовать unknown только при реальной невозможности разумной оценки, а не
   просто из-за отсутствия весов.
4. Не задавать предварительный вопрос и не требовать подтверждения routine
   estimate; позднее уточнение остаётся append-only correction.
5. В естественном ответе сообщать приблизительный результат и полезное
   наблюдение, не раскрывая internal vocabulary.
6. Закрепить точный сценарий с пюре, мясом, горошком, огурцами и помидорами.

## Acceptance criteria

1. MCP metadata прямо требует best-effort nutrition estimate для достаточно
   понятного фото или текста.
2. Connector schema объясняет, что отсутствие точных граммов не означает
   unknown и что estimated item должен включать четыре nutrient values.
3. Реалистичный фото-ужин проходит normalization со всеми item-level estimate
   evidence и ненулевыми calories/protein/fat/carbs.
4. Retry не отбрасывает валидные estimates и по-прежнему отклоняет
   противоречивые evidence combinations.
5. Meal write/read result guidance использует сохранённые estimates как
   приблизительные и не объявляет калории недоступными.
6. Routine reply остаётся коротким Coach-ответом без `partial`, `null`, tool,
   schema, API или read-back vocabulary.
7. Domain contract, PostgreSQL schema, corrections, read-back, OAuth scopes,
   tool count и deployable topology не меняются.

## Проверка

- focused MCP unit tests;
- full API tests;
- API typecheck, lint и build;
- documentation validator и `git diff --check`;
- независимые Quality и Architecture Reviews.

## Результат

- Для достаточно понятного фото или текста Coach обязан немедленно оценить и
  сохранить порции, калории и БЖУ через существующий `record_meal`.
- Отсутствие точных весов больше не является причиной оставлять nutrients
  пустыми; неопределённость выражается существующим confidence evidence.
- Позднее уточнение пользователя применяется как обычная append-only
  correction без изменения доменной модели.
- Проверки пройдены: 118 focused MCP tests, 185 full API tests, typecheck,
  lint, build, documentation validator и `git diff --check`.
