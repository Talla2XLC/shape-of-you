---
id: decisions-20261009-bound-api-database-connection-waits
kind: adr
title: "Ограниченно ждать соединение БД вместо секундного отказа"
status: accepted
date: 2026-10-09
supersedes: []
superseded_by: null
tags:
  - architecture
  - database
  - diagnostics
---

# Ограниченно ждать соединение БД вместо секундного отказа

## Context

API pool содержит максимум 10 соединений вне tests и ждёт доступное соединение
только 1000 ms. Составной Daily Decision Context многократно читает owner facts,
включая fanout DailyAssessment и Training. Параллельный запрос усиливает нагрузку
очереди, хотя Training context сам не изменяет факты.

Изолированная PostgreSQL с production pool configuration показала: при занятых
10 соединениях следующий запрос завершился через 1002 ms обычным Error без
SQLSTATE. Это воспроизводимый механизм; не доказательство причины конкретного
исторического diagnosticId. Старый контейнер уже заменён разрешённой выкладкой,
его исключение недоступно. Повторные live reads прошли, включая параллельную пару.

## Decision

Оператор утвердил ADR и план TASK-0169 2026-10-09. Применяется точечное изменение
existing API infrastructure:

1. Увеличить bounded connection acquisition timeout с 1000 до 5000 ms.
   Production max остаётся 10, test max остаётся 4. Не повышать число соединений,
   не менять SQL, блокировки, isolation, ownership и retries фактов.
   Этот параметр node-postgres также ограничивает установку нового соединения;
   сохраняется конечное ожидание, не создаётся бесконечная очередь.
2. Добавить фиксированную безопасную причину `pool_acquisition_timeout` в
   existing `mcp_context_read_failed`. Узнавать точную известную ошибку pg-pool
   `timeout exceeded when trying to connect` в ограниченной цепочке причин.
   Не экспортировать message, stack, SQL, параметры, credentials или values.
   Typed evidence-change precedence сохраняется; recognized SQLSTATE сохраняет
   свою классификацию. Точный порядок precedence закрепить тестами.
3. Public context error остаётся `outcome=unknown`, `reason=read_failed` с UUID.
   Не менять внешний wrapper ChatGPT, не выдавать внутренний отказ за неверные
   аргументы пользователя. Не сохранять диагноз причины утратившегося вызова.
4. Новых entities, tables, migrations, services, dependencies, env variables
   и backend training permissions не добавлять. Runtime параметры другого
   deployable service не менять.

## Considered alternatives

- Оставить 1000 ms: минимально, но воспроизведённый короткий отказ остаётся.
- Поднять max connections: увеличит нагрузку shared PostgreSQL/VM и не устраняет
  неограниченный fanout; отклонено для этой точечной задачи.
- Переработать композицию facts и общий scheduler: может сократить запросы,
  но затрагивает больше владельцев чтения. Отдельная задача после измерений;
  не включать молча в исправление timeout.
- Убрать timeout: создаёт бесконечное ожидание; отклонено.

## Consequences

Короткая временная занятость до нового budget больше не вызывает секундный
отказ. Длительная нехватка соединений всё равно завершится ошибкой с точной
безопасной диагностикой. Отказ будет позже; это не гарантия любого запроса под
произвольной нагрузкой и не доказанное исправление исторического UUID.

## Verification

- Real MCP→API→isolated PostgreSQL: занять pool, освободить соединения после
  прежнего 1000 ms, но до 5000 ms; согласованное read должно пройти.
- Полное exhaustion дольше 5000 ms: bounded error и `pool_acquisition_timeout`,
  без персональных значений или raw exception в публичном ответе/логах.
- Приоритет typed consistency и SQLSTATE, bounded cause chain, auth/input
  discrimination и unknown write outcomes не меняются.
- Unit, relevant PostgreSQL integration, API typecheck/build/lint, docs validator,
  independent Quality и пятичастный Architecture Review.
- Commit/push/deploy отдельно после разрешения; no personal fake workouts.

## Related material

- [План TASK-0169](../../plans/2026/10/completed/2026-10-09-task-0169-database-connection-waits.md).
- [Граница базы знаний](20261009-let-coach-propose-working-weight-from-history.md).
