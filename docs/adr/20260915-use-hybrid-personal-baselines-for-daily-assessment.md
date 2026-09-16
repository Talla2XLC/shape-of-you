---
id: "decisions-20260915-use-hybrid-personal-baselines-for-daily-assessment"
kind: adr
title: "Использовать гибридные личные baseline в ежедневной оценке"
status: accepted
date: 2026-09-15
supersedes: []
superseded_by: null
tags:
  - architecture
  - coaching
  - recovery
  - training
  - baselines
  - privacy
---

# Использовать гибридные личные baseline в ежедневной оценке

## Context

TASK-0112 создала детерминированную API-owned `daily-assessment-v1`, а TASK-0113
доставила тот же результат в существующие Coach-чаты. Первая policy применяет
абсолютные safety thresholds, использует простой median минимум из семи
предыдущих HRV/resting-heart-rate значений и не формирует устойчивую личную
норму для сна, Body Battery или тренировочной нагрузки.

История Garmin уже попадает через Intervals.icu в provider-neutral typed
Recovery и Training facts. TASK-0107 отдельно показывает sufficiency профиля,
но её `profile-data-coverage-v1` не является физиологической нормой и не должна
получать новую ответственность.

Личная норма должна быть чувствительнее общего порога, но baseline-only подход
опасен: короткая, дырявая, болезненная или хронически неблагоприятная история
может стать ложной нормой. Выбор одного жёсткого 7/28/90-дневного окна до
ретроспективной проверки также создаёт преждевременную policy-константу.

## Decision

1. Расширить существующий Coaching `daily_next_action` новой policy
   `daily-assessment-v2`. Не создавать новый bounded context, mutable
   `PersonalBaseline` aggregate, микросервис, scheduler, queue или generic
   rules engine.
2. Использовать гибрид: абсолютные safety guardrails и Recovery hard stops
   всегда доминируют; personal baseline только уточняет контекст, когда для
   конкретного metric достаточно качественной истории.
3. Baseline является чистой projection над current Person-owned typed facts до
   target local date. Оцениваемый день не входит в собственный reference set.
   Нет mutable baseline row или фоновой invalidation.
4. Минимум personal baseline — 14 разных completed Person-local days с usable
   evidence для конкретного metric. Training load дополнительно должен
   охватывать не менее трёх календарных недель.
5. История выбирается адаптивно. Immutable typed policy detail хранит
   `minimumEligibleDays`, `targetEligibleDays`, `maximumLookbackDays` и
   `minimumRecentCoverage`. Кроме одобренного minimum 14, production значения
   выбираются только после retrospective dry-run нескольких candidate bundles.
6. Каждый owning module консолидирует не более одного provider-neutral daily
   representative на metric. Дни имеют одинаковый вес независимо от числа
   records. Используются median и MAD; при нулевом или неинформативном MAD
   применяется зафиксированный в policy empirical percentile fallback.
7. Missing days не интерполируются и не становятся нулями. Используются только
   current, non-withdrawn, `person_context`, не `poor`, metric/unit-compatible
   facts. Candidate, eligible и excluded counts сохраняются в calculation
   snapshot.
8. Sleep использует owner-defined основной daily representative. HRV и resting
   heart rate сравниваются только в одинаковой typed metric/unit семантике.
   Body Battery direct point, daily minimum и daily maximum не смешиваются.
   Training baseline использует только явные совместимые `trainingLoad` facts;
   отсутствие activity не считается zero без доказанной day completeness.
   В первом shadow slice `connection_id` служит только opaque conservative
   source-series partition и не доказывает совместимость basis/unit. Production
   v2 требует стабильного typed load-basis/version contract либо не использует
   Training baseline для принятия решения.
9. Trend выводится детерминированно из последовательности последних eligible
   comparisons. Persistence length и severe-deviation threshold принадлежат
   immutable policy. Absolute guardrail может сработать по одному дню.
10. Дни с `acuteIllness`, `injuryConcern` или Recovery hard stop и bounded
    policy-defined recovery buffer исключаются из baseline adaptation, но
    остаются активным safety evidence текущей оценки.
11. Путешествие не угадывается по provider, timezone, значениям или free text.
    Существующий `DailyContextNote` получает typed `contextKind = travel` и
    явное baseline-eligibility значение. LLM не интерпретирует note для
    вычисления policy.
12. Согласованный резкий сдвиг нескольких signals может сделать baseline
    `unstable` и временно остановить адаптацию без диагноза. Если median сам
    находится за абсолютным guardrail, он называется только недавним обычным
    уровнем, не здоровой нормой, и не может разрешить `ready`.
13. Наружу возвращаются qualitative comparisons: `below_usual`,
    `within_usual`, `above_usual`, `baseline_unavailable` или `unstable`.
    Точная арифметика сохраняется в typed calculation snapshot, но API не
    создаёт health/readiness score, диагноз, причинный вывод или ложную
    точность.
14. Immutable DailyAssessment snapshot фиксирует точный policy version,
    selected evidence IDs, daily representatives, exclusions, baseline
    calculation, current comparisons и canonical evidence checksum. Generic
    JSON rules и raw provider payload запрещены.
15. Correction, withdrawal, deletion или late import в использованном lookback
    меняют current evidence set. Следующий read создаёт новый immutable
    snapshot; старый non-erased snapshot сохраняет calculation history.
    Privacy erasure удаляет snapshots, удерживающие erased evidence, по
    существующим ownership contracts.
16. Первый delivery slice — read-only retrospective harness. Он использует
    сохранённые точные v1 status/action как единственную decision base;
    personal overlay может только консервативно ухудшить результат. Дни без
    точного v1 snapshot не получают синтетический status/action и считаются
    несопоставимыми. Harness читает maximum candidate lookback до начала
    report interval для warm-up, но агрегирует только запрошенный диапазон. Он
    не создаёт recommendations/snapshots, не меняет пользовательский результат
    и не активирует policy.
17. Реальный retrospective run требует отдельного разрешения на конкретные
    environment и Person. Values, dates, Person IDs, provider identities и raw
    payload не попадают в stdout, logs, task timeline или chat. Допустим только
    агрегированный de-identified policy report без daily rows.
18. Dry-run измеряет baseline availability, exact-v1-based status/action
    distribution, v1→candidate transitions, несопоставимые дни, day-to-day
    switches, A-B-A flip-flops, severe jumps,
    guardrail overrides, persistent-trend decisions, exclusions и invariant
    violations. Production candidate выбирает оператор отдельным решением.
19. PostgreSQL остаётся authority. Sheets, chat history, provider SDK и LLM не
    участвуют в domain calculation. MCP только представляет точный
    `DailyAssessmentResult` и не заменяет status, reasons или action.

## Considered alternatives

### Только абсолютные thresholds

Самый простой и доступный при короткой истории вариант. Он остаётся fallback и
safety layer, но недостаточно чувствителен к индивидуально значимому изменению.

### Только personal rolling baselines

Хорошо персонализирует сравнение, но может принять хронически неблагоприятное
состояние за норму, не работает при sparse history и слишком зависит от
пропусков, путешествий и поздних импортов. Отклонено.

### Гибрид guardrails и personal baselines

Сохраняет универсальные safety stops и добавляет объяснимую персонализацию
только при достаточных данных. Выбрано.

### Фиксированное окно 7, 28 или 90 дней

Легко тестировать, но заранее смешивает sample sufficiency и календарную
давность. Отклонено в пользу bounded sample-driven selection и versioned
candidate parameters после dry-run.

### Mean и standard deviation

Знакомая статистика, но единичные выбросы заметно сдвигают центр и границы.
Отклонено в пользу median/MAD с percentile fallback.

### Persisted mutable baseline profile

Ускоряет чтение, но добавляет invalidation, correction, erasure, late-import и
concurrency lifecycle. Нет измеренной необходимости; отклонено.

### LLM classification болезней, путешествий и trend

Может понимать free text, но переносит domain authority в недетерминированную
модель и создаёт медицинские/причинные риски. Запрещено.

## Consequences

- `daily-assessment-v1` snapshots остаются читаемыми; retrospective dry-run не
  меняет текущие рекомендации.
- Появятся additive typed contracts и, вероятно, migration для policy detail,
  calculation snapshot и typed DailyContextNote marker.
- Recovery и Training потребуют bounded history read models с owner-defined
  daily consolidation; Coaching не будет читать raw provider payload.
- Недостаточная история чаще даст `baseline_unavailable`, но не ослабит
  absolute safety behavior.
- Late facts могут менять будущие baseline snapshots, что будет явно отражено
  новым checksum вместо скрытого mutable state.
- Query cost зависит от bounded adaptive lookback; query-plan verification
  предшествует любому cache/materialized-view решению.
- Реальная калибровка и production activation становятся отдельным
  operator-controlled gate после privacy-safe агрегированного dry-run.

## Verification

- Pure policy tests: минимум 14, target-day exclusion, missingness, outliers,
  zero MAD, duplicate/order invariance, trend persistence, unstable shifts,
  chronic adverse baseline и guardrail precedence.
- Owner tests: current-only facts, `person_context`, quality, metric/unit
  separation, Body Battery shape, travel/illness exclusions и training-load
  non-zero-imputation.
- PostgreSQL tests: Person isolation, correction, withdrawal, deletion, late
  import, A-B-A, immutable snapshot reuse/history и privacy erasure.
- Contract/MCP tests: qualitative comparison vocabulary, exactly one action,
  exact presentation, backward compatibility и отсутствие prompt-side
  recalculation.
- Dry-run tests: read-only behavior, no domain writes, no raw daily rows,
  privacy-safe report schema, negative stdout/log capture и deterministic
  aggregate output.
- Migration clean/upgrade/idempotency tests и static PostgreSQL identifier
  guard не длиннее 63 UTF-8 bytes.
- Full lint, typecheck, build, tests, `node scripts/validate-docs.mjs`,
  `git diff --check` и `4dt-board validate`.
- Developer, независимый Quality, Architecture Review и post-acceptance Wiki
  выполняются до завершения delivery slice.

## Related material

- [API-owned daily assessment](./20260914-own-daily-assessment-and-next-action-in-api.md)
- [Recovery observations and assessments](./20260731-model-typed-recovery-observations-and-versioned-readiness-assessments.md)
- [Coaching recommendations](./20260731-model-immutable-coaching-recommendations-and-separate-user-decisions.md)
- [Provider-neutral profile coverage](./20260913-show-provider-neutral-profile-data-coverage.md)
- [Typed Intervals wellness import](./20260912-import-supported-intervals-wellness-as-typed-recovery.md)
- [TASK-0115 plan](../../plans/2026/09/2026-09-15-task-0115-personal-baselines.md)
- TASK-0115
