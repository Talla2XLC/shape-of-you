# TASK-0112 — API-owned ежедневная оценка и объяснимое следующее действие

## Статус

Завершено 2026-09-14. Архитектура и план были одобрены оператором сообщением
«го»; Developer выполнил реализацию и один разрешённый rework, независимый
Quality принял все критерии, Architecture Review не выявил необходимости менять
решение, а затронутые canonical Wiki pages синхронизированы. Принят ADR
`20260914-own-daily-assessment-and-next-action-in-api`. Commit, push и deploy не
выполнялись.

## Цель

Перенести основную ежедневную оценку из MCP-промптов в существующий API.
Shape of You должен детерминированно собрать актуальные Person-owned typed
facts, вернуть безопасный статус дня и ровно одно объяснимое следующее действие,
а ChatGPT — только представить результат и поддержать разговор.

## Предлагаемое решение

1. Расширить существующий `CoachingRecommendation` новым типизированным kind
   `daily_next_action`, а не создавать параллельный `DailyPlan` или generic
   rules engine.
2. Оставить Recovery владельцем физиологической readiness/load-risk оценки и
   hard stops; Training — владельцем `TrainingProgram`, `WorkoutSession` и
   `ExternalActivityFact`; Coaching — владельцем cross-domain выбора следующего
   действия.
3. Создавать immutable versioned snapshot лениво при чтении. API собирает
   current facts, вычисляет канонический evidence checksum и переиспользует
   snapshot для одинаковых Person, local date, timezone, policy version и
   evidence. Изменившиеся или исправленные facts дают новый checksum и новый
   current result; старый snapshot остаётся audit history.
4. Добавить Person-owned IANA timezone как минимальную настройку. Пока она не
   задана, возвращать типизированный stop state `timezone_required`, а не
   угадывать timezone из чата, браузера или provider payload.
5. Добавить один read-only MCP tool `get_daily_assessment` под существующим read
   scope. MCP не получает нового write scope и не может менять policy,
   `TrainingProgram`, Recovery facts или recommendation result.

## Альтернативы

- Только MCP-промпты: дешевле сейчас, но результат зависит от модели, контекста
  чата и порядка tool calls; детерминизм и единая policy не гарантируются.
- LLM внутри backend: централизует вызов, но добавляет недетерминизм, стоимость,
  dependency и фактически второй conversation layer.
- Детерминированная API-owned policy: требует typed contract, policy tests и
  аккуратной evidence model, зато даёт одинаковый результат, объяснимость,
  auditability и provider/client portability. Это рекомендуемый фундамент.
- Pure compute-on-read без хранения: проще и автоматически свежий, но не даёт
  точной audit history. Может быть fallback, если оператор отклонит snapshots.

## Доменная модель

- `DailyAssessmentPolicyVersion` — immutable typed detail существующей Coaching
  policy infrastructure; содержит только явные пороги, окна, precedence и
  action-selection rules, без JSON и env-настроек.
- `CoachingRecommendation(kind = daily_next_action)` — Person-owned immutable
  snapshot с `localDate`, timezone, safe day status, confidence, policy version,
  evidence checksum, reasons, limitations и expiration/current semantics.
- Typed evidence links — Recovery assessment/observations, active
  TrainingProgramVersion, WorkoutSession, ExternalActivityFact, current Meal
  facts/daily totals, WeightMeasurement и profile coverage policy result.
- `DailyNextAction` — closed union. Training action может ссылаться только на
  active TrainingProgramVersion или существующую точную
  `training_adjustment` recommendation; произвольные workout/exercise/load
  запрещены.
- `DailyAssessmentResult` — strict read projection: status, used facts, missing
  important data, reasons, one recommended action, bounded alternatives,
  limitations, confidence, policy version и evidence checksum.

## Безопасная policy первого этапа

1. `acute_illness`, `injury_concern` и Recovery hard stop всегда доминируют.
2. High recovery/load risk вместе с недавней высокой нагрузкой запрещает
   progression и интенсивную рекомендацию.
3. Комбинация короткого сна с неблагоприятным отклонением HRV и/или resting
   heart rate от Person baseline приводит к консервативному статусу.
4. Низкий Body Battery учитывается только вместе с другими сигналами; daily
   minimum/maximum не выдаются за current reading.
5. Missing, stale или poor-quality evidence снижает confidence и может сделать
   единственным действием сбор одного наиболее важного наблюдения.
6. Partial Nutrition не превращается в вывод о голодании или полноте рациона;
   один вес не создаёт диагноз или причинный вывод.
7. При active `TrainingProgram` policy не создаёт несовместимую тренировку.
   При отсутствии программы она может рекомендовать подтвердить программу, но
   не называет сгенерированный план `Planned`.

## Объём

1. Зафиксировать новый ADR на русском после выбора архитектуры.
2. Добавить strict contracts и pure deterministic policy.
3. Расширить Coaching policy/recommendation persistence и typed evidence.
4. Добавить минимальную Person-owned timezone persistence и безопасный unset
   lifecycle, если этот вариант одобрен.
5. Добавить bounded module-owned reads для Recovery, Training, Nutrition,
   Weight и TASK-0107 coverage без provider JSON и per-fact fan-out.
6. Реализовать snapshot reuse/current selection и correction/withdrawal/erasure
   semantics.
7. Добавить authenticated API read и read-only MCP projection.
8. Обновить Daily Coach instruction contract: читать готовую оценку и не
   пересчитывать status/action на стороне LLM.
9. Покрыть policy, persistence, API и MCP независимыми tests.
10. После Developer выполнить независимый Quality, Architecture Review и лишь
    затем обновить затронутые current-state Wiki pages.

## Не входит

- новый микросервис, database, queue, scheduler или background recalculation;
- LLM/provider SDK в API;
- raw provider JSON или generic polymorphic evidence;
- автоматическое изменение `TrainingProgram` или запись выполненной тренировки;
- медицинский диагноз, health score или ложная числовая точность;
- новый MCP write scope;
- новые env-переменные;
- commit, push, deploy, staging/production migration или secret access.

## Порядок реализации после одобрения

1. Создать и принять ADR с выбранными snapshot и timezone contracts.
2. Зафиксировать vocabulary статусов, reason codes, limitations и closed action
   union; согласовать policy v1 thresholds и precedence.
3. Реализовать pure evaluator и canonical evidence serialization/checksum.
4. Расширить Person/Coaching schema и сгенерировать одну additive migration;
   проверить все PostgreSQL identifiers на максимум 63 UTF-8 bytes.
5. Реализовать constant-number module reads и typed evidence composition.
6. Реализовать idempotent lazy snapshot materialization и current lookup без
   mutable invalidation flag.
7. Добавить strict HTTP/MCP contracts и существующий read authorization scope.
8. Изменить Daily Coach presentation policy так, чтобы ChatGPT объяснял, но не
   заменял API status/action.
9. Выполнить Developer checks и оформить handoff в независимый Quality.
10. После Quality acceptance выполнить Architecture Review по пяти обязательным
    критериям, затем с отдельным разрешением обновить Wiki.

## Критерии приёмки

1. Одинаковые current typed facts, Person-local context и policy version дают
   одинаковый status, reasons, confidence и action.
2. Поздний или исправленный Recovery, Training, Nutrition или Weight fact
   меняет current evidence checksum и результат без ручной invalidation.
3. Result явно содержит used facts, missing important data, reasons, ровно одно
   action, bounded alternatives, limitations, confidence и policy version.
4. Missing data никогда не заменяются нулём или придуманным фактом.
5. Hard stops и опасные комбинации всегда дают консервативный результат.
6. Training action не противоречит active TrainingProgram и не создаёт новую
   программу/тренировку; absent program остаётся typed absence.
7. Sleep, HRV, resting heart rate, Body Battery, recent training, active
   TrainingProgram, weight и nutrition участвуют как typed evidence или явно
   перечисляются среди missing/limited inputs.
8. Person timezone и local date проверяются сервером; DST и смена local date
   покрыты tests.
9. MCP получает result только через read tool и существующий read scope; write
   scopes, credentials и provider payload не расширяются.
10. PostgreSQL остаётся authority; no-Sheets fallback и prompt-side
    reconstruction запрещены.
11. Contract/API/unit/PostgreSQL/MCP tests, migration chain, identifier guard,
    docs validator и `git diff --check` проходят.
12. Независимый Quality и Architecture Review принимают каждый критерий до Wiki
    update и завершения задачи.

## Проверки

- contracts build/typecheck/schema tests;
- pure policy table tests на precedence, confidence и deterministic output;
- PostgreSQL integration tests на Person isolation, snapshot idempotency,
  late facts, A-B-A corrections, withdrawals, active program version changes и
  erasure visibility;
- timezone/DST и local-date boundary tests;
- MCP tool schema, read authorization, fail-closed и presentation tests;
- full API lint, typecheck, build, unit и integration suites;
- migration clean/upgrade/idempotency и PostgreSQL 63-byte identifier guard;
- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- `4dt-board validate`.

## Approval gates

- Alternative C, snapshot contract, timezone authority, safe status/action
  vocabulary, новый ADR и этот план одобрены сообщением «го» 2026-09-14.
- После одобрения разрешён только локальный Developer → независимый Quality →
  Architecture Review цикл в основном рабочем дереве.
- Wiki writes после Quality требуют отдельного подтверждения, если оператор не
  включит их явно в одобрение плана.
- Commit, staging, push, deploy, migration application, production и secrets
  всегда требуют отдельных разрешений.
