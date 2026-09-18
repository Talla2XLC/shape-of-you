# TASK-0119 — Типизированная обратная связь по ежедневной рекомендации

Статус: реализация принята Quality, Architecture Review завершён, canonical
Wiki синхронизирована 2026-09-18.

## Статус и разрешение

Архитектура одобрена оператором командой «го» 2026-09-18 и зафиксирована в
[ADR](../../../../docs/adr/20260918-record-typed-daily-recommendation-feedback.md).
План реализации одобрен оператором второй командой «го» 2026-09-18 перед
первым изменением кода.

После одобрения план разрешает локальную реализацию, migrations только в
изолированных тестовых базах, проверки, Developer → независимый Quality →
Architecture Review и отдельное согласование post-acceptance Wiki. План не
разрешает commit, push, применение migration на staging/production, deploy,
доступ к персональным данным или ручные серверные операции.

## Пользовательский результат

После ежедневной рекомендации пользователь может естественно ответить:
«принял», «сделал», «сегодня пропущу», «оказалось слишком тяжело» или «мне это
не подходит». Coach без повторного вопроса сохраняет типизированную обратную
связь именно к тому immutable daily snapshot, который пользователь видел, и
подтверждает только успешную запись.

Комментарий допустим, например «колено снова беспокоит», но никогда не заменяет
status. Запись не меняет текущую рекомендацию и не запускает самообучение.

## Выбранная модель

- Coaching владеет append-only `DailyRecommendationFeedback` events.
- `snapshotId` ссылается на точный
  `CoachingRecommendation(kind = daily_next_action)` и через него фиксирует
  policy, action, reasons, confidence и evidence checksum.
- Status enum: `accepted`, `completed`, `skipped`, `too_heavy`, `unsuitable`.
- `completed` и `skipped` взаимоисключающие; пригодность может дополнять
  результат, поэтому `completed + too_heavy` допустимо.
- Один status записывается на snapshot не более одного раза.
- `comment` необязателен, непустой и ограничен 1000 символами.
- Идемпотентность действует по `(personId, idempotencyKey)`; конфликтующий
  повтор отклоняется.
- Feedback после expiry допустим; feedback удаляется вместе с snapshot по
  privacy erasure.
- Feedback не входит в DailyAssessment evidence/checksum/policy и не создаёт
  owning-domain факт выполнения.
- MCP использует dedicated scope
  `daily-recommendation-feedback:write`; расширение `person:read` запрещено.

## Затронутые области

- `packages/contracts` — strict request/result/history schemas и exported
  types для feedback.
- `apps/api/src/database/schema.ts` и `apps/api/drizzle/` — typed enum,
  append-only table, FK, indexes и constraints.
- `apps/api/src/storage/` и `apps/api/src/coaching/` — Person-scoped repository,
  транзакционная идемпотентность, service, HTTP create/read-back.
- `apps/api/src/mcp/` и cutover preflight — новый write tool, scope и Coach
  policy.
- `apps/identity/src/oauth/` — resource scope, consent label и новая версия
  predefined client manifest.
- API/Identity/contracts tests — contracts, migrations, concurrency, OAuth,
  MCP и DailyAssessment regression.
- `docs/wiki/` — post-acceptance sync выполнен после принятого Quality и
  отдельного разрешения оператора.

## Этапы реализации

1. Добавить strict contracts `CreateDailyRecommendationFeedback`,
   `DailyRecommendationFeedback` и history/list result. Публичный command
   принимает `snapshotId`, status, optional comment и `idempotencyKey`;
   whitespace-only comment отклоняется.
2. Добавить PostgreSQL enum и таблицу feedback events. Обеспечить составной FK
   к `(recommendation_id, person_id)` daily-assessment detail, actor ownership,
   уникальные `(person_id, idempotency_key)` и
   `(recommendation_id, status)`, а также partial unique constraint для
   disposition `completed | skipped`.
3. Создать additive migration, выполнить clean/upgrade migration tests и
   static проверку имён PostgreSQL до 63 UTF-8 bytes. Не применять migration к
   общей локальной, staging или production базе.
4. Реализовать repository в Coaching. В транзакции заблокировать Person и
   snapshot, проверить точную retry equivalence до insert и переводить
   concurrent unique violations в typed idempotent result либо conflict.
5. Проверять, что snapshot принадлежит текущему Person и является именно daily
   assessment. Expiry не блокирует write. Удалённый/чужой/не-daily snapshot
   возвращает not found без раскрытия его существования.
6. Реализовать application service и HTTP boundary:
   `POST /v1/daily-assessment/:snapshotId/feedback` и Person-scoped read-back
   истории. Create возвращает `201`, exact retry — `200`; история упорядочена
   по `reportedAt`, затем ID.
7. Добавить MCP tool `record_daily_recommendation_feedback`. Tool использует
   exact snapshot ID, выполняет routine write без повторного подтверждения при
   однозначном сообщении и возвращает typed result. При неизвестном текущем
   snapshot Coach сначала вызывает `get_daily_assessment`; неоднозначную старую
   ссылку не угадывает.
8. Добавить `daily-recommendation-feedback:write` в API protected-resource
   metadata, Identity resource scopes, consent label и ChatGPT predefined
   client. Увеличить version manifest и сохранить транзакционную reconciliation
   semantics без env или ручного provisioning.
9. Расширить cutover preflight новым write tool и dedicated scope. Никаких
   staging canary, deployment или manual OAuth операций в локальной реализации
   не выполнять.
10. Добавить tests для exact retry, changed-payload conflict, duplicate status,
    concurrent duplicates, `accepted -> completed`, `completed` против
    `skipped`, `completed + too_heavy`, post-expiry feedback, Person isolation,
    wrong-kind rejection и privacy cascade.
11. Добавить MCP/Identity tests: schema, tool count/catalog, annotations,
    consent copy, scope enforcement, predefined reconciliation и read-only
    denial. Проверить естественное подтверждение без внутренних IDs и полей.
12. Добавить DailyAssessment regression: до и после feedback повторный read
    возвращает тот же snapshot, policy version, evidence checksum, status и
    recommended action при неизменившихся owning facts.
13. Выполнить focused и full checks. Затем без operator gate передать frozen
    diff независимому Quality. После принятого Quality выполнить отдельный
    Architecture Review; перед Wiki writes остановиться для отдельного
    разрешения.

## Acceptance criteria

1. Coach сохраняет только один из утверждённых typed statuses; comment без
   status невозможен.
2. Feedback однозначно связан с конкретным immutable daily snapshot и через
   него — с точной версией политики и действия.
3. Snapshot другого Person, recommendation другого kind и удалённый snapshot
   недоступны без утечки существования.
4. Exact retry с тем же idempotency key и payload возвращает исходное событие;
   изменённый payload конфликтует.
5. Один status нельзя записать для snapshot повторно даже с другим ключом.
6. `completed` и `skipped` не могут сосуществовать; конкурентные попытки не
   обходят ограничение.
7. `accepted -> completed` сохраняет оба события, а `completed + too_heavy`
   сохраняет результат и сигнал пригодности.
8. Post-expiry feedback разрешён; время события отражает момент пользовательского
   сообщения, а не время snapshot.
9. Comment необязателен, ограничен 1000 символами, не логируется и не участвует
   в model-facing assessment output.
10. Privacy erasure связанного daily snapshot каскадно удаляет feedback.
11. Новый MCP write требует только
    `daily-recommendation-feedback:write`; `person:read` token не может писать.
12. Predefined OAuth client получает scope через versioned reconciliation, без
    одноразового env и ручного provisioning.
13. Coach не спрашивает повторное подтверждение однозначной routine feedback,
    не угадывает snapshot и не утверждает успех до typed response.
14. `completed` feedback не создаёт WorkoutSession, Meal, RecoveryObservation,
    TrainingProgram mutation или иной owning-domain факт.
15. Feedback не меняет DailyAssessment snapshot, checksum, baseline, status,
    action или policy version и не запускает автоматическую калибровку.
16. Existing DailyAssessment V1/V2/V3 reads и существующие Coaching decisions
    остаются обратно совместимыми.

## Проверки

- `pnpm --filter @shape-of-you/contracts build`
- `pnpm --filter @shape-of-you/api typecheck`
- `pnpm --filter @shape-of-you/api test:unit`
- `pnpm --filter @shape-of-you/api test:integration`
- `pnpm --filter @shape-of-you/identity typecheck`
- `pnpm --filter @shape-of-you/identity test:unit`
- `pnpm --filter @shape-of-you/identity test:integration`
- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm lint`
- `pnpm build`
- `node scripts/validate-docs.mjs`
- `git diff --check`
- `4dt-board validate`
- независимый Quality и отдельный Architecture Review

## Риски и ограничения

- Свободный comment может содержать чувствительные сведения; поэтому он
  bounded, не логируется, удаляется по lifecycle snapshot и не экспортируется
  аналитически в TASK-0119.
- Append-only history не даёт скрыто исправить ошибочный feedback. Отдельная
  correction/supersession model потребует нового решения; в текущем scope
  повтор с другим значением конфликтует.
- Старые ChatGPT grants не получают новый scope автоматически в уже выданном
  access token. Versioned client reconciliation расширяет allowlist, а consent
  и grant lifecycle остаются в существующем Identity flow.
- Отсутствие self-learning намеренно: даже накопленная история не влияет на
  policy без отдельного ADR, проверки качества и operator approval.

## Отдельные operator gates

После принятой локальной реализации оператор отдельно решает:

1. post-acceptance Wiki writes;
2. commit;
3. push;
4. staging deploy и migration;
5. authenticated staging verification;
6. любой read-only анализ накопленной feedback history;
7. production deploy или будущую калибровку политики.
