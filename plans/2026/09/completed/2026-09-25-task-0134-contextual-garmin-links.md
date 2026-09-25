# TASK-0134 — контекстная связь подробной силовой и Garmin

## Цель

Связывать `WorkoutSession` и Garmin `ExternalActivity` с общим generic
названием, когда Person подтвердил практику записи, а одна current пара
однозначно совпадает по дате, точному началу и типу. В сомнительных случаях
задавать вопрос о конкретной паре.

## Решение и границы

- Применить [ADR](../../../../docs/adr/20260925-link-garmin-strength-with-recording-context.md).
- Добавить Person-owned подтверждение generic Garmin recording mode, не
  привязывая title к A/B; сохранить optional venue с подробной сессией.
- Переиспользовать Training association, import reconciliation и
  DailyAssessment deduplication.
- Не менять отдельную `ExternalActivity.classification` и не создавать
  подробные сессии из Garmin summary.
- Без отдельного разрешения не выполнять commit, push, deploy, staging
  migration или live data write.

## Шаги

1. Оформить TASK-0134 в 4DreamTeam с критериями и developer plan.
2. Добавить schema/contracts/API/MCP для Person-confirmed recording mode и
   необязательного venue; записывать или отзывать mode только по прямому
   утверждению Person.
3. Расширить pure matcher третьим basis и текущую transactional reconciliation.
4. Отдать агенту неоднозначную пару как конкретный вопрос, не назначая A/B
   из Garmin title. Учесть late import, corrections, manual precedence.
5. Добавить unit, PostgreSQL integration и migration tests. Выполнить
   относящиеся проверки.
6. Передать на независимый Quality Review, провести Architecture Review и
   после acceptance обновить затронутые current-state Wiki pages.

## Критерии приёмки

- Подтверждённый generic Garmin mode + подробная силовая с exact start +
  одна совместимая current activity дают link для Ahilej A/B и тренировки
  вне программы, независимо от порядка поступления.
- Без подтверждённого режима, при date-only session, несовместимом типе,
  двух кандидатах, конфликтующей classification или explicit occupancy
  auto-link не создаётся; время или место сами по себе не достаточны.
- Замена/отзыв режима и исправление фактов переоценивают auto-links, manual
  link не переписывается, повторный sync идемпотентен.
- В неоднозначном случае агент получает конкретный вопрос о паре; ответ
  сохраняется как explicit association, а не как правило A/B.
- Training и DailyAssessment считают связанную пару одним occurrence без
  изменения numeric load ownership и classification.
- Миграция, docs validation, тесты и independent Quality проходят.
