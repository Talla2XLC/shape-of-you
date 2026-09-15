---
id: "decisions-20260915-deliver-daily-assessment-through-stable-mcp-reads"
kind: adr
title: "Доставлять ежедневную оценку через стабильные MCP reads"
status: accepted
date: 2026-09-15
supersedes: []
superseded_by: null
tags:
  - architecture
  - coaching
  - mcp
  - compatibility
---

# Доставлять ежедневную оценку через стабильные MCP reads

## Context

ADR `20260914-own-daily-assessment-and-next-action-in-api` закрепил отдельный
MCP read `get_daily_assessment`. После выпуска выяснилось, что уже открытый
обычный ChatGPT conversation сохраняет замороженный список доступных действий.
Он продолжает вызывать известный ему `get_daily_projection`, но не видит новое
имя `get_daily_assessment`, даже когда установленное приложение обновлено.

Перевод пользователя в отдельный тарифицируемый Work conversation, создание
нового чата после выпуска или ручное обновление действий не являются
приемлемым продуктовым контрактом. Пользователь должен продолжать обычный
conversation и получать новую server-owned логику бесшовно.

MCP result уже имеет два представления: `structuredContent`, проверяемый
объявленной output schema, и актуальный text `content`, формируемый сервером при
каждом вызове. Замороженный клиент продолжает получать новый text `content`
для известного tool, даже когда его tool catalog не обновился.

## Decision

1. Стабильное существующее действие `get_daily_projection` становится
   compatibility carrier для текущей API-owned ежедневной оценки.
2. Его имя, input schema, read scope и `structuredContent` не меняются:
   factual `DailyProjection` остаётся совместимым с уже сохранённой client
   schema.
3. При каждом вызове `get_daily_projection` API также читает
   `DailyAssessmentService` в том же Person-scoped request context.
4. Если assessment относится к тем же `localDate` и `timezone`, MCP text
   `content` содержит точный serialized `DailyAssessmentResult` и указывает
   использовать его как единственный источник статуса и следующего действия.
   ChatGPT запрещено пересчитывать или дополнять решение.
5. `timezone_required` передаётся явно. Ошибка дополнительного assessment read
   не ломает factual projection, но text `content` требует fail-closed
   поведения для любого daily decision.
6. Для исторической projection или несовпадающей локальной даты assessment не
   прикладывается: такой read остаётся только factual view.
7. Отдельный `get_daily_assessment` сохраняется как прямой typed contract для
   клиентов с актуальным catalog. Доменная policy, snapshot и PostgreSQL
   authority остаются едиными; вторая модель решения не создаётся.
8. Дальнейшие улучшения Daily Coach должны по возможности эволюционировать за
   стабильными существующими reads. Новый tool не может быть единственным
   способом доставить обязательное поведение уже открытым conversations.

## Considered alternatives

### Требовать новый обычный ChatGPT conversation

Он получит новый catalog, но превращает каждое расширение tool set в ручной
ритуал и разрывает долгоживущий Coach conversation. Отклонено.

### Перевести Coach в Work conversation

Даёт доступ к установленному приложению, но меняет пользовательский режим и
тарификацию. Отклонено.

### Заменить output schema `get_daily_projection`

Позволило бы вернуть новый составной structured result, но старый клиент уже
сохранил строгую `DailyProjection` schema и может отклонить несовместимый
payload. Отклонено.

### Доставлять assessment через актуальный text content стабильного read

Сохраняет известное имя и строгий structured result, но добавляет транспортное
представление assessment рядом с projection. Выбрано как минимальный
совместимый путь для замороженных clients.

## Consequences

- Существующий обычный Coach conversation получает новую API-owned оценку без
  нового чата, Work mode, переподключения или обновления tool catalog.
- `get_daily_projection` выполняет дополнительный read текущего immutable
  assessment snapshot; новых writes, scopes, migrations и dependencies нет.
- Transport text дублирует decision payload, но не создаёт новую domain
  authority: источником остаётся тот же `DailyAssessmentResult`.
- Исторические projection не смешиваются с оценкой текущего локального дня.
- Новые клиенты могут продолжать вызывать `get_daily_assessment` напрямую.

## Verification

- MCP tests подтверждают неизменность имени, input/output schema, scope и
  factual `structuredContent` для `get_daily_projection`.
- Compatibility tests подтверждают точное присутствие assessment fields в text
  content при совпадающих date/timezone и запрет prompt-side reconstruction.
- Tests покрывают `timezone_required`, несовпадающую дату и ошибку assessment
  read без потери factual projection.
- Existing routine capture, direct `get_daily_assessment`, authorization и
  full API suites не регрессируют.
- Post-deploy canary выполняется в том же обычном Coach conversation.

## Related material

- [API-owned daily assessment](./20260914-own-daily-assessment-and-next-action-in-api.md)
- [Portable Daily Coach](./20260828-keep-daily-coach-protocol-portable-across-approved-mcp-clients.md)
- [Daily Coach reply policy](./20260902-deliver-coach-reply-policy-in-every-relevant-mcp-result.md)
- TASK-0113
