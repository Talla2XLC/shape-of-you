---
id: "decisions-20260829-remove-day-closure-and-use-capture-first-coach"
kind: adr
title: "Удалить DayClosure и сделать Coach capture-first"
status: accepted
date: 2026-08-29
supersedes: ["decisions-20260811-model-versioned-person-local-day-closures", "decisions-20260827-orchestrate-daily-coach-over-existing-mcp-tools"]
superseded_by: null
tags:
  - "chatgpt"
  - "coaching"
  - "daily-projection"
  - "mcp"
  - "nutrition"
  - "postgresql"
---

# Удалить DayClosure и сделать Coach capture-first

## Context

Shape of You хранит independently owned Physical State, Nutrition, Training,
Recovery и Coaching facts в PostgreSQL. `DayClosure` был добавлен как ручной
Person-local lifecycle: пользователь закрывает дату, система сохраняет
immutable snapshot, а поздний факт делает его `stale` и требует явного
`reopen → edit → close`.

Этот lifecycle решает только один вопрос: что система считала состоянием дня в
момент ручного закрытия. Он не нужен для смены календарной даты, владения
фактами, current analytics или corrections. Продукт не имеет сценария, где
пользователю важнее старый snapshot, чем актуальные исправленные факты.
`DayStatus = Closed` пришёл из legacy Google Sheets и был перенесён в domain
model без подтверждённой пользовательской потребности.

TASK-0077 дополнительно настроил ChatGPT connector как `ask_before_writes`, а
MCP instructions потребовали отдельные confirmations для routine write и всех
трёх closed-day mutations. В результате простое сообщение вроде «я выпил
капучино» превращается в несколько разрешений. Текущий `CreateMeal` также
требует полные nutrient values, хотя persisted Meal уже умеет хранить partial
Nutrition. Это подталкивает client либо к лишним вопросам, либо к выдуманной
точности.

Пользовательская модель иная: человек непрерывно сообщает релевантные факты,
Coach сохраняет максимально полное честное представление, а позднее сообщение
может исправить предыдущую запись. Conversation history не становится
authority; authority остаётся у typed facts в PostgreSQL.

## Decision

### Удалить DayClosure

Полностью удалить `DayClosure` как product, domain, persistence и integration
contract. Не оставлять hidden или automatic close/reopen lifecycle.

- `get_daily_projection` остаётся typed MCP read, но всегда компонует current
  owning-domain facts для exact `localDate` и IANA `timezone`.
- `DailyProjection` больше не содержит `open`, `closed`, `stale`,
  `superseded`, closure version или freshness относительно старого snapshot.
  Он содержит время композиции и актуальный typed snapshot.
- Удаляются HTTP close/reopen/history routes, Web controls и closure history.
- Удаляются MCP tools `list_day_closure_history`, `close_day` и `reopen_day`.
- Удаляются `day-closure:write`, DayClosure repositories/tables/enums,
  operation/reference ledgers и Nutrition closure-import records/classifiers.
- Legacy Google Sheets `DayStatus` больше не импортируется и не влияет на
  operational state. Workbook остаётся frozen read-only legacy reference и не
  используется как fallback.

Удаляемые rows являются производными snapshots и import audit, а не
authoritative Weight, Body, Meal, WorkoutSession, RecoveryObservation,
DailyContextNote или Coaching facts. Destructive schema migration требует
отдельного deployment approval и выполняется только после migration tests и
rollback review.

### Capture-first routine writes

Релевантное сообщение пользователя является достаточным намерением для одного
routine low-risk idempotent typed write. Coach не задаёт второй вопрос
«подтвердить запись?» и не просит повторить уже сообщённое.

После каждого write client обязан автоматически выполнить owning-domain typed
read-back. Успех сообщается только при совпадении identifier и ключевых typed
fields. Tool/OAuth failure, inconsistent read-back или отсутствие безопасного
typed destination работают fail closed без Google Sheets или chat-history
fallback.

Capture использует наиболее точное честное представление:

1. создать owning-domain fact, если сообщение содержит его обязательную
   семантику;
2. сохранить неизвестные optional values как `null`/partial и понизить
   confidence, а не подставлять ноль или произвольную норму;
3. использовать user-requested estimate или подтверждённый catalog evidence,
   когда пользователь действительно просит оценку;
4. сохранить релевантное, но пока неразложимое наблюдение как typed
   `DailyContextNote`, не создавая generic fact authority;
5. уточнять только irreducible ambiguity, когда выбор может изменить не тот
   факт, Person/date или materially different domain meaning.

Позднее уточнение автоматически использует существующий append-only correction
contract и supersedes текущую версию. Исходная provenance и correction reason
сохраняются. Никакого destructive overwrite нет.

Interactive Meal create/correct contracts должны принимать partial nutrient
values, уже поддерживаемые persisted Meal. Один неизвестный напиток может быть
записан как `1 serving` с исходным label/description, неизвестными nutrients и
partial completeness. Точные calories/macros не изобретаются.

Native confirmation остаётся только у destructive, security-sensitive или
high-impact действий: deletion, credential/OAuth changes, administrative
operations и materially changing goals/programs. Routine create/correct facts
и прямо выраженные non-destructive Coaching decisions не требуют отдельного
confirmation prompt. После deployment connector переключается с
`ask_before_writes` на разрешение low-risk actions отдельным operator-approved
configuration step.

### Обычный Chat вместо Work

Постоянная launcher binding должна указывать на обычный ChatGPT Chat, а не
`chatgpt_work`. Оператор выбирает Instant в этом conversation; Shape of You
хранит только opaque conversation binding и не может принудительно выбрать
model через redirect URL. Binding contract получает provider-neutral
conversation surface name вместо ложного Work-specific ownership.

Создание Chat conversation, изменение binding, connector permission и OAuth
reconnect являются внешними operational changes и требуют отдельных
подтверждений. Они не выполняются локальной implementation автоматически.

### TASK-0078

Не выпускать незакоммиченную TASK-0078 implementation. Hardcoded
`nutrition_next_meal` limits, mandatory policy activation, extra proposal
confirmation и exact Meal execution ceremony противоречат capture-first
решению. Полезные существующие CoachingRecommendation invariants сохраняются,
но новый Nutrition policy не вводится в TASK-0079.

## Considered alternatives

- **Оставить DayClosure и переписать prompt:** сохраняет stale snapshots и
  write gate, поэтому native и textual friction остаётся. Отклонено как лечение
  симптома.
- **Скрыть DayClosure и автоматически reopen/reclose:** убирает часть UI, но
  создаёт невидимую mutation choreography, лишние failure states и snapshots,
  которые продукт не читает. Отклонено.
- **Оставить snapshots только как internal audit:** дублирует current facts и
  требует retention/versioning без подтверждённого audit consumer. Отклонено.
- **Удалить DayClosure и всегда читать current facts:** выбранный вариант. Он
  соответствует пользовательской модели, уменьшает contracts и сохраняет
  ownership/correction invariants.
- **Добавить generic intake service или новую chat platform:** могло бы хранить
  raw utterances, но создаёт новый deployable/data authority и не нужно для
  typed capture. Отклонено.

## Consequences

- Любая дата показывает последние current facts, включая поздние additions и
  corrections.
- Исчезает возможность спросить, каким был старый derived daily snapshot в
  момент ручного close. Продукт осознанно отказывается от этой возможности.
- MCP surface уменьшается на три DayClosure tools; cutover inventory, OAuth
  scopes, tests и documentation должны измениться атомарно.
- Удаление `day-closure:write` из predefined client allowlist делает текущие
  refresh tokens несовместимыми с Identity validation. Deployment должен быть
  coordinated с отдельно разрешённым OAuth reconnect; до него staging не
  меняется.
- Routine capture становится коротким, но integrity не ослабляется:
  idempotency, provenance, Person isolation, domain validation, append-only
  correction и typed read-back остаются hard boundaries.
- Partial inputs становятся явной частью public Meal contract. Unknown не
  означает zero и не участвует в complete Nutrition totals как известное
  значение.
- Не появляется новый service, database, OAuth client, queue, scheduler,
  generic daily aggregate или собственный chat UI.

## Verification

- Contract/API tests доказывают, что daily projection всегда live и не содержит
  closure lifecycle fields.
- Migration tests проходят для clean install и каждого journal prefix,
  статически проверяют PostgreSQL identifiers ≤63 UTF-8 bytes и подтверждают,
  что удаление closure tables не меняет owning-domain facts.
- MCP tests подтверждают отсутствие трёх closure tools, нового hardcoded
  Nutrition proposal surface и confirmation language для routine writes.
- Meal integration tests покрывают unknown nutrients, partial completeness,
  idempotent create, automatic append-only correction и exact read-back.
- Web tests подтверждают отсутствие close/reopen/history UI и работу live dated
  projection.
- Identity tests фиксируют breaking scope contraction и блокируют deployment
  без согласованного OAuth reconnect.
- Live E2E после отдельных operational approvals проверяет: обычный Chat с
  Instant, одно сообщение о факте, zero confirmation dialogs, один typed write,
  один typed read-back и корректный ответ пользователю.
- Independent Quality и Architecture Reviews подтверждают отсутствие hidden
  closure lifecycle, fabricated precision, duplicated authority и новых
  deployable boundaries.

## Related material

- [Superseded DayClosure ADR](20260811-model-versioned-person-local-day-closures.md)
- [Superseded Daily Coach ADR](20260827-orchestrate-daily-coach-over-existing-mcp-tools.md)
- [Independent facts over broad daily records](20260728-prefer-independent-facts-over-broad-day-record.md)
- [TASK-0079 plan](../../plans/2026/08/2026-08-29-task-0079-capture-first-coach.md)
