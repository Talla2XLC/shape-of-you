---
id: "decisions-20260919-bind-recovery-delivery-to-consent-generation"
kind: adr
title: "Привязать свежесть и полноту Recovery-доставки к поколению consent"
status: accepted
date: 2026-09-19
supersedes: ["decisions-20260918-expose-connected-recovery-freshness-to-coach"]
superseded_by: null
tags:
  - architecture
  - coaching
  - recovery
  - integrations
  - oauth
  - mcp
---

# Привязать свежесть и полноту Recovery-доставки к поколению consent

## Context

Принятый `connected-recovery-freshness-v1` отделил фактические
`RecoveryObservation` от состояния фоновой синхронизации и запретил Coach
объяснять отсутствующие данные неподтверждённой причиной. Однако reconnect
выявил более глубокий разрыв: новое OAuth-разрешение сбрасывает operational
timestamps, но существующие доказательства доставки продолжают жить под
стабильным `integration connection`.

После reconnect первая синхронизация выполняется асинхронно. До неё
`CurrentRecoveryContext` возвращает сохранённые observations предыдущего
consent без явного признака, что новое разрешение ещё не подтвердило их
актуальность. Одновременно `Integration` считает любую ранее нормализованную
wellness-запись и любой current fact pointer прямым доказательством target-date
delivery, хотя они не привязаны к текущему `integration_connections.consent_id`.

Уникальность `integration_inbox` определяется connection, kind, provider
identity и checksum. Поэтому первая доставка нового consent с тем же checksum
считается уже нормализованной и не подтверждает новое поколение отдельно.
`integration_recovery_facts` хранит current observation pointer и checksum, но
не хранит consent, которым факт был подтверждён в последний раз. В результате
система может одновременно вернуть `never_checked` и представить старые
значения как текущие либо после нового `fresh_success` ошибочно наследовать
доказательство предыдущего consent.

Второй разрыв относится к частичной записи. Состояние
`supported_facts_present` доказывает только наличие хотя бы одного поля. Оно не
может выразить ситуацию, когда новая запись содержит HRV, но не содержит sleep,
steps и другие поддерживаемые metrics. Отсутствующие поля нельзя превращать в
zero или объяснять причиной, которой нет в typed evidence.

Третий разрыв относится к шагам. Текущий дневной count сохраняет provider
`updated` как `asOf`, но focused Recovery contract не маркирует этот count как
`partial_day`. Поэтому промежуточные 2 834 шага могут быть названы итогом суток,
хотя последующая фоновая синхронизация корректно создаёт immutable correction
до 12 002.

Решение должно сохранять retained history, correction chains, idempotency,
provider-neutral Coaching и локальное чтение. Coach и MCP не должны выполнять
синхронный provider request или зависеть от внешней доступности.

## Decision

1. Ввести `connected-recovery-freshness-v2` как provider-neutral контракт
   доказательства доставки. Этот ADR заменяет решение
   `decisions-20260918-expose-connected-recovery-freshness-to-coach`; v1
   остаётся отдельным readable compatibility contract, но больше не определяет
   current delivery semantics и не публикуется активным MCP tool schema.
2. Считать `consentId` поколением разрешения для существующего стабильного
   integration/recovery connection. Reconnect сохраняет connection identity и
   retained observations, но новое поколение не наследует доказательство
   доставки предыдущего поколения.
3. Сделать normalized wellness receipt consent-scoped. Новая inbox delivery
   identity включает connection, consent, kind, provider identity и checksum.
   Одинаковое содержимое, повторно доставленное при новом consent, является
   новой delivery receipt, хотя не является новым health fact.
4. Добавить к current Recovery fact pointer `confirmedConsentId`: consent,
   который последним подтвердил presence или absence поля. Сам pointer и
   immutable observation chain остаются стабильными между reconnect.
5. Первая нормализация текущего consent обрабатывает полный whitelist
   поддерживаемых wellness fields:
   - тот же checksum подтверждает существующий observation без создания дубля;
   - изменившийся checksum создаёт существующую immutable correction с причиной
     `provider_record_changed`;
   - отсутствовавшее в новой записи поле создаёт или подтверждает существующий
     withdrawal с причиной `provider_field_removed`;
   - повтор той же записи в том же consent является no-op.
6. Все изменения inbox status, fact pointers, observations и sync status
   выполняются только при совпадении ожидаемого `consentId` с текущим consent
   connection. Ответ старого worker после disconnect/reconnect не может
   подтвердить delivery или изменить Recovery chain. Подготовительные
   observation и pointer writes не публикуют freshness сами по себе: pointer
   связывается с `integration_inbox.id` конкретной normalization attempt, а
   projection признаёт его подтверждённым только после атомарного перевода
   именно этой receipt в `normalized`. Новый record checksum после другого
   record всегда создаёт новую receipt, включая `A → B → A`; retry незавершённой
   attempt переиспользует её же. Read projection дополнительно требует, чтобы
   `pointer.observationId` совпадал с exact current observation, возвращаемым
   Coach; несовпадение после частично записанной create/correction/withdrawal
   attempt закрывается в `retained_unconfirmed` или `unknown`. Это образует один
   проверяемый transactional publication fence; последовательность независимо
   видимых confirmation writes недопустима.
7. Миграция является additive и fail-closed. Существующие строки не получают
   текущий consent как доказательство только потому, что он сейчас активен.
   Generation можно восстановить только из строгой существующей связи; иначе
   она остаётся unconfirmed до следующей обычной фоновой синхронизации. Ручной
   backfill и provider refresh не требуются.
8. `CurrentRecoveryContext` продолжает возвращать retained typed observations,
   но только через отдельную Coach-safe closed projection: `kind`, временной
   интервал/Person-local дата, timezone, quality и typed health detail.
   Storage identity, `personId`, `connectionId`, `consentId`, `dedupeKey`,
   source-record identity, correction-chain ids и ingestion timestamps остаются
   внутри API. Raw `list_recovery_observations` сохраняет существующий correction
   contract и не переиспользуется как DTO current context. V2 также добавляет
   closed per-metric delivery evidence для полного
   поддерживаемого whitelist. Минимальные состояния:
   - `confirmed_present` — поле подтверждено текущим consent и имеет current
     observation;
   - `confirmed_absent` — нормализованная запись текущего consent не содержала
     поле; это не zero и не причина отсутствия;
   - `retained_unconfirmed` — сохранённое значение существует, но текущий
     consent его ещё не подтвердил;
   - `unknown` — нет доказательства presence, absence или retained value.
9. Aggregate `targetDateDelivery` может сохраняться только как краткая
   совместимая сводка. Coach объясняет полноту по per-metric evidence и не
   выводит её из наличия хотя бы одного observation.
10. Для `steps/count` текущего Person-local дня v2 возвращает
    `periodState = partial_day` и точный `asOf`, если observation допустим.
    `partial_day` означает только накопленную к `asOf` нижнюю границу. Такое
    значение нельзя называть итогом, полным дневным результатом или доказательством
    низкой активности. Завершённые исторические дни могут иметь
    `periodState = completed_day` только по уже принятому day-role contract.
11. MCP instruction обязан использовать typed v2 state:
    - до первой успешной синхронизации после reconnect сообщать, что значения
      сохранены ранее и их свежесть новым подключением ещё не подтверждена;
    - при частичной доставке перечислять только подтверждённые показатели, а
      остальные называть не доставленными без zero и без causal explanation;
    - steps с `partial_day` называть промежуточным значением на `asOf`;
    - не сравнивать timestamps самостоятельно и не придумывать completeness.
12. `DailyAssessment` V1/V2/V3 snapshots, checksum, status и action не включают
    consent generation или delivery metadata. V2 context объясняет доступность,
    но не становится второй decision authority.
13. `get_current_recovery_context` остаётся локальным read-only MCP tool под
    существующим read scope. Он не принимает provider/connection/person id, не
    инициирует sync, не создаёт automation и не обращается к внешнему provider.
14. Provider-specific field mapping остаётся внутри Intervals.icu adapter.
    Consent generation, delivery states, partial-day semantics и Coaching
    wording остаются provider-neutral.

## Considered alternatives

### Выводить поколение из timestamps

Можно сравнивать `RecoveryObservation.createdAt`, provider `occurredAt`, pointer
`updatedAt` или consent `grantedAt`. Это уменьшает migration, но не доказывает
доставку: неизменившийся health fact не обязан получать новый timestamp,
provider `asOf` может предшествовать reconnect, а у отсутствующего поля вообще
нет observation. Отклонено как недоказуемое.

### Создавать новый connection при каждом reconnect

Полностью разделяет поколения физическими идентификаторами, но дробит историю,
усложняет retention, erasure и correction chains, а также создаёт риск дублей
одних и тех же health facts. Отклонено как несоразмерное.

### Очищать inbox и fact pointers при reconnect

Быстро сбрасывает старую delivery state, но разрушает audit и idempotency
links, провоцирует повторное создание observations и оставляет race со старым
worker. Отклонено как деструктивное.

### Исправить только prompt

Prompt может запретить слово «итог», но не получает доказательства поколения и
частичной доставки. Модель продолжит угадывать. Отклонено.

### Consent-scoped delivery ledger и стабильная observation history

Выбранный вариант. Он разделяет delivery evidence и health fact identity,
сохраняет corrections и делает partial delivery проверяемой ценой additive
migration и более строгого transactional fencing.

## Consequences

- После reconnect retained Recovery facts остаются доступны, но явно теряют
  подтверждение свежести до первой доставки текущего consent.
- Byte-identical replay подтверждает старый факт без дублирования observation.
- Изменения и удаления продолжают использовать существующие immutable
  correction/withdrawal chains.
- HRV-only и другие частичные записи становятся явными на уровне каждого
  поддерживаемого поля.
- MCP contract получает versioned additive v2 semantics; существующие v1
  snapshots и DailyAssessment contracts остаются readable и неизменными.
- Потребуются additive PostgreSQL migration, static identifier-length check и
  upgrade tests. Никакой ручной migration, backfill или server operation в
  рамках задачи не выполняется.
- На период после deploy и до следующего обычного poll часть старых значений
  может честно отображаться как `retained_unconfirmed`. Это ожидаемый
  fail-closed переход, а не потеря данных.
- Новые deployable, queue, scheduler, provider-on-read path и dependency не
  появляются.

## Verification

- Clean и upgrade migration tests проверяют consent-scoped constraints,
  foreign keys и все PostgreSQL identifiers на предел 63 UTF-8 bytes.
- Reconnect integration tests покрывают retained values до первого sync,
  byte-identical replay, changed value, removed field, already-removed field,
  HRV-only record и повторный idempotent poll.
- Race tests удерживают старый rolling и historical response через reconnect и
  доказывают отсутствие mutation в inbox, pointers, observations и sync state.
- Contract/policy tests проверяют закрытые per-metric states и запрет
  невозможных комбинаций.
- Steps tests проверяют `partial_day`, exact `asOf`, запрет final-total wording,
  correction 2 834 → 12 002 и retry no-op.
- MCP tests проверяют exact structured content, read-only scope, Person
  isolation, отсутствие provider call и deterministic wording.
- DailyAssessment regression доказывает неизменность V1/V2/V3 snapshots,
  checksum, status и action при изменении только delivery metadata.
- Выполняются full unit/integration tests, typecheck, lint, build,
  `node scripts/validate-docs.mjs`, `git diff --check`, независимый Quality,
  Architecture Review и post-acceptance Wiki review.

## Related material

- [Current connected Recovery freshness decision](./20260918-expose-connected-recovery-freshness-to-coach.md)
- [Automatic day context and optional movement](./20260917-automate-day-context-and-use-optional-daily-movement.md)
- [Garmin recovery through Intervals.icu](./20260912-import-supported-intervals-wellness-as-typed-recovery.md)
- [TASK-0120 plan](../../plans/2026/09/completed/2026-09-19-task-0120-consent-scoped-recovery-freshness.md)
- TASK-0120
