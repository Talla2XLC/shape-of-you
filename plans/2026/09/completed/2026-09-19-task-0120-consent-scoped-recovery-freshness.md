# TASK-0120 — Consent-scoped свежесть и полнота Recovery-доставки

## Статус и разрешение

Выполнено 2026-09-20. Независимый Quality Review и Architecture Review
приняты; затронутые canonical Wiki pages обновлены и проверены. Commit и push
остаются отдельными gates оператора.

Оператор одобрил архитектурное направление consent-scoped delivery ledger
первой командой `go`, а точный [ADR](../../../../docs/adr/20260919-bind-recovery-delivery-to-consent-generation.md)
и этот план — второй командой `го` 2026-09-19. ADR принят и заменяет
`connected-recovery-freshness-v1` как current delivery semantics.

Разрешены локальная реализация, тесты, независимый Quality, Architecture Review
и обновление только затронутых canonical Wiki pages. Commit и push остаются
отдельными gates.

## Пользовательский результат

Сразу после OAuth reconnect Coach видит сохранённые Recovery-значения, но
говорит, что они получены до переподключения и ещё не подтверждены новым
разрешением. Он не выдаёт 2 834 шага на `asOf` за итог 18 сентября.

После обычной фоновой синхронизации тот же факт может быть подтверждён без
дубля, изменённое значение 12 002 становится идемпотентной correction, а
отсутствовавшее поле становится typed absence/withdrawal, но не zero. Если за
19 сентября пришёл только HRV, Coach явно различает подтверждённый HRV и не
доставленные sleep, steps и другие поддерживаемые поля без объяснения причины.

## Выбранная модель

- Stable integration/recovery connection и immutable observation history
  сохраняются между reconnect.
- `consentId` является generation identity для delivery evidence.
- Wellness inbox receipt становится consent-scoped.
- Current provider fact pointer хранит `confirmedConsentId` независимо от
  consent, под которым был первоначально создан observation.
- Одинаковый checksum нового consent подтверждает pointer без нового
  observation; change создаёт correction; absence создаёт или подтверждает
  withdrawal.
- `connected-recovery-freshness-v2` возвращает per-metric delivery states:
  `confirmed_present`, `confirmed_absent`, `retained_unconfirmed`, `unknown`.
- Текущие steps с точным `asOf` имеют `partial_day`; это накопленная нижняя
  граница, а не итог суток.
- Read остаётся локальным и provider-independent. Только существующий worker
  выполняет внешнюю синхронизацию.
- DailyAssessment остаётся единственной decision authority; delivery metadata
  не входит в snapshots и checksums.

## Этапы реализации

1. Расширить contracts closed v2 types: supported metric key, per-metric
   delivery state, observation confirmation semantics, step `periodState` и
   отдельную Coach-safe observation projection. V1 сохранить отдельным readable
   compatibility schema, но не включать в active MCP output schema.
2. Добавить additive Drizzle schema и SQL migration:
   consent identity в wellness inbox receipts, `confirmedConsentId` в current
   Recovery fact pointers, composite foreign keys/uniqueness и индексы. Все
   имена заранее проверить на 63 UTF-8 bytes.
3. Реализовать fail-closed upgrade: не назначать текущий consent существующей
   строке без строгой связи; unprovable rows остаются unconfirmed до следующего
   обычного poll. Не создавать ручной backfill command.
4. Изменить IntegrationStore contracts так, чтобы record, normalize, pointer
   confirmation и completion принимали expected `consentId` и возвращали
   различимый stale-generation outcome вместо неразличимого boolean.
5. Объединить generation fence и mutation path в проверяемую transaction
   boundary. Старый provider response после reconnect не должен оставить даже
   pending/normalized inbox proof или частично изменить pointer/observation.
6. Переработать wellness reconciliation полного whitelist:
   - same checksum + new consent: подтвердить existing pointer;
   - changed checksum: append correction и подтвердить pointer;
   - absent field: append/confirm withdrawal и отметить confirmed absence;
   - same checksum + same consent: no-op.
7. Расширить delivery projection: сравнивать receipt/pointer generation только
   с current connection consent, возвращать полный per-metric state без raw
   provider data, ids, checksums или credentials.
8. Расширить `CurrentRecoveryContextService`: сохранить retained observations,
   связать их с typed confirmation state, детерминированно вывести
   `partial_day`/exact `asOf` для текущих steps и перед возвратом преобразовать
   raw observations в closed Coach-safe DTO без storage/source/correction ids.
9. Обновить MCP schema, exact structured content и instructions: явная фраза
    о retained/unconfirmed после reconnect, честная partial delivery, запрет
    final-total для partial steps, zero-from-absence и causal speculation.
10. Сохранить `get_current_recovery_context` read-only и без provider access.
    Добавить отрицательный тест, что путь не вызывает provider adapter,
    automation или write.
11. Добавить чистые и upgrade migration tests, repository integration/race
    tests, contract/policy/MCP tests и DailyAssessment V1/V2/V3 non-regression.
12. Выполнить full workspace checks и передать frozen diff независимому
    Quality. После acceptance провести Architecture Review по обязательной
    матрице сложности, boundaries, DDD, duplication и simplification.
13. Только после accepted Quality и Architecture Review обновить затронутые
    English canonical Wiki pages и changelog, повторно проверить docs и
    перенести план в `completed/`.
14. Подготовить release plan с точным списком файлов и Conventional Commit.
    Отдельно запросить разрешение на staging/commit, затем отдельно на push.

## Acceptance criteria

1. Новый consent до первой успешной нормализации не наследует ни record-level,
   ни per-metric delivery evidence предыдущего consent.
2. Retained observations остаются доступны, но context маркирует их
   `retained_unconfirmed`; Coach явно сообщает, что свежесть ещё не подтверждена.
3. Same-checksum delivery нового consent создаёт новую delivery receipt и
   подтверждает pointer без нового `RecoveryObservation`.
4. Изменение steps 2 834 → 12 002 создаёт ровно одну immutable correction;
   повторная доставка является no-op.
5. Текущие steps с `asOf` имеют `partial_day` и не могут быть представлены как
   итог, полный результат суток или доказательство низкой активности.
6. HRV-only запись возвращает HRV как `confirmed_present`, а отсутствующие
   sleep, steps и остальные поддерживаемые поля как `confirmed_absent`, без
   zero и без причины.
7. Поле, уже withdrawn предыдущим поколением, подтверждается absent текущим
   consent без дублирующего withdrawal.
8. Ответ старого rolling или historical worker после reconnect не изменяет
   inbox, pointers, observations, sync state или delivery evidence.
9. Aggregate state не скрывает partial delivery и не используется вместо
   per-metric evidence в Coach wording.
10. DailyAssessment V1/V2/V3 snapshots, checksum, status и action не меняются
    только из-за consent/delivery metadata.
11. MCP read сохраняет Person isolation, существующий read scope, empty input и
    не выполняет provider call, write или automation.
12. Raw provider payload, external user id, connection id, consent id,
    checksums, credentials и personal values сверх typed observations не
    появляются в MCP output, logs, docs или reports.
13. Новые database identifiers статически короче или равны 63 UTF-8 bytes.
14. Не создаются новый deployable, queue, scheduler, dependency, one-off env,
    manual backfill или server operation.

## Проверки

- contracts schema/TSDoc and compatibility tests;
- pure v2 delivery-state combination tests;
- PostgreSQL clean migration, every supported prefix upgrade и identifier
  length checks;
- reconnect before-first-sync, same-checksum, correction, withdrawal,
  already-withdrawn, HRV-only и retry-idempotency integration tests;
- crash-cut после create/correct/withdraw observation, но до pointer link, с
  проверкой exact observation-to-receipt correlation в Coach projection;
- held old-consent rolling/historical response race tests;
- current context timezone/Person isolation and steps `partial_day` tests;
- MCP scope, schema, exact structured content, рекурсивные negative pins для
  внутренних identity fields, wording и no-provider-call tests;
- DailyAssessment V1/V2/V3 snapshot/checksum/status/action non-regression;
- full `pnpm test`, targeted PostgreSQL integration suites, `pnpm typecheck`,
  `pnpm lint`, `pnpm build`;
- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- `4dt-board validate`;
- независимый Quality Review;
- отдельный Architecture Review;
- post-acceptance canonical Wiki review.

## Риски и ограничения

- Additive migration увеличивает сложность Integration persistence, но убирает
  недоказуемое наследование freshness.
- Fail-closed upgrade временно покажет часть старых значений как unconfirmed до
  обычного poll; это честнее ложной свежести и не требует provider-on-read.
- Transactional fence может потребовать переноса части orchestration между
  Integration и Recovery repositories. Boundary должен сохранить Recovery как
  владельца observations и не превращать Integration в владельца health facts.
- Полный whitelist в output расширяет contract, поэтому v2 должен быть закрытым
  и versioned, а compatibility tests обязательны.
- `confirmed_absent` доказывает только отсутствие поля в нормализованной записи,
  но не объясняет Garmin/Intervals/watch/user cause.
- `partial_day` не позволяет оценить ожидаемый конец дня; intraday projection
  остаётся вне scope.

## Отдельные operator gates

1. принятие proposed ADR и этого плана, разрешающее implementation start;
2. любые изменения scope/architecture, найденные во время разработки;
3. commit после принятого Quality, Architecture Review и Wiki;
4. push после commit;
5. staging deploy и выполнение migration;
6. authenticated staging Coach verification;
7. production deploy, migration или access.
