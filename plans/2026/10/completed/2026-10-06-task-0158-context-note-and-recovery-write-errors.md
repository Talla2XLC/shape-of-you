# TASK-0158 — контракт заметок и диагностика отказов Recovery MCP

## Статус и согласование

Оператор утвердил исправление сообщением «го» после разбора конкретного
противоречия между публичным контрактом и domain validation. Реализация
принята независимой Quality; commit/push/staging delivery не выполнены.

## Проверенный дефект

Публичная schema разрешает `general` вместе с `exclude`, но существующий
DailyContextNote writer отклоняет это сочетание. Общий MCP failure скрывает
причину. Интеграционный сценарий проверял default eligibility, поэтому не
обнаруживал этот вариант запроса. Персональные данные в план не включаются.

Ночной HRV проходит локальную domain validation и существующий интеграционный
тест. Причина отказа реального запроса не установлена; исправление заметки
не объявляется исправлением HRV.

## Выполнение

1. Согласовать существующие schemas и описания с действующим правилом:
   `general/include`, `travel/exclude`. Сохранить команды с отсутствующими
   необязательными полями и действующие defaults; не менять baseline policy.
2. Возвращать для Recovery и context note bounded причины отказа, отделяя
   невалидный input/domain invariant от неизвестного сбоя выполнения.
   Не передавать произвольные исключения или SQL клиенту.
3. Для неизвестного сбоя записывать server-generated diagnostic ID,
   фиксированные tool/category и SQLSTATE из закрытого allowlist при наличии. Никогда
   не логировать arguments, персональные данные, SQL, параметры, error message,
   stack, credentials или произвольный cause. Диагностический ответ не
   разрешает повтор через другой инструмент при safety block.
4. В изолированных tests проверить противоречивое сочетание, исправленную
   запись с read-back/idempotency и полный формат manual nightly HRV.
5. Независимая Quality, соответствие canonical ADR/Wiki, docs validator,
   API typecheck/build/lint и релевантные tests.

## Архитектурная граница

Это исправление соответствия уже принятому baseline invariant и MCP adapter
контракту. Новых сущностей, сервисов, таблиц, миграций, policy, зависимостей
или источников истины нет. Действующие ADR о hybrid baselines, нормализации
Recovery и совместимой эволюции MCP остаются authority. Валидные старые
команды сохраняются; ранее отклонявшиеся writer запросы не становятся фактами.

## Критерии завершения

- Публичная schema и writer согласованы для всех сочетаний/defaults.
- MCP failure содержит конкретную безопасную причину для установленного
  отказа; неизвестная ошибка имеет диагностический ID без раскрытия payload.
- Tests доказывают сохранение и read-back в изолированном PostgreSQL.
- Причина live HRV не выдумана и явно отделена от проверенных результатов.
- Independent Quality приняла scoped diff.

## Границы разрешения

Нет live writes, ручных миграций, connector refresh или повторов safety-blocked
запросов. Commit/push/deploy требуют отдельного разрешения. Реальный Coach
canary выполняется после доставки отдельно от локальных tests.

## Результат

- Create/correct/persisted schemas согласованы с writer; optional defaults
  сохранены. Correction MCP wrapper сохраняет соответствующий `allOf`.
- Для отказов Recovery/context note есть bounded причины; неизвестный сбой
  имеет diagnostic ID в тексте и structuredContent. Логи не содержат payload,
  error message, SQL или произвольных кодов; SQLSTATE ограничен allowlist.
- Полный формат manual HRV и исправленная note сохраняются в изолированном
  PostgreSQL с read-back и idempotency. Противоречивый запрос не сохраняется.
- API unit 369 и integration 180 прошли до узкого исправления allowlist;
  после него независимая Quality проверила 29 unit и 6 MCP/PostgreSQL scenarios.
  Итоговые API typecheck/build, targeted eslint, docs validator и diff check
  прошли. Quality acceptance: `task-0158-quality-acceptance-20261006`.
- Architecture Review не обнаружил новой архитектуры, границ или policy;
  affected canonical Recovery Wiki отражает поведение текущих исходников.
- Причина прежнего live HRV отказа остаётся неизвестной. Клиентское обновление
  metadata, выполнение model instructions и real Coach canary не доказаны
  локальными tests. Доставка этого исправления на staging ещё не выполнена.
