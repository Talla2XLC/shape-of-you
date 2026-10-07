# TASK-0164 — диагностика отказов и восстановление записи питания

## Статус и доказательства

Оператор разрешил read-only диагностику кода/коннектора и talking-to-ai.
Серверное событие подтверждает отказ get_daily_decision_context после
подтверждения workout/activity link. SQLSTATE в этом событии отсутствует.
В окне неудачной записи питания MCP requests имеют HTTP 200; tool-level
отказ не логируется. Точная причина historical Meal failure не установлена.
Текущие успешные чтения не заменяют это доказательство.

Ни runtime configuration, ни персональные факты не изменялись.
Этап A ADR и плана одобрен оператором сообщением «го»; commit/push/deploy
и live writes этим документом не разрешаются.

## Архитектура и объём

[Accepted ADR: только этап A](../../../docs/adr/20261007-diagnose-and-recover-meal-capture-failures.md).
Новая конкретная информация от оператора изменила первый приоритет:
воспроизведена несовместимость дробного multipleOf опубликованной schema с
клиентским валидатором. В API 0.7/5.1 проходят благодаря existing precision6;
estimated без confidence не проходит закономерно; synthetic menu проходит.
Последний исторический payload отсутствует, не объявлять его причину доказанной.

Одобренный этап A: публикация MCP input schema без дробных
multipleOf, при неизменной строгой API validation исходных schemas. Только
общая MCP input publication boundary, meaningful boundary/privacy/compatibility
checks; не менять output schemas, REST/domain rules, Nutrition persistence,
коррекции, pool limits/timeouts, БД или staging topology.
Этап B (typed failures, новые события и recovery) остаётся отдельным предложением.
Training matching отдельно в TASK-0165; progression отдельно в TASK-0162.

## Одобренный этап A

Реализация завершена и независимо принята Quality 2026-10-07.
API typecheck/build/scoped lint, 390 unit tests и 188 integration tests
прошли; последние включают isolated PostgreSQL, fractional persistence,
same-key replay и synthetic menu. Architecture Review завершён;
canonical Meal API Wiki обновлена после Quality acceptance.
Изменения пока локальные, commit/push/deploy и live client canary не выполнены.
План остаётся активным для непринятого предложения этапа B ниже;
этап A не разрешает его реализацию.

1. Зафиксировать принятие только этапа A ADR/плана; этап B не выполнять.
2. Создать копию опубликованной input schema без fractional multipleOf;
   исходную schema оставить strict server validation. Не мутировать contracts.
3. Проверить published input стандартным валидатором и реальным MCP handler:
   0.7/5.1 и synthetic menu success; избыточная precision/bounds/contradictory
   evidence по-прежнему отклоняются сервером. Сохранить integer multipleOf.
4. Frozen compatibility, API typecheck/build/lint/relevant tests, независимая
   Quality и Architecture Review. После принятия affected Wiki, docs validator.
5. Commit/push/deploy отдельно; после delivery проверка через реальный клиент
   с актуальной schema. Не использовать production Meal ради теста без разрешения.

## Этап B, не включённый в этап A

1. Зафиксировать принятие ADR/плана. Разобрать все failure paths, сохранив
   privacy boundary и additive frozen-client compatibility.
2. Добавить closed failure phases/categories и события в MCP entrypoint;
   нормализация и schema validation не должны терять диагностику. Добавить
   known evidence-change category для context reads без raw exception.
3. Различать not_saved/unknown и same-key read-before-retry. Typed canonical
   Meal success достаточен; поздний read failure не отменяет commit.
4. Meaningful failure injection/privacy unit tests и isolated PostgreSQL/MCP
   flow: rejected payload, реальные constraint failure, lost acknowledgement,
   same-key replay, failed read, denied authorization, успешный synthetic menu.
5. API typecheck/build/lint/relevant tests, независимая Quality и Architecture
   Review; accepted affected Nutrition/Coaching Wiki, docs validator.
6. Завершённый план перенести в completed и показать exact commit plan.
   Доставка и live user canary требуют отдельных разрешений. Не обещать
   восстановить несуществующий historical log или исправить неизвестный root cause.

## Приёмка этапа A

Обычные десятичные значения проходят опубликованную schema и MCP handler;
strict server validation и Nutrition persistence сохранены. Оригинальные
schemas, output schemas и integer multipleOf не меняются.

## Приёмка предложенного этапа B (не одобрена)

Воспроизводимый отказ содержит безопасную категорию/фазу и diagnosticId.
Неопределённый ответ не создаёт дубль и не превращается в ложный not_saved.
Успешный canonical Meal не отвергается из-за необязательного read-back.
Ни один тест или operational report не содержит credentials/real health payload.
