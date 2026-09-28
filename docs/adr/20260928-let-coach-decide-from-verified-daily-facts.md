---
id: "decisions-20260928-let-coach-decide-from-verified-daily-facts"
kind: adr
title: "Передать решение о дневной тренировке Coach на основе проверенных фактов"
status: accepted
date: 2026-09-28
supersedes: []
superseded_by: null
tags:
  - architecture
  - coaching
  - recovery
  - training
---

# Передать решение о дневной тренировке Coach на основе проверенных фактов

## Context

`DailyAssessment` v1–v6 вычисляет `recovery_priority`, `recovery_first` и
`recommendedAction`. MCP требует считать их обязательным решением. Даже после
появления двух допустимых Training вариантов агент не решает, советовать ли
тренировку в конкретный день. Оператор утвердил границу, при которой сервис
поставляет проверенные факты и ограничения программы, а Coach принимает
контекстное решение. Существующие immutable snapshots и feedback нельзя
переосмыслить задним числом.

## Decision

1. Для нового Daily Coach чтения вводится versioned `DailyDecisionContext`.
   Оно содержит Person-local дату, проверенные дневные факты и coverage,
   current Recovery observations с качеством, временем, source channel и delivery state,
   active Training version id и точные Training options с A/B identity и недельными вариантами.
   Контракт не содержит `status`, `recommendedAction`, `alternatives` или
   флага разрешения тренироваться.
2. Coach принимает итоговое решение о тренировке по фактам, запросу человека
   и актуальному контексту, объясняя существенные основания и неизвестные
   данные. Явные сообщения о болезни и опасении травмы передаются без
   смягчения; неизвестное или устаревшее значение не превращается в норму.
   Coach не придумывает медицинский диагноз, неизвестную нагрузку или третье
   занятие. Когда данных недостаточно для ответственного совета, он уточняет
   обстоятельство или выбирает осторожную формулировку.
3. Training остаётся authority для active program, exact A/B, недельных квот,
   идентификации выполненных занятий и доступных вариантов. Coach не меняет
   Training факты и не выводит A/B из названия. `complete_today`,
   `week_complete` и `needs_classification` сохраняют фактический смысл.
4. `RecoveryAssessment.hardStop`, score и riskLevel остаются версионированными
   производными показателями и частью исторического v1–v6 контракта; новый
   Daily Coach путь не принимает их за обязательное решение. Он получает
   точные текущие Recovery observations. Старые `DailyAssessment` snapshots,
   feedback и completion продолжают читаться с прежним смыслом. Новый выбор
   Coach в разговоре не создаёт выполненный fact и не приписывается старому
   snapshot; автоматическое completion без записанного выбора не утверждается.
5. Новое чтение является read-only композицией существующих owner reads.
   Оно проверяет совпадение Person-local даты и timezone и повторно проверяет
   ревизию фактов и active Training version перед ответом. Новую сущность, таблицу, миграцию и
   deployable boundary не добавлять. Старый `get_daily_assessment` остаётся
   совместимым legacy read, но не является authority для новых Daily Coach
   решений. Изменение Nutrition policy и калибровка пульсовых зон вне задачи.

## Considered alternatives

### Оставить обязательный API `hard stop`, разрешив агенту только выбор занятия

Минимально меняет код, но нарушает утверждённую границу решения. Отклонено.

### Отдать агенту только сырые observations

Даёт свободу, но теряет проверенную A/B identity, provenance, coverage и
недельные ограничения. Отклонено.

### Дать versioned композицию фактов и Training вариантов

Сохраняет точность доменных данных и позволяет агенту принять контекстное
решение. Требует изменить текущую MCP orchestration и проверить совместимость
исторических снимков. Выбрано.

## Consequences

- Новые ответы Daily Coach перестают выдавать решение API за решение агента.
- Одни и те же факты могут привести к разным объяснимым советам с учётом
  запроса человека; reproducibility прежней детерминированной рекомендации
  больше не обещается для новых ответов.
- Исторические API-owned snapshots сохраняются; до отдельного решения о
  сохранении выбора агента новая разговорная рекомендация не получает
  автоматического observed completion.
- HTTP/MCP legacy reads остаются совместимыми, но инструкции Coach направляют
  новые дневные решения через `DailyDecisionContext`.

## Verification

- Контракт отвергает готовые action/status поля; наблюдения содержат время,
  качество и provenance-safe detail.
- Тесты проверяют явную болезнь/опасение травмы, пропущенные и устаревшие
  данные, совпадение дат источников, точную A/B очередь и недельные варианты.
- MCP тесты проверяют новый обязательный read для дневного решения и
  отсутствие обязательного `recovery_first`; старые snapshots читаются.
- Typecheck, lint, build, API tests, независимый Quality Review,
  Architecture Review и docs validator.

## Related material

- [Daily Assessment](20260914-own-daily-assessment-and-next-action-in-api.md)
- [Training options](20260928-let-coach-choose-safe-training-options.md)
- [Recovery](20260731-model-typed-recovery-observations-and-versioned-readiness-assessments.md)
- [Coaching current state](../wiki/domain/coaching-and-decision-support.md)
- TASK-0141
