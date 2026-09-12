---
id: "decisions-20260912-persist-confirmed-training-programs-through-one-mcp-command"
kind: adr
title: "Сохранять подтверждённую тренировочную программу одной атомарной MCP-командой"
status: accepted
date: 2026-09-12
supersedes: []
superseded_by: null
tags:
  - architecture
  - training
  - coaching
  - mcp
---

# Сохранять подтверждённую тренировочную программу одной атомарной MCP-командой

## Context

Training domain уже поддерживает Person-owned `TrainingProgram`, неизменяемые
версии, явную активацию и optimistic locking. HTTP API позволяет создать draft,
добавить версию и активировать её. MCP, через который работает Coach, публикует
только чтение активной программы и чтение/запись выполненных тренировок.

Когда активная программа отсутствует, Coach может восстановить похожую схему из
истории тренировок, но не может сохранить её как план. Такая реконструкция не
является `Planned` authority и может быть потеряна или переосмыслена в другом
чате. Публикация низкоуровневой последовательности create/version/activate также
оставила бы модели возможность остановиться на неактивном draft либо повторить
часть операции.

Изменение программы является material action: пользователь должен явно
подтвердить полную программу до записи. При этом повтор доставки одной и той же
команды не должен создавать новые программы или версии.

## Decision

В существующем `apps/api` добавить новый MCP tool
`save_confirmed_training_program`. Он использует существующий
`workout:write` scope и вызывается только после явного подтверждения
пользователем полного snapshot программы. Новых OAuth scopes, сервисов,
зависимостей, secrets и deployable boundaries не создаётся.

MCP input содержит ожидаемое состояние активной программы:
`expectedActiveProgramId` и `expectedLockVersion` одновременно равны `null`,
если активной программы нет, либо одновременно указывают результат предыдущего
typed read. Остальная часть input совпадает со строгим typed snapshot первой
или следующей версии программы. Свободный raw JSON и текст подтверждения не
сохраняются.

Application service передаёт команду в одну атомарную repository transaction,
которая берёт Person-scoped advisory lock и:

1. читает текущую активную программу;
2. возвращает её как idempotent no-op, если её активная версия уже семантически
   совпадает с подтверждённым snapshot;
3. при ожидаемом отсутствии создаёт новую программу и первую версию сразу
   активной;
4. при совпадающих `programId` и `lockVersion` добавляет новую неизменяемую
   версию и сразу делает её активной;
5. при устаревшем ожидании завершает команду конфликтом без частичной записи.

Операция не меняет существующий HTTP draft/version/activation lifecycle. После
успешной MCP-записи Coach обязан повторно прочитать активную программу и только
после совпадающего read-back сообщить, что она сохранена.

Для планирования публикуется server-composed read
`get_training_context`. Он возвращает активную программу и ограниченную историю
последних выполненных тренировок. Если активная программа отсутствует, история
остаётся только evidence для `Proposed now`: она не становится планом без
явного подтверждения и успешного `save_confirmed_training_program`. Ошибка
чтения оставляет план неизвестным и запрещает зависимую импровизацию.

Старый `get_active_training_program` сохраняется без несовместимых изменений.
MCP operational instructions запрещают раскрывать пользователю tool names,
status values, schema/API mechanics и HTML entities, а также запрещают молча
изменять упражнения, порядок, нагрузку или прогрессию.

## Considered alternatives

### Опубликовать существующие create, version и activate как отдельные MCP tools

Отклонено для Coach: модель могла бы создать draft и не активировать его,
повторить только часть последовательности или объявить успех до read-back.
Низкоуровневый HTTP lifecycle остаётся доступен обычным API clients.

### Добавить только одну create-and-activate команду без обновления программы

Отклонено: следующая подтверждённая редакция снова потребовала бы отдельного
механизма и могла бы породить несколько активных authority paths.

### Оставить только инструкции «сначала прочитать историю»

Отклонено: инструкция чата не создаёт durable `Planned` authority и не решает
невозможность записи программы через Coach.

### Сделать историю тренировок автоматически активной программой

Отклонено: выполненные факты не доказывают намерение продолжать ту же схему,
нагрузку или прогрессию. Это смешало бы `Actually completed` и `Planned`.

### Создать отдельный Training Coach service

Отклонено как преждевременная deployable boundary. Команда использует
существующие Training domain, PostgreSQL transaction и API-owned MCP adapter.

## Consequences

- Подтверждённая программа становится общей для всех чатов через PostgreSQL, а
  не памятью конкретного conversation.
- Создание и обновление активной программы не оставляют частичный draft после
  сбоя и безопасны при повторной доставке одинакового snapshot.
- Optimistic expectation защищает от перезаписи параллельного изменения.
- История помогает сформировать предложение, но не получает статус плана без
  согласия пользователя.
- MCP получает два новых tool names; уже открытый client может увидеть их только
  после обычного metadata refresh или в новом conversation.
- Миграция базы данных не требуется.

## Verification

- Contract tests проверяют строгую пару expected fields и typed program
  snapshot.
- Repository tests проверяют atomic create-and-activate, atomic
  append-and-activate, semantic duplicate no-op, stale expectation conflict и
  Person isolation.
- MCP tests проверяют `workout:write`, active/absent context с историей и без
  неё, подтверждённую запись, обязательный read-back contract и fail-closed
  ошибки.
- Policy tests проверяют, что history-only остаётся proposed, внутренние
  mechanics не попадают в ответ и plain Markdown не содержит HTML entities.
- Полные доступные API lint, typecheck, build и tests, документационный
  validator, `git diff --check` и `4dt-board validate` проходят до handoff.

## Related material

- [Training API](../wiki/api/training.md)
- [Coaching and Decision Support](../wiki/domain/coaching-and-decision-support.md)
- [Версионированные программы и неизменяемые тренировки](20260731-model-versioned-training-programs-and-immutable-workout-sessions.md)
- [Daily Coach поверх существующих MCP tools](20260827-orchestrate-daily-coach-over-existing-mcp-tools.md)
- [Явное отсутствие активной программы в MCP](20260828-represent-active-training-program-absence-explicitly-in-mcp.md)

