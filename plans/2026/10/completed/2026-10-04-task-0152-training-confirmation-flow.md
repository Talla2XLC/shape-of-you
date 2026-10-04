# TASK-0152 — подтверждение исторической тренировки через текущий контекст

## Цель и согласование

Оператор утвердил исправление сообщением «го» 2026-10-04: сервис не должен
задавать вопрос, ответить на который его write-проверка не позволяет.
Сценарий: подробная завершённая A записана по дню, Garmin пришёл отдельно,
пользователь спрашивает о следующем занятии через два дня.

## Authority и область

Исправление реализует действующие ADR о
[классификации](../../../../docs/adr/20260923-classify-imported-strength-activity-against-training-program.md),
[связывании](../../../../docs/adr/20260925-link-garmin-strength-with-recording-context.md)
и [V2 capture](../../../../docs/adr/20261002-capture-incomplete-facts-and-use-contextual-coach-replies.md).
Новых сущностей, контрактных полей, автоматического связывания или ослабления
Person/optimistic guards нет. expectedLocalDate остаётся датой проверяемой
проекции nextStep, а не датой события в тексте вопроса.

## Порядок

1. В текущем TrainingContext показать существующий pendingActivityLinkQuestion
   для конкретной исторической активности, блокирующей nextStep. Найти её
   независимо от historyLimit в ограниченном диапазоне policy week;
   применить существующие правила explicit pair и bounded options.
2. В MCP presenter предпочитать вопрос о точной паре отдельной A/B
   классификации. Явно передавать expectedLocalDate из nextStep.localDate
   при классификации и сохранять текущую дату при read-back.
3. Добавить MCP integration scenario с настоящим PostgreSQL и TrainingService:
   V2 manual capture, provider import, read через два дня, link confirmation,
   repeat, read-back, один occurrence и ожидаемая B. Отдельно проверить
   историческую классификацию без подробной сессии и stale guards.
4. Сначала запустить новый regression test на старом коде; подтвердить падение,
   затем исправить и проверить Training/MCP suites, typecheck/build/lint/docs.
5. Независимый Quality и Architecture Review; Wiki после приёмки, план
   перенести в completed.

## Критерии и границы

- Вопрос относится к exact id, а не выводится из имени/времени/очереди.
- Пользовательское подтверждение exact pair связывает две записи одного
  занятия; повтор безопасен, вопрос исчезает, занятие не считается дважды.
- Отдельная классификация сохраняет context-date guard и не обходит stale,
  смену программы, linked session или другое pending activity.
- historyLimit=1 не скрывает пару, которая блокирует текущую очередь.
- Тест проверяет конечный результат, не mocked success или текст инструкции.
- Scope не включает live writes, commit/push/deploy, refresh, сообщения в чат
  или отдельный LLM evaluator. Проверяем работу реальной MCP→Training→PostgreSQL
  цепочки; конкретный ответ внешнего ChatGPT остаётся отдельным canary.

## Статус

Завершено локально после независимой приёмки
task-0152-quality-acceptance-20261004 и Architecture Review.
Новый regression test на прежнем коде упал из-за отсутствия historical pair;
после исправления два MCP→Training→PostgreSQL сценария проходят. Квота из двух
силовых делает двойной учёт заметным: вместо закрытой недели ожидается B.
Ошибочная классификация по дате события остаётся not_pending; правильная
связь создаётся и повторяется безопасно, вопрос исчезает.
Training integration: 16/16, новый MCP integration: 2/2; 345 остальных unit
прошли в полном запуске, MCP suite 11/11 после обновления устаревшей текстовой
проверки. Typecheck/build API, contracts build, ESLint, docs и diff-check прошли.
Wiki обновлена после Quality. Нет новых архитектурных решений или миграций;
commit/push/deploy и live conversational canary не выполнены.
