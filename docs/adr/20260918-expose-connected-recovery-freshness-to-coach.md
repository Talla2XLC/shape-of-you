---
id: "decisions-20260918-expose-connected-recovery-freshness-to-coach"
kind: adr
title: "Передавать Coach проверяемое состояние свежести подключённых Recovery-данных"
status: accepted
date: 2026-09-18
supersedes: []
superseded_by: null
tags:
  - architecture
  - coaching
  - recovery
  - integrations
  - mcp
---

# Передавать Coach проверяемое состояние свежести подключённых Recovery-данных

## Context

После развёртывания `daily-assessment-v3` staging подтвердил успешную работу
rolling Intervals.icu sync и импорт шагов. При этом Intervals доставил
нормализованную wellness-запись за текущий Person-local день без поддерживаемых
Recovery-значений. `list_recovery_observations` корректно вернул пустой набор,
но Coach интерпретировал его как «Garmin вообще не синхронизировался» и пообещал
самостоятельно проверить данные позже.

Обе формулировки недоказуемы. Пустой набор текущих фактов не различает успешную
синхронизацию с пустой provider-записью, отсутствие записи за день, устаревшую
синхронизацию, provider failure, disconnected connection и недоступное
состояние. Обычный чат также не выполняет фоновую работу после завершения хода,
если отдельная automation не была создана.

`Integration` уже владеет connection lifecycle, последними попытками sync и
нормализованным inbox. `Recovery` владеет typed observations. Ни один из этих
контекстов по отдельности не должен выдумывать причину отсутствия фактов, а LLM
не должна становиться authority для их сопоставления. `DailyAssessment`
snapshots воспроизводят решение по фактам и не должны изменяться при каждом
успешном пустом polling cycle.

## Decision

1. Добавить в API application layer provider-neutral read composition
   `ConnectedRecoveryContext`. Она объединяет current Recovery observations за
   один Person-local день с безопасным состоянием доставки подключённых данных,
   не меняя ownership исходных таблиц и фактов.
2. `Integration` предоставляет композиции только безопасную проекцию последней
   попытки и нормализованной доставки за target local date. Credentials, raw
   payload, external user id, connection id, checksums и provider response не
   покидают Integration boundary.
3. Состояние имеет две независимые оси вместо одного двусмысленного enum:
   `syncState` (`fresh_success`, `stale_success`, `failed`, `never_checked`,
   `not_connected`, `unavailable`) и `targetDateDelivery`
   (`supported_facts_present`, `record_without_supported_facts`, `unknown`).
   Текущие observations остаются единственным доказательством
   конкретных значений и доступных metrics.
   Без persisted exact request bounds отсутствие target-date записи всегда
   остаётся `unknown`: timestamp завершения не доказывает фактический window.
   Полученная target-date запись является прямым доказательством доставки.
4. Freshness вычисляется детерминированной versioned policy
   `connected-recovery-freshness-v1`. Для текущего rolling interval пять минут
   успешная попытка считается fresh не более 15 минут. Порог хранится как
   policy parameter и покрывается boundary tests; LLM не сравнивает timestamps
   самостоятельно.
5. Опубликовать один read-only MCP tool `get_current_recovery_context`, который
   без аргументов использует сохранённый Person timezone, определяет текущий
   local date и возвращает typed observations вместе с двумя осями состояния.
   Исторические и write read-back сценарии продолжают использовать
   `list_recovery_observations`; новый tool не принимает provider, connection,
   person id или произвольный timezone.
6. Focused вопросы о сегодняшнем сне, HRV, пульсе покоя, Body Battery или шагах
   используют `get_current_recovery_context`. Full Daily Coach по-прежнему
   начинает с `get_daily_assessment`; если assessment сообщает отсутствующие
   Recovery evidence и ответ должен объяснить свежесть, Coach дополнительно
   читает новый context. Он не изменяет status/action и не становится второй
   decision authority.
7. Immutable `DailyAssessment` V1/V2/V3 snapshots, checksum и policy decision
   не включают volatile sync metadata. Поэтому пустой polling cycle не создаёт
   новый assessment и старые оценки остаются воспроизводимыми.
8. MCP instructions задают проверяемые формулировки:
   - fresh success + empty record: «синхронизация прошла, но источник пока не
     передал поддерживаемые показатели за сегодня»;
   - unknown delivery: «доставка данных за сегодня пока не подтверждена», без
     утверждения, что успешная попытка охватывала эту дату;
   - failed: «последняя синхронизация не удалась; актуальные данные неизвестны»;
   - stale/never checked: не утверждать ни успех, ни отсутствие данных;
   - observations present: сообщать только реально присутствующие показатели.
9. Coach не называет причиной Garmin, Intervals, часы, сон, поездку или действие
   пользователя, если typed state этого не доказывает. Отсутствие поля не
   превращается в zero и не влияет на медицинские или причинные выводы.
10. Coach не обещает «сам проверить позже» без реально созданной automation.
    Допустимо сказать, что данные будут проверены при следующем запросе
    пользователя. Новый read не создаёт automation и не инициирует background
    work.
11. Вопрос пользователя не запускает синхронный provider refresh. Rolling
    worker продолжает bounded polling; это сохраняет предсказуемую latency,
    rate limits и отсутствие внешнего side effect у read-only MCP tool.
12. Provider name может появиться только как factual presentation label уже
    подключённого источника. State machine, freshness policy, Coaching decision
    и Recovery domain не содержат provider-specific branches.

## Considered alternatives

### Исправить только prompt и запретить фразу «не синхронизировался»

Уменьшает риск конкретной формулировки, но пустой Recovery list всё равно не
содержит доказательства причины. LLM будет выбирать между несколькими
неразличимыми состояниями. Отклонено как косметическое и невоспроизводимое.

### Передать Coach существующий provider-specific connection status

Почти не требует новой модели, но connection status не доказывает наличие
записи за target date и протаскивает Intervals-specific orchestration в Coach.
Он всё равно не различит пустую нормализованную запись и отсутствие записи.

### Запускать принудительный Intervals refresh при каждом вопросе

Даёт максимально свежую попытку, но превращает read в внешний side effect,
увеличивает latency, создаёт burst/rate-limit риск и не исправляет ситуацию,
когда upstream уже вернул пустую запись. Отклонено.

### Добавить sync metadata прямо в DailyAssessment snapshot

Дало бы один tool call для full Daily Coach, но volatile polling metadata не
участвует в решении и заставляла бы создавать новые immutable snapshots без
изменения health evidence. Отклонено ради воспроизводимости и разделения
decision от delivery diagnostics.

### Добавить provider-neutral Recovery context поверх существующих owners

Выбранный вариант. Он даёт Coach одно проверяемое чтение для focused сценария,
сохраняет Integration и Recovery ownership, не меняет DailyAssessment authority
и не создаёт новый deployable или database aggregate.

## Consequences

- Пользователь получает честное различие «синхронизация прошла, но поля пока
  пусты» вместо недоказуемого «Garmin не синхронизировался».
- MCP surface получает один additive read-only tool и provider-neutral schema.
- API application layer получает небольшую cross-context composition; новый
  bounded context, service deployment, queue, scheduler и migration не нужны.
- Integration repository получает read-only target-date delivery projection.
  Existing inbox и fact pointers остаются authority; raw provider data не
  сохраняются и не возвращаются.
- Freshness threshold становится явной versioned presentation policy. Его
  изменение требует новой policy version, но не переписывает DailyAssessment.
- Если upstream присылает пустые поля, система честно сообщает ограничение, но
  не может определить техническую или пользовательскую причину.

## Verification

- Pure policy tests покрывают все комбинации sync state, age boundary и
  target-date delivery, включая ровно 15 минут и clock skew.
- Integration repository tests различают populated record, normalized empty
  record, absent record, failed attempt, stale success, disconnect и consent
  replacement без возврата identifiers или raw payload.
- MCP contract tests проверяют read-only scope, empty input, Person isolation,
  stored-timezone local date и exact structured result.
- Coach instruction tests запрещают unsupported provider attribution,
  background-recheck promise и самостоятельное сравнение timestamps.
- DailyAssessment regression tests доказывают неизменность V1/V2/V3 checksum и
  snapshots при изменении только sync metadata.
- Staging verification использует только агрегированные состояния и обычный
  пользовательский путь; personal metric values не попадают в логи или отчёт.
- Выполняются full tests, typecheck, lint, build, docs validation, независимый
  Quality, Architecture Review и post-acceptance Wiki.

## Related material

- [Automatic day context and optional movement](./20260917-automate-day-context-and-use-optional-daily-movement.md)
- [API-owned daily assessment](./20260914-own-daily-assessment-and-next-action-in-api.md)
- [Garmin recovery through Intervals.icu](./20260912-import-supported-intervals-wellness-as-typed-recovery.md)
- [TASK-0118 plan](../../plans/2026/09/completed/2026-09-18-task-0118-connected-recovery-freshness.md)
- TASK-0118
