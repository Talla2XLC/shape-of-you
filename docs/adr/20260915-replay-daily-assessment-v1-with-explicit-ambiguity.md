---
id: "decisions-20260915-replay-daily-assessment-v1-with-explicit-ambiguity"
kind: adr
title: "Повторять daily-assessment-v1 с явной неоднозначностью исторической программы"
status: accepted
date: 2026-09-15
supersedes: []
superseded_by: null
tags:
  - architecture
  - coaching
  - analytics
  - privacy
  - retrospective
---

# Повторять daily-assessment-v1 с явной неоднозначностью исторической программы

## Context

Первый retrospective dry-run TASK-0115 обнаружил 366 дней provider-neutral
Recovery/Training evidence, но ни одного сохранённого точного
`daily-assessment-v1` snapshot. Поэтому принятый в ADR о гибридных personal
baselines stored-snapshot режим не может измерить переходы v1→candidate,
резкие переключения и A-B-A reversal на уже импортированной истории.

Чистая функция `evaluateDailyAssessment` остаётся точной domain authority v1,
но её исторический input нельзя полностью восстановить как observed-at-time.
В частности, `training_programs.active_version_id` хранит текущее mutable
состояние без журнала активаций. Подстановка текущего состояния во все прошлые
дни создала бы ложную историю решений.

## Decision

1. Сохранить существующий `stored-v1` comparison как самый достоверный режим и
   добавить отдельный versioned режим `counterfactual-current-facts-v1`.
2. Counterfactual режим повторно вызывает неизменённую чистую
   `evaluateDailyAssessment`; отдельная копия правил v1 запрещена.
3. Input каждого target Person-local day строится из current, non-withdrawn,
   non-superseded typed facts с теми же owner-defined semantics, которые
   доступны v1. Факты после target day не участвуют в его recent windows и
   rolling calculations. Результат называется counterfactual и никогда не
   представляется как сохранённая или показанная пользователю рекомендация.
4. Неизвестное историческое состояние TrainingProgram моделируется двумя
   допустимыми ветками одного input: `program_absent` и `program_present`.
   Вторая использует внутренний deterministic sentinel UUID только для запуска
   v1 evaluator; sentinel, UUID и action text не попадают в отчёт.
5. День имеет `comparable` decision envelope только если обе ветки возвращают
   одинаковые `status` и `recommendedAction.type`. Иначе день получает
   `ambiguous_program_state`, не участвует в v1→candidate transitions,
   day-to-day switches, A-B-A reversals или candidate ranking и разрывает
   непрерывность этих последовательностей.
6. Нельзя синтезировать stored snapshot, recommendation, historical
   TrainingProgram ID, evidence ID, provider identity или утверждение о
   displayed history. Counterfactual calculation остаётся process-local.
7. Отчёт раздельно показывает количество stored-v1, counterfactual comparable,
   ambiguous и unavailable дней. Stored и counterfactual evidence не
   объединяются в один неразличимый показатель.
8. Candidate ranking публикуется только при наличии достаточного comparison
   evidence, заданного versioned report policy. В первом bundle minimum — 30
   comparable target days. При меньшем количестве `sensitivityRanking` пуст;
   policy никогда не активируется автоматически.
9. Отсутствие migration с typed `DailyContextNote` columns определяется через
   schema feature detection. В этом случае context exclusion помечается
   unavailable; travel не угадывается по free text, timezone, provider или
   значениям.
10. Reader работает в bounded `REPEATABLE READ READ ONLY` transaction с
    обязательным rollback. Serializer использует фиксированный aggregate-only
    allowlist и fail-closed запрещает dates, raw values, identifiers, provider
    fields и произвольные строки. LLM не участвует в вычислении.
11. Counterfactual replay не пишет recommendations/snapshots, не меняет
    текущую policy и не разрешает production activation. Повторный запуск на
    staging/production требует отдельного разрешения на environment и Person.

## Considered alternatives

### Ждать prospective stored-v1 snapshots

Даёт точную decision history и остаётся эталонным путём, но не позволяет
проверить policy на уже импортированной истории сейчас.

### Подставить текущее или угаданное TrainingProgram state

Просто и даёт больше чисел, но смешивает текущую конфигурацию с прошлым и может
изменить `ready`, `caution` и action. Отклонено как недостоверное.

### Counterfactual envelope из допустимых program-state веток

Не придумывает отсутствующую историю и всё же использует дни, где неизвестное
состояние не влияет на итоговый status/action type. Выбрано.

### Считать неоднозначные дни по худшей ветке

Консервативно для продукта, но искажает аналитическую частоту решений и
переключений. Отклонено; такие дни исключаются из comparison statistics.

## Consequences

- Исторический отчёт сможет отличать отсутствие stored snapshots от
  воспроизводимой counterfactual части истории.
- Часть дней закономерно останется ambiguous, особенно когда нет recovery
  concern, а TrainingProgram определяет action.
- Исправления, withdrawals и late imports могут изменить следующий
  counterfactual report, поэтому report mode/version и counts обязательны.
- Точная историческая выдача остаётся возможной только по immutable stored-v1
  snapshots или будущему журналу program activation; этот ADR такой журнал не
  вводит.
- Архитектура не добавляет сервис, таблицу, scheduler, queue или новый domain
  authority.

## Verification

- Unit tests доказывают вызов общей `evaluateDailyAssessment`, совпадающие и
  расходящиеся program-state ветки и reset continuity на ambiguous gap.
- Reader tests проверяют target-day bounds, current-only typed facts,
  correction/withdrawal semantics, отсутствие future-window leakage и
  feature detection context columns.
- Report tests проверяют отдельные counts, minimum 30 для ranking,
  deterministic aggregates и запрет identifiers/dates/raw values.
- Integration tests проверяют read-only transaction, rollback и отсутствие
  Coaching writes.
- Full lint, typecheck, build, tests, `node scripts/validate-docs.mjs`,
  `git diff --check` и `4dt-board validate`.

## Related material

- [Hybrid personal baselines](./20260915-use-hybrid-personal-baselines-for-daily-assessment.md)
- [API-owned daily assessment](./20260914-own-daily-assessment-and-next-action-in-api.md)
- [TASK-0115 plan](../../plans/2026/09/2026-09-15-task-0115-personal-baselines.md)
- TASK-0115
