---
id: "decisions-20260917-automate-day-context-and-use-optional-daily-movement"
kind: adr
title: "Автоматизировать контекст дня и учитывать необязательную ежедневную активность"
status: accepted
date: 2026-09-17
supersedes: []
superseded_by: null
tags:
  - architecture
  - coaching
  - recovery
  - baselines
  - timezones
  - integrations
---

# Автоматизировать контекст дня и учитывать необязательную ежедневную активность

## Context

`daily-assessment-v2` детерминированно объединяет абсолютные safety guardrails и
personal baselines. Однако обычный вопрос в Coach может завершиться техническим
ответом `timezone_required`, если Person timezone ещё не сохранён. После такого
ответа LLM не имеет права самостоятельно собирать рекомендацию из отдельных
метрик, поэтому безопасная архитектура сейчас выглядит для пользователя как
лишняя настройка и недоступный сервис.

Intervals.icu уже является источником импортированной Garmin history, но текущий
adapter не запрашивает и не нормализует доступное поле `steps`. Поэтому API не
может объяснить, что пользователь уже много двигался сегодня, или учесть его
обычный дневной объём движения. Шаги при этом доступны не у всех пользователей и
не должны становиться новой обязательной предпосылкой.

Нужно сохранить API-owned authority, provider-neutral domain и
воспроизводимость snapshots, одновременно убрав техническую настройку из
обычного разговора. Решение уточняет timezone-пункт ADR об API-owned daily
assessment, но не заменяет остальные решения этого ADR.

## Decision

1. `Person` timezone остаётся IANA-идентификатором и частью детерминированного
   контекста дня, но нормальный пользовательский путь не требует ручного ввода
   технического значения. Authenticated Web при отсутствии сохранённого
   значения получает timezone из browser API и сохраняет его через существующий
   Person preferences boundary до первого daily assessment.
2. Явная коррекция timezone из Coach разрешена отдельным MCP tool
   `set_current_timezone` с минимальным OAuth scope `person-timezone:write`.
   Tool принимает только валидный IANA timezone и не даёт произвольной записи
   Person preferences. Он вызывается только из явного пользовательского
   контекста о текущем местоположении/timezone; неоднозначность требует одного
   естественного уточнения. LLM не угадывает timezone молча.
3. `get_daily_assessment` остаётся единственной authority для daily status и
   действия. После успешной установки timezone Coach повторяет read в том же
   разговорном ходе. Если timezone всё ещё неизвестен, Coach не строит fallback
   recommendation из raw facts.
4. Добавить provider-neutral typed metric `steps` с unit `count` в существующую
   модель `RecoveryObservation`. Не создавать новый aggregate, bounded context,
   service или generic activity engine. Intervals-specific поле и mapping
   остаются только в integration adapter.
5. Шаги являются необязательным supporting signal. Их отсутствие или sparse
   history не блокируют assessment, не уменьшают confidence, не попадают в
   `missingImportantData` и не требуют ручного ввода. Универсальный порог вроде
   10 000 шагов запрещён.
6. Завершённые Person-local дни формируют full-day baseline. Используется
   существующий `balanced` sample-driven policy: минимум 14 eligible days,
   target 28 и bounded lookback до 84 дней. Сравнение использует median и MAD,
   а при нулевом MAD — percentile fallback. Болезнь, recovery buffer, travel,
   poor quality и другие уже типизированные exclusions не обучают baseline.
7. Сегодняшний count хранится и вычисляется как `partial_day` evidence с точным
   `asOf`, freshness и признаком неполного дня. Evidence допустимо, только если
   `asOf` присутствует, относится к target Person-local date и не находится
   более чем на пять минут в будущем относительно `calculatedAt`. Максимальный
   возраст внутри того же дня не вводится: монотонный count остаётся истинной
   нижней границей, а объяснение сохраняет точное `asOf`. Превышение верхней
   границы обычного полного дня уже доказывает высокий накопленный movement.
   Значение ниже этой границы не доказывает низкую активность и не создаёт совет
   «больше двигаться».
8. Сравнение «обычно к этому времени» запрещено без реальных исторических
   intraday snapshots. Оно не выводится из full-day totals и откладывается до
   появления отдельного доказанного источника таких данных.
9. Steps alone могут дать только нейтральное объяснение контекста. Они не могут
   сделать status строже, назначить recovery или отменить тренировку без
   corroborating adverse Recovery либо Training evidence. Absolute safety
   guardrails и hard stops продолжают доминировать.
10. Новые результаты создаются как immutable `daily-assessment-v3` snapshots.
    V3 сохраняет exact baseline policy parameters, completed/partial evidence
    role, observation IDs, `asOf`, freshness decision, qualitative comparison,
    exclusions, reasons и checksum inputs. V1 и V2 snapshots остаются
    читаемыми.
11. Correction, withdrawal, deletion, late import и privacy erasure изменяют
    current evidence и canonical checksum. Следующий read создаёт или
    переиспользует snapshot по новому evidence set; старые не удалённые
    snapshots не переписываются.
12. Объяснение использует простые качественные формулировки: например,
    «ты уже прошёл заметно больше своего обычного полного дня». Оно не сообщает
    diagnosis, причинность, readiness score, ложную точность или provider name.
    LLM, chat history и provider payload не участвуют в domain calculation.
13. Перед активацией V3 выполняется privacy-safe retrospective dry-run по
    отдельно разрешённой staging history. Dry-run не записывает snapshots и не
    меняет рекомендации; наружу выводятся только агрегаты о coverage, status
    stability, резких переключениях, V2/V3 differences и invariant violations,
    без дат, identifiers, raw values или provider data.

## Considered alternatives

### Оставить ручной timezone и не учитывать steps

Сохраняет текущие контракты, но техническая настройка блокирует естественный
пользовательский путь, а существенная часть доступной активности игнорируется.

### Позволить LLM угадывать timezone и самостоятельно оценивать steps

Создаёт самый короткий разговор, но возвращает недетерминизм, расхождение между
чатами и невозможность воспроизвести старый результат. Отклонено.

### Учитывать только завершённый предыдущий день

Удобно для full-day baseline, но теряет полезный монотонный факт: пользователь
уже мог превысить обычный полный дневной объём. Отклонено в пользу явного
разделения completed-day и partial-day evidence.

### Сравнивать сегодняшний count с обычным значением к текущему часу

Было бы информативнее, но full-day history не содержит intraday trajectory.
Без исторических snapshots это ложная точность, поэтому вариант отложен.

### Создать отдельную DailyMovement модель или service

Даёт более чистую будущую границу для расширенной movement analytics, но для
одного typed metric создаёт преждевременную модель, migration surface и
ownership. Пока выбран additive metric в существующей observation model;
решение следует пересмотреть, если движение получит собственные цели, события
или независимый lifecycle.

## Consequences

- Первый daily assessment в Web становится zero-friction при доступном browser
  timezone; Coach получает узкий и аудируемый путь явной коррекции.
- Identity contract и consent UI получают новый узкий write scope, а API/MCP —
  новый idempotent timezone tool. Это additive security-sensitive изменение.
- Recovery schema, contracts и Intervals import получают additive `steps` и
  `count`, включая correction, withdrawal и erasure semantics.
- V3 может консервативно изменить рекомендацию только при свежем высоком
  movement signal вместе с другим неблагоприятным фактом.
- Без steps поведение остаётся эквивалентным V2, кроме автоматизированного
  получения timezone.
- Live calculation становится немного шире, но новый deployable service,
  scheduler, queue, generic rules engine или LLM dependency не появляются.
- Production activation, staging data access, backfill, deploy и release
  остаются отдельными operator gates.

## Verification

- Web tests проверяют IANA detection, unset-only bootstrap, DST и отсутствие
  циклических preference writes.
- Identity/API/MCP tests проверяют `person-timezone:write`, consent text,
  отсутствие privilege widening, IANA validation, idempotency и read-after-write
  retry.
- Provider fixtures проверяют steps present, absent, corrected and removed;
  domain tests доказывают отсутствие provider branching.
- Pure V3 policy matrix проверяет minimum history, median/MAD and percentile
  fallback, exclusions, partial-day monotonicity, freshness и правило
  «steps alone never downgrade».
- PostgreSQL tests проверяют clean/upgrade migrations, identifier limit,
  Person isolation, snapshot reproduction, correction, withdrawal, late import,
  deletion и erasure.
- Retrospective dry-run проверяет `writesPerformed=false`, отсутствие PII/raw
  evidence в output, V2/V3 stability, abrupt transitions и invariant
  violations до activation.
- Выполняются full tests, typecheck, lint, build, docs validation, независимый
  Quality, Architecture Review и post-acceptance Wiki.

## Related material

- [API-owned daily assessment](./20260914-own-daily-assessment-and-next-action-in-api.md)
- [Hybrid personal baselines](./20260915-use-hybrid-personal-baselines-for-daily-assessment.md)
- [Balanced baseline activation](./20260917-activate-balanced-personal-baselines-in-daily-assessment-v2.md)
- [TASK-0117 plan](../../plans/2026/09/completed/2026-09-17-task-0117-zero-friction-daily-context-and-optional-steps.md)
- TASK-0117
