# TASK-0135 — безопасная прогрессия Ahilej A/B

## Цель

Дать Coach проверяемый совет для следующей такой тренировки по фактическим
подходам, весам, повторениям, RIR и текущему восстановлению: сохранить
назначение, добавить повторения или предложить небольшой шаг веса.

## Утверждённое решение

- Применить [ADR](../../../../../docs/adr/20260925-explain-session-backed-training-progression.md):
  вес после двух последовательных сопоставимых подробных сессий той же A/B;
  повторения после одного подтверждённого результата в пределах диапазона.
- `WorkoutSession` — единственный источник выполненных sets. Garmin summary
  может объяснять occurrence и A/B classification, но не вес, reps или RIR.
- Training рассчитывает typed read-only projection; Coaching применяет
  текущий Daily Assessment Recovery gate и отдаёт результат Coach.
- Предложение, принятие inactive draft и активация программы — отдельные
  действия. Не выполнять runtime write для действующей Ahilej A/B.

## Шаги

1. Зафиксировать продуктовые и аналитические критерии в TASK-0135 через
   `4dt-board`; описать developer plan до изменения кода.
2. Реализовать общий строгий Training predicate и read-only guidance для
   точных version/workout/exercise, выровнять старый progression candidate.
3. Добавить Coaching composition с Recovery precedence и безопасным
   представлением через API/MCP для обычного Coach.
4. Проверить pure, repository, API и MCP сценарии, включая недостаточные и
   противоречивые данные, исправления сессий и отсутствие мутации программы.
5. Провести независимый Quality Review и Architecture Review; после
   acceptance обновить затронутые current-state Wiki pages.

## Критерии приёмки

- Coach объясняет `hold`, `add_reps`, `add_weight` либо недостаточность
  evidence для упражнения следующей точной A/B без угадывания данных.
- Прибавка веса требует двух последних сопоставимых подробных сессий с
  назначенным весом, верхним пределом reps и допустимым RIR; шаг задан
  программой и ограничен ADR. Повторы не выходят за текущий диапазон.
- Нет прибавки при missing/conflicting set evidence, неверной версии или
  позиции, будущей дате, двух одинаковых назначениях без однозначной связи,
  несовместимом load basis либо неблагоприятном или недостаточном текущем
  Recovery context.
- Garmin summary не создаёт подходы; исправленные сессии пересчитываются;
  старый candidate и acceptance следуют тому же строгому правилу.
- Ни запрос, ни совет не создают/активируют новую версию и не меняют active
  Ahilej A/B. Коммит, push, deploy и migration execution вне scope.
- Тесты, independent Quality, Architecture Review и docs validation пройдены.
