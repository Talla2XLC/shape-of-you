# TASK-0117 — Zero-friction day context и необязательные шаги

## Статус и разрешение

Архитектура и план одобрены оператором командами «го» 2026-09-17 и зафиксированы
в [ADR](../../../../docs/adr/20260917-automate-day-context-and-use-optional-daily-movement.md).
Локальная реализация завершена 2026-09-18 и принята независимыми Quality и
Architecture Review; canonical Wiki обновлена.

План после одобрения разрешает локальную реализацию, тесты, Developer →
независимый Quality → Architecture Review → Wiki. Он не разрешает commit, push,
staging/production data access, backfill, deploy, migration execution вне
локальных тестовых баз или release actions.

## Пользовательский результат

Пользователь спрашивает: «Как я сегодня? Стоит ли тренироваться?» — и получает
один API-owned ответ без требования вручную вводить timezone. Если свежие steps
доступны, ответ может сказать, что пользователь уже набрал необычно большой для
себя дневной объём движения, и учесть это в рекомендации на остаток дня вместе
с Recovery/Training facts.

Пример: «Восстановление сегодня нормальное, но ты уже прошёл заметно больше
своего обычного полного дня. С учётом повышенной тренировочной нагрузки сегодня
лучше не добавлять тяжёлую сессию». Одни только steps не могут отменить
тренировку. Низкое неполное число шагов не означает, что пользователь двигался
мало.

## Выбранная модель

- Web автоматически сохраняет browser IANA timezone только когда Person
  timezone ещё не задан.
- Coach получает `set_current_timezone` с отдельным
  `person-timezone:write`; после записи повторяет `get_daily_assessment`.
- `steps/count` импортируются как provider-neutral typed
  `RecoveryObservation`; provider mapping остаётся в Intervals adapter.
- Завершённые дни используют balanced baseline: минимум 14 eligible days,
  target 28, maximum lookback 84, median/MAD и percentile fallback.
- Сегодняшние steps — `partial_day` evidence с exact `asOf`. Оно допустимо,
  когда timestamp относится к target local day и не опережает calculation более
  чем на пять минут; внутри дня максимальный возраст не нужен, потому что count
  является монотонной нижней границей уже накопленного движения.
- Missing steps не блокируют, не уменьшают confidence и не запрашиваются у
  пользователя.
- V3 сохраняет точный policy/evidence trace; V1/V2 остаются readable.
- Safety guardrails доминируют; provider-specific logic и LLM authority
  запрещены.

## Этапы реализации

1. Расширить provider-neutral Recovery contracts и persistence metric
   `steps/count`; добавить additive migration и static check PostgreSQL names.
2. Добавить `steps` в Intervals wellness fields и normalizer, сохранив provider
   `updated/asOf`; поддержать absent, correction, withdrawal, late import и
   erasure теми же owner-owned путями, что и другие typed observations.
3. Расширить Daily Assessment strict contracts до discriminated V1/V2/V3:
   completed/partial evidence role, `asOf`, freshness, movement comparison,
   reasons и calculation snapshot. Сохранить old snapshot hydration.
4. Добавить steps в одну общую balanced baseline implementation. Completed
   eligible days участвуют в history; partial current day никогда не обучает
   full-day baseline.
5. Реализовать pure V3 overlay: допустимый partial count выше robust upper
   full-day bound может стать supporting high-movement signal; partial count
   ниже bound не становится low-movement signal; steps alone не меняют
   status/action. Проверка времени использует target local date и future-skew
   tolerance пять минут, а explanation сохраняет exact `asOf`.
6. Собрать authoritative V3 в `DailyAssessmentService`, checksum и immutable
   repository path с существующим Person-scoped final fence. Без steps outcome
   должен быть V2-equivalent.
7. Реализовать unset-only browser timezone bootstrap через существующий
   preferences HTTP endpoint; проверить IANA validation, DST, retry и отсутствие
   write loop.
8. Добавить Identity scope `person-timezone:write`, consent copy и
   least-privilege predefined-client policy. Добавить MCP tool
   `set_current_timezone`, который пишет только timezone и возвращает typed
   result; после него Coach обязан повторить assessment read.
9. Обновить Coach instructions: не показывать технический setup в нормальном
   пути, не угадывать неоднозначный timezone, не строить fallback recommendation
   и не добавлять собственную интерпретацию steps.
10. Расширить retrospective harness сравнением V2/V3. В dry-run оставить
    `writesPerformed=false` и выводить только aggregate coverage, status/action
    differences, transitions, A-B-A flips, suspicious escalations и invariant
    violations без дат, IDs, raw values и provider fields.
11. Выполнить локальные focused и full checks, затем передать frozen diff
    независимому Quality без паузы. После Quality acceptance провести отдельный
    Architecture Review и только затем обновить затронутые current-state Wiki
    pages на английском.

## Acceptance criteria

1. Обычный authenticated Web path автоматически устанавливает валидный IANA
   timezone при его отсутствии и затем получает assessment без ручной настройки.
2. Явная conversational correction использует только
   `person-timezone:write`; read-only token не может изменить timezone, а tool
   не может менять другие Person preferences.
3. После unavailable/timezone result Coach не создаёт собственную рекомендацию.
4. Intervals steps импортируются как typed provider-neutral observations с
   точным `asOf`; отсутствующее поле не создаёт zero observation.
5. Missing или sparse steps не блокируют assessment, не уменьшают confidence и
   не появляются в `missingImportantData`.
6. Completed-day steps используют balanced robust baseline; excluded/poor days
   и current partial day не обучают его.
7. Свежий partial count может доказать только уже высокий accumulated movement;
   он не может доказать низкую активность или поддержать move-more advice.
8. Steps alone не меняют status/action. Более консервативный outcome возможен
   только при corroborating adverse Recovery/Training evidence.
9. Новые snapshots имеют `policyVersion = daily-assessment-v3`, exact
   policy/evidence/checksum trace; сохранённые V1/V2 snapshots читаются без
   переписывания.
10. Correction, withdrawal, deletion, late import и erasure воспроизводимо
    меняют current checksum/result и не нарушают Person isolation.
11. Объяснение говорит о наблюдаемом сравнении с личной нормой без diagnosis,
    причинности, score, ложной точности или provider-specific wording.
12. Retrospective dry-run ничего не записывает и не выводит PII, даты, IDs, raw
    metrics или provider data.

## Проверки

- Recovery contract/domain/storage and migration tests;
- Intervals provider and import lifecycle fixtures;
- personal baseline and V3 pure policy tables;
- DailyAssessment PostgreSQL integration: idempotency, concurrency, corrections,
  withdrawals, late facts, deletion, erasure and old snapshot hydration;
- Identity OAuth scope/consent tests and MCP authorization/tool-result tests;
- Web timezone bootstrap tests, API/MCP/Coach end-to-end contract tests;
- privacy-safe retrospective command unit/integration tests;
- full workspace tests, typecheck, lint and build;
- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- `4dt-board validate`;
- независимый Quality, Architecture Review и post-acceptance Wiki.

## Риски и ограничения

- Browser timezone может быть устаревшим после поездки; автоматическая запись
  ограничена unset state, а явная коррекция остаётся доступна в разговоре.
- Новый OAuth scope потребует обновления predefined client manifest и повторного
  consent/grant поведения; widening существующего `person:read` запрещён.
- Full-day steps не позволяют честно строить expected intraday curve; такая
  логика вне scope.
- Steps одновременно отражают бытовое движение и часть тренировочной нагрузки,
  поэтому corroboration и отсутствие самостоятельного downgrade обязательны.
- Реальная стабильность V3 неизвестна до отдельно разрешённого staging backfill
  и retrospective dry-run; production activation до этого запрещена.

## Отдельные operator gates

После принятой локальной реализации оператор отдельно решает:

1. commit;
2. push;
3. staging deploy и migration;
4. staging backfill/import refresh;
5. read-only retrospective dry-run по персональной истории;
6. authenticated real Coach verification;
7. любой production deploy или activation.
