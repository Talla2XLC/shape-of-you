# TASK-0081 — Естественная речь Coach и честная запись еды без известного объёма

## Статус и gate

- Реализация завершена; Quality и Architecture Reviews дали ACCEPT
  2026-08-30. Deployment и release остаются отдельными operator gates.
- Оператор одобрил продуктовый принцип 2026-08-30: пользователь не обязан знать
  граммы; запись выполняется сразу, а фото или текстовое описание объёма можно
  необязательно предложить позже, только когда точность важна.
- Accepted ADR:
  `docs/adr/20260830-model-unquantified-meal-amount-evidence-and-natural-coach-language.md`.
- Exact amount-evidence contract и implementation plan одобрены оператором
  2026-08-30. Routine Coach voice является обязательным acceptance criterion:
  ответ должен звучать как реальный тренер, а не технический интерфейс.
- Не разрешены deployment, staging/production writes, execution migrations,
  connector/OAuth changes, Google Sheets actions, secrets, commit и push.

## Проблема

Live ChatGPT E2E показал, что текущий capture-first flow сохраняет отсутствующее
количество как выдуманную `1 serving`, а ответ Coach раскрывает `partial`,
`null`, tool names и typed read-back. Это одновременно портит данные и делает
разговор похожим на отладочный протокол.

## Цель

Записывать названные продукты сразу и честно даже без массы или размера порции,
поддерживать необязательное последующее уточнение по тексту или фото и отвечать
естественным языком тренера, не раскрывая machine contract.

## Scope

1. Ввести явное Meal item amount evidence:
   `unknown|described|quantified|estimated`.
2. Сделать quantity/unit nullable и сохранить бытовое amount description без
   искусственной числовой нормализации.
3. Для client-generated estimate хранить `text|photo` method и item-level
   confidence.
4. Мигрировать existing rows как `quantified`, не меняя их values/nutrients.
5. Сохранить capture-first write, idempotency, provenance, append-only
   correction и automatic typed read-back.
6. Запретить sentinel `1 serving` и fabricated amount/nutrients.
7. Разделить internal MCP protocol и user-facing Coach voice.
8. Разрешить необязательное предложение фото или текстового описания только
   после успешной записи и только когда точность полезна.
9. Не добавлять media storage, upload tool, service, database, OAuth client,
   chat UI или Google Sheets fallback.
10. Выполнить независимые Quality и Architecture Reviews.

## User-facing contract

- «Я съел чечевичный суп» сразу создаёт Meal item с unknown amount.
- «Большая тарелка чечевичного супа» сохраняет исходное описание объёма без
  подстановки граммов.
- «250 г супа» сохраняет quantified amount.
- Оценка по тексту или фото создаёт estimated amount только когда client
  действительно выполнил оценку; method/confidence обязательны.
- Отсутствие количества не является ошибкой и не блокирует capture.
- Coach может сказать: «Зафиксировал. Если захочешь точнее оценить питание —
  пришли фото или примерно опиши объём», но не обязан задавать вопрос.
- Routine reply не содержит `partial`, `null`, enum/property/tool names,
  arguments, identifiers, `typed read-back` или transport details.
- Полный daily plan может использовать понятную структуру, но routine capture
  отвечает одной-двумя естественными фразами.

## Implementation stages

### 1. Contracts и domain invariants

- расширить Meal item input/output contracts amount evidence fields;
- определить conditional JSON Schema invariants для четырёх amount kinds;
- оставить Nutrition completeness machine-readable и не смешивать её с amount
  evidence;
- обновить exported TSDoc и contract fixtures.

### 2. PostgreSQL schema и migration

- добавить amount kind/method/description/confidence representation;
- разрешить nullable quantity/unit;
- заменить positive-values check на condition-aware checks;
- backfill existing meal items как quantified;
- покрыть clean install и every-prefix upgrades;
- статически проверить PostgreSQL identifiers ≤63 UTF-8 bytes.

### 3. Nutrition repository и projections

- сериализовать и сохранять все amount kinds без sentinel values;
- сохранить nutrients null-not-zero и честные daily totals;
- проверить list/read-back и append-only correction;
- не менять source authority или catalog snapshot semantics.

### 4. MCP capture и Coach voice

- обновить operational instructions и record/correct Meal descriptions;
- запретить выдуманное количество и обязательный clarification precondition;
- сделать optional post-capture refinement естественным и bounded;
- запретить internal vocabulary в routine user-facing replies;
- оставить protocol requirements, tool execution и read-back machine-facing;
- не обещать скрыть платформенный tool-invocation UI.

### 5. Documentation и reviews

- после Quality ACCEPT обновить affected current-state Wiki pages;
- исправить прежнее ADR-допущение `1 serving` новым связанным решением, не
  переписывая историю принятого ADR;
- провести independent Quality и Architecture Reviews.

## Acceptance criteria

1. Meal item без количества валиден и сохраняется с unknown amount без
   quantity/unit sentinel.
2. Бытовое описание сохраняется verbatim как described amount без invented
   grams/servings.
3. Quantified и estimated amounts различаются; estimate требует method и
   confidence.
4. Invalid field combinations отклоняются в contract и database layers.
5. Existing rows после migration сохраняют исходные quantity/unit/nutrients и
   получают quantified amount kind.
6. Unknown/described amount не превращает unknown nutrients в zero и не
   публикует known-subset totals как полный итог.
7. Capture/correction выполняются без обязательного вопроса, затем проходят
   owning-domain typed read-back.
8. Позднее количество или оценка создаёт append-only correction к однозначному
   current Meal.
9. Routine Coach reply естественно перечисляет учтённые/исключённые продукты и
   не содержит internal contract vocabulary.
10. Фото остаётся transient client input; no media persistence/tool/service
    добавлен.
11. Exact MCP tool count, OAuth scopes, PostgreSQL authority и no-Sheets
    fallback не меняются.
12. Unit/integration/migration/MCP/docs gates проходят; Quality и Architecture
    дают ACCEPT.

## Validation plan

- contracts unit tests для amount evidence union/invariants;
- Nutrition repository/service/controller/MCP unit and integration tests;
- PostgreSQL clean-install и every-journal-prefix migration suite;
- static generated-identifier byte-length gate;
- daily totals и projection regressions для unknown nutrients;
- MCP metadata/voice fixtures для короткого capture и correction;
- root/API typecheck, lint, build и focused/full tests;
- `node scripts/validate-docs.mjs`, `git diff --check`, 4DreamTeam validation;
- live staging E2E только после отдельных operational approvals.

## Риски и stop conditions

- Если nullable amount ломает внешний consumer, task возвращается в analytic
  для compatibility strategy; silent sentinel fallback запрещён.
- Если photo support требует media persistence или новый public upload tool,
  это отдельный ADR/task.
- Если невозможно однозначно определить Meal для correction, Coach может
  уточнить target, но не переписывает произвольную запись.
- Миграция выполняется только в disposable integration databases до отдельного
  deployment approval.
- Commit/push/deployment/staging writes остаются отдельными gates.
