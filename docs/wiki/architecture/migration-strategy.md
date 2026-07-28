---
id: "architecture-migration-strategy"
kind: architecture
title: "Стратегия миграции"
status: draft
tags:
  - "architecture"
  - "migration"
---

# Стратегия миграции

## Кратко

Миграция из Google Sheets в PostgreSQL контролируема, основана на доказательствах, обратима и не передаёт authority до reconciliation и cutover.

## Содержание

### Место в roadmap

DEV-023 извлекает backend-контракты и доменную логику из Google Sheets. DEV-024 выполняет миграцию в PostgreSQL и dual-run. Работы по web и mobile не обходят gate стабильного backend-контракта.

### Обязательные этапы

1. Инвентаризировать текущие sheets, columns, formulas, scripts, rules, identifiers и operational workflows.
2. Сопоставить каждый элемент источника с доменными терминами и owning context.
3. Сохранить provenance и raw source identity.
4. Спроектировать и проверить backfill.
5. Сверить старое и новое представления через integrity reports.
6. Выполнить контролируемый dual-write или другой явно спроектированный dual-run.
7. Определить измеримые критерии cutover и получить одобрение оператора.
8. Передать authority только после выполнения критериев.
9. Сохранить процедуры rollback и восстановления после расхождений.

### Правила безопасности

Отсутствующие данные не выдумываются. Неоднозначные mappings становятся открытыми вопросами. Self-healing начинается с dry-run, записывает before/after, использует allowlist, проверяет read-back и integrity, откатывает неподтверждённый результат и не изменяет автоматически закрытые дни или неоднозначные факты.

## Основания

- Roadmap миграции и правила source of truth, предоставленные оператором.

## Решения

- Стратегия принята на уровне baseline; конкретные механизмы требуют следующих планов и ADR.

## Открытые вопросы

- Полный inventory Google Sheets и доступ к нему.
- Стратегия identifiers и качество исторических данных.
- Dual-write или иной механизм dual-run.
- Допуски reconciliation, метрики и длительность cutover, окно rollback.

## Связанные материалы

- `data-ownership.md`
- `../roadmap/overview.md`
- `../domain/glossary.md`
