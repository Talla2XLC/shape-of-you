---
id: "start-overview"
kind: start
title: "Начало работы"
status: draft
tags: []
---

# Начало работы

## Кратко

Shape of You — персональная AI-платформа для обоснованных решений о физическом развитии. Baseline репозитория завершён, а backend находится на этапе DEV-023: runtime и первая вертикаль веса реализованы, остальные предметные возможности ещё проектируются.

## Содержание

### Навигация

- Vision: `vision/overview.md`
- Продукт: `product/overview.md` и `product/scope.md`
- Домен: `domain/overview.md`, `domain/glossary.md` и `domain/bounded-contexts.md`
- Архитектура: `architecture/overview.md` и связанные архитектурные страницы
- Roadmap: `roadmap/overview.md`
- Решения: ADR в `../adr/`

### Текущий этап

DEV-027 завершил workspace, продуктовый и доменный baseline, архитектурную
документацию, набор ADR и версионируемые планы. В DEV-023 реализованы один
NestJS API с `FastifyAdapter`, PostgreSQL persistence и person-scoped вертикаль
`WeightMeasurement` с typed provenance и append-only corrections; питание,
тренировки, восстановление, coaching, intake и общий lifecycle ещё не
реализованы. Google Sheets остаётся authoritative source рабочих fitness-данных
до проверенного dual-run с PostgreSQL и утверждённого cutover.

## Основания

- Baseline, предоставленный оператором 2026-07-28.
- Фактический runtime и accepted staging evidence вертикали `WeightMeasurement`.

## Решения

- Эта страница отвечает за навигацию и состояние этапа; подробные правила и решения находятся на соответствующих канонических страницах.

## Открытые вопросы

- Полный behavior catalog Google Sheets и порядок оставшихся вертикалей DEV-023.

## Связанные материалы

- `../vision/overview.md`
- `../product/overview.md`
- `../domain/overview.md`
- `../architecture/overview.md`
- `../roadmap/overview.md`
