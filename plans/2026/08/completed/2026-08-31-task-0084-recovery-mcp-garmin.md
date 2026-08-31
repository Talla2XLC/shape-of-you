# TASK-0084 — Надёжная запись Garmin-сна и Recovery-метрик

Завершено 2026-08-31: реализация, независимый Quality Review, Wiki sync и
Architecture Review прошли с `ACCEPT`.

## Статус и gate

- Оператор одобрил рекомендуемый вариант 2026-08-31.
- Accepted ADR:
  `docs/adr/20260831-model-wearable-sleep-score-and-normalize-recovery-mcp-input.md`.
- Реализация ограничена существующими contracts, API, PostgreSQL и MCP adapter.
- Не разрешены staging/production writes, deployment, secrets, OAuth reconnect,
  Google Sheets actions, commit и push.

## Проблема

Live report с Garmin screenshot не сохранил сон: wearable score `86` был
направлен в субъективное поле `sleepQuality` со шкалой `1..5`. Recovery MCP также
публикует strict internal command с обязательной служебной обвязкой, из-за чего
обычный chat input хрупок. После первого сбоя агент прекратил сохранение
остальных независимых метрик и сообщил пользователю техническую ошибку.

## Цель

Сразу и честно сохранять duration, wearable sleep score, HRV, pulse,
respiration, SpO₂ и temperature из обычного текста/фото как независимые typed
Recovery facts, выполнять set read-back и отвечать как Coach.

## Scope

1. Добавить `sleep_score` в `RecoveryMetric` с unit `score` и range `0..100`.
2. Расширить PostgreSQL enum/check additive migration без новой таблицы.
3. Сохранить `sleepQuality` nullable `1..5` без преобразования wearable score.
4. Добавить connector Recovery schemas и normalization для create/correct.
5. Поддержать concise exact-local-date commands с default manual provenance,
   nullable ownership и safe quality.
6. Закрепить независимую обработку всех однозначных observations и set
   read-back по `localDate`.
7. Добавить Recovery result presentation без raw DTO и technical vocabulary.
8. Покрыть reported Garmin fixture и invalid combinations.
9. Выполнить независимые Quality и Architecture Reviews.

## Out of scope

- Garmin API/connection, OAuth client или background sync;
- batch screenshot aggregate/tool;
- raw image/media persistence или generic JSON facts;
- изменение readiness policy на основании нового score;
- новый сервис, database, chat UI или Google Sheets fallback;
- live staging E2E и deployment без отдельного approval.

## Acceptance criteria

1. `sleep_score = 86`, unit `score` проходит contract, domain и PostgreSQL path.
2. `sleep_score` вне `0..100` или с другой unit отклоняется.
3. `sleepQuality` остаётся `1..5|null`; score туда не нормализуется.
4. Concise Recovery MCP input не требует source/ownership/null bookkeeping и
   нормализуется в валидный strict command с manual provenance.
5. Date-only report сохраняет exact `localDate` без invented interval.
6. Reported Garmin fixture создаёт независимые sleep, sleep score, HRV, night
   pulse, respiration, SpO₂ и temperature observations с deterministic keys.
7. Сбой одного observation не блокирует попытки сохранить остальные; read-back
   сверяет весь expected set.
8. Routine reply не содержит raw JSON, tool/schema/API/contract vocabulary и
   даёт краткое evidence-grounded Coach observation/next step.
9. Tool count, scopes, PostgreSQL authority, append-only corrections и no-Sheets
   fallback не меняются.
10. Migration prefixes, full tests, static checks, docs validation, Quality и
    Architecture Reviews проходят.

## Implementation stages

### 1. Typed contract и storage

- расширить RecoveryMetric schema/type и unit invariants;
- обновить database enum/check и repository tests;
- сгенерировать additive migration и проверить identifier length.

### 2. MCP connector boundary

- создать connector Recovery schema для create/correct;
- normalizer дополняет только безопасную служебную обвязку и повторно запускает
  strict validator;
- уточнить tool descriptions и operational set-capture/read-back instructions;
- добавить Recovery-specific model-facing result presentation и retry wording.

### 3. Verification

- contract/domain/repository/MCP fixtures для точного live report;
- focused и full API tests, migration chain, typecheck, lint, build;
- docs validator и diff checks;
- independent Quality Review, Wiki alignment и Architecture Review.

## Риски и stop conditions

- Если connector normalization требует invented timestamp или device consent,
  использовать exact local-date/manual path; не выдумывать device provenance.
- Если новое значение требует изменение readiness policy, это отдельная задача.
- Если понадобится batch tool или новый persistence boundary, вернуться в
  analytic за отдельным архитектурным решением.
- Deployment, staging writes, commit и push остаются отдельными gates.
