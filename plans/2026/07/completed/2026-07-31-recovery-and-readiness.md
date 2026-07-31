---
title: Реализация Recovery and Readiness
status: completed
created: 2026-07-31
updated: 2026-07-31
related_roadmap_items:
  - DEV-023
related_board_items:
  - TASK-0018
---

# Реализация Recovery and Readiness

## Цель

Добавить в существующий NestJS API типизированные наблюдения сна и
восстановления, явное согласие для источников устройств и воспроизводимые
оценки готовности и риска нагрузки без реальной интеграции поставщика и без
автоматического изменения тренировочной программы.

## Утверждённая архитектура

- Решение зафиксировано в
  `docs/adr/20260731-model-typed-recovery-observations-and-versioned-readiness-assessments.md`.
- Общие определения поставщиков и моделей устройств не копируются по
  `Person`; подключения, согласия, retention state и observations принадлежат
  `Person`.
- Неизменяемый observation root имеет ровно одну типизированную деталь.
- Correction заменяет всё наблюдение и сохраняет supersession history.
- Время хранится как UTC interval, observation-time IANA timezone и local date.
- Readiness и load-risk assessments неизменяемы и закреплены за policy version
  и evidence.
- Hard stop имеет приоритет над readiness score.
- Recovery владеет assessment, Coaching позже владеет recommendation.
- Реальные wearable data запрещены до authenticated erasure workflow.

## Объём

### Входит

- Runtime JSON Schemas и TypeScript contracts в `packages/contracts`.
- Shared immutable provider, device model и capability versions без сетевого
  adapter и без credentials.
- Person-owned logical connection, device instance, explicit consent,
  revocation и retention state.
- Immutable observation root и типизированные детали для sleep session,
  numeric recovery metric и subjective check-in.
- Ручной и синтетический device source; добавление точного source channel без
  изменения семантики существующих каналов.
- Идемпотентное создание, current/history queries и whole-observation
  correction.
- Shared immutable assessment policy versions без публичного изменения общей
  policy до отдельной write authorization.
- Явная команда расчёта, current/history readiness и load-risk assessments,
  evidence links, data-quality cap, hard stops и calculation snapshot.
- Узкий read-only Training evidence port; несовместимые load bases не
  объединяются неявно.
- Additive Drizzle migration, OpenAPI, unit и PostgreSQL integration tests.
- Proposed canonical Wiki до реализации и current-state alignment после
  принятия Quality.

### Не входит

- Garmin или другой реальный provider, OAuth, device sync и secrets storage.
- Production health data, реальные персональные данные и миграция workbook.
- Физическое удаление, scheduler retention enforcement и background worker.
- Coaching recommendation, daily plan, day closure и natural-language intake.
- Автоматическое изменение программы тренировок.
- Универсальные observation platform, rules engine, event store, queue,
  microservice или отдельная database.
- Медицинский диагноз или утверждение клинической валидности score.

## Начальный типизированный контракт

- Sleep detail: начало и конец интервала, фактическая длительность сна и
  optional оценка качества источника.
- Numeric metric detail: закрытый metric identifier, точное numeric value и
  совместимая unit. Первая версия ограничивается HRV RMSSD и resting heart
  rate; расширение требует contract и migration review.
- Subjective detail: шкалы энергии, усталости, мышечной болезненности, стресса
  и качества сна, а также явные пользовательские флаги острого недомогания и
  опасения травмы. Флаги не являются диагнозом.
- Assessment policy не получает неявных production defaults. Integration
  tests используют synthetic policy version; production activation требует
  отдельного утверждения параметров и права записи.

## Этапы

1. Добавить contracts, enums, units, временные и privacy invariants.
2. Добавить чистые доменные проверки observations, consent и assessments.
3. Добавить schema и одну additive migration с Person ownership, typed detail,
   consent, idempotency, supersession, policy version и evidence constraints.
4. Реализовать repository transactions и advisory Person locks для mutations.
5. Реализовать connection/consent и observation create/read/list/history/
   correction.
6. Реализовать policy version lookup и детерминированный assessment без
   generic rules engine.
7. Добавить узкий Training evidence reader и разделение несовместимых basis.
8. Подключить NestJS module, controllers, runtime composition и OpenAPI.
9. Добавить synthetic unit и integration vectors без персональных данных.
10. Проверить clean migration, upgrade от текущей schema, concurrency,
    timezone/DST, Person isolation и regression.
11. Провести независимые Quality Review и Architecture Review.
12. После принятия обновить current-state Wiki и перенести план в
    `completed/`.

## Критерии приёмки

1. Два `Person` используют одну shared device-model version без копирования,
   но подключения и observations изолированы.
2. Connection не хранит credentials, token или private provider secret.
3. Device observation отклоняется без действующего consent того же `Person`,
   для запрещённого kind или после revocation.
4. Manual observation не притворяется device source и не требует connection.
5. Observation имеет ровно одну detail record, соответствующую kind, с
   допустимой unit и range.
6. UTC interval, IANA timezone и local date проверяются, включая DST case.
7. Повтор create с тем же person/source/dedupe key идемпотентен.
8. Correction создаёт полный replacement, сохраняет history и исключает
   исходный observation из current queries и новых assessments.
9. Policy version неизменяема; assessment возвращает точную version, window,
   evidence checksum и calculation snapshot.
10. Отсутствующие, просроченные или низкокачественные evidence ограничивают
    confidence и не дают ложного состояния sufficient.
11. Явный hard stop всегда формирует blocked risk независимо от score.
12. Training evidence читается без mutation; external-weight, body-weight и
    assisted нагрузка не складываются неявно.
13. Assessment не меняет программу, session, observation или consent.
14. Другой `Person` не может прочитать или использовать чужое observation,
    consent или assessment.
15. Существующие Physical State, Nutrition и Training contracts сохраняют
    поведение.
16. Runtime schemas, OpenAPI, migrations, unit, integration и documentation
    checks проходят.

## Проверки

- ESLint для затронутых TypeScript-файлов.
- TypeScript typecheck и build contracts/API.
- Все unit tests API.
- Все PostgreSQL integration tests API.
- Clean-database migration и upgrade от текущего snapshot.
- Отдельные concurrency, DST/timezone, hard-stop и insufficient-evidence pins.
- `node scripts/validate-docs.mjs`.
- `git diff --check`.
- Audit PostgreSQL identifiers: не более 63 bytes.

## Риски и ограничения

- Текущие evidence не подтверждают клинические пороги; production policy
  нельзя активировать на основании synthetic tests.
- Revocation и retention state не заменяют физическое удаление. До реализации
  authenticated erasure реальные wearable data запрещены.
- Полный provider contract и rate limits неизвестны; текущая connection model
  намеренно не хранит секреты и не запускает sync.
- Subjective шкалы отражают пользовательское сообщение, а не диагноз.
- Материализация current assessment допускается только после измерения
  нагрузки; authority остаётся в immutable observations и assessments.

## Architecture Review до реализации

1. **Избыточная сложность:** один Recovery module и одна migration; нет нового
   deployable, scheduler, queue или общего policy framework.
2. **DDD:** shared device knowledge, person-owned observations, assessment и
   будущая coaching recommendation имеют разные ownership и lifecycle.
3. **Дублирование:** общий observation root не дублирует provenance/time, а
   typed details не превращаются в универсальный JSON.
4. **Privacy:** consent, revocation, retention и будущая erasure разделены;
   append-only correction не используется как оправдание вечного хранения.
5. **Упрощение:** explicit assessment command и typed policy version проще
   event sourcing и generic rules engine при текущих требованиях.

## Результат

- Реализация принята независимой проверкой качества по всем 16 критериям.
- Добавлены типизированные контракты, Recovery module, person-scoped
  persistence, внутренние версии моделей устройств и правил, публичные
  observations/assessments endpoints и одна additive migration.
- Device ingestion требует действующего consent, разрешённого kind и
  retention; отзыв блокирует новые данные и не изображает физическое удаление.
- Readiness и load-risk assessment сохраняют policy version, evidence,
  checksum и snapshot; hard stop формирует `blocked` и нулевую готовность.
- Реальная Training session проверена как read-only evidence; три load basis
  не объединяются неявно, а assessment не меняет Training, observations или
  consents.
- Модульные тесты: 23 из 23; интеграционные тесты: 24 из 24. Проверены чистая
  база, обновление предыдущей схемы, concurrent idempotency, изоляция
  пользователей, DST, OpenAPI, TypeScript, ESLint и документация.
- Реальный provider, OAuth, production health data, erasure worker,
  production policy activation и Coaching не выполнялись и остаются за
  утверждёнными gates.

## Итоговая Architecture Review

1. Решение осталось одним модулем существующего API и одной additive
   migration; новые deployable boundaries не появились.
2. Shared device definitions, person-owned observations, Training evidence и
   будущие Coaching recommendations разделены по владению и lifecycle.
3. Общий типизированный observation root устраняет дублирование provenance и
   correction logic, не превращаясь в универсальный JSON-store.
4. ADR хранит решение, Wiki — текущее состояние, а этот план — ход и результат
   поставки; второго источника архитектурной истины не создано.
5. Дальнейшее упрощение потеряло бы строгие units, воспроизводимость assessment
   или privacy boundaries; дополнительное обобщение сейчас не требуется.
