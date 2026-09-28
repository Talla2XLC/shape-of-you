# TASK-0141 — решение Coach по проверенному дневному контексту

## Цель

Передать Coach решение о тренировке сегодня на основе проверенных фактов,
включая Recovery и Training, сохранив исторические DailyAssessment snapshots.

## Утверждённое решение

- [ADR](../../../../../docs/adr/20260928-let-coach-decide-from-verified-daily-facts.md):
  новый versioned `DailyDecisionContext` без готового action/status, Coach
  решает по фактам и запросу человека.
- Старый `get_daily_assessment` и его completion остаются совместимыми
  историческими контрактами. Nutrition policy и пульсовые зоны вне задачи.

## Шаги

1. Создать typed read-only контракт и композицию текущих owner facts с
   согласованной Person-local датой, timezone и ревизией.
2. Переключить MCP Daily Coach и смежные read-back инструкции на новый контекст;
   сохранить старое чтение для совместимости, убрать обязательность его
   `hard stop` для новых решений.
3. Проверить недавние тренировки, Recovery reports, missing/stale data,
   exact A/B, завершённую неделю и legacy snapshots.
4. Провести typecheck/lint/build/tests, независимый Quality Review,
   обновить только затронутые Wiki страницы и выполнить Architecture Review.

## Критерии приёмки

- Новый ответ Daily Coach не получает готовый `recommendedAction`, status или
  обязательное разрешение тренироваться от API.
- Явные illness/injury reports, качество и время Recovery данных видны Coach;
  он решает с учётом этих фактов и неопределённости.
- Training варианты и A/B identity остаются проверенными; агент не создаёт
  неизвестное занятие или выполненный факт.
- Исторические DailyAssessment snapshots и feedback читаются без изменения
  смысла; автоматическое completion нового выбора не заявлено.
- Нет новой базы, миграции, калибровки зон, commit, push или deploy.

## Результат

Реализован `get_daily_decision_context` и одноимённый HTTP read: факты,
Recovery observations с source channel, временем и качеством, проверенная
версия программы и точные Training options без готового решения. Новый read
не пишет legacy snapshot. MCP направляет новые дневные решения Coach через
этот контекст; `get_daily_assessment` остаётся для исторических snapshots.
Согласованность даты, timezone, checksum, nextStep и active version
проверяется перед выдачей ответа. Пульсовые зоны не менялись.

Проверены переход недели, выполненная норма кардио, пропущенные дни,
Recovery concern, отсутствие timezone, смена фактов и версии программы,
историческое completion и отсутствие нового snapshot. Независимый Quality
Review принят. `pnpm --dir apps/api test`: 54 файла, 427 тестов прошли;
контракты и API собраны, typecheck, lint и docs validator прошли.

## Architecture Review

Проверено: решение не добавляет deployable service, таблиц или новых owner
границ; Training сохраняет authority для программы и A/B, Recovery — для
наблюдений, Coach — для текущего совета. Композиция использует существующие
domain reads и не дублирует правила в Wiki или новом persistent state.
Повторное чтение и checksum усложняют путь, но нужны для согласованного
снимка фактов; дальнейшее упрощение за счёт удаления этих проверок теряет
требуемую надёжность. Нового архитектурного расхождения с ADR не найдено.
