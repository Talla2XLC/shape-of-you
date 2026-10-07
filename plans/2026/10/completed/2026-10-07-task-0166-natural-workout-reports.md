# TASK-0166 — естественный workout report и provider association

## Статус

Product intent одобрен «го»: специальные фразы и ручные часы не требуются.
Конкретный ADR и implementation plan отдельно одобрены следующим «го».
Реализация завершена и принята независимой Quality. Commit/push/deploy
остаются отдельными gates; новая миграция пока проверена только в isolated PostgreSQL.

[Предлагаемое решение](../../../../docs/adr/20261007-match-natural-workout-reports-with-provider-evidence.md).

## Объём реализации после одобрения

1. Уточнить MCP descriptions и per-result Coach policy: programme request —
   planning, реальные sets — partial performed report, retrospective завершение
   — completed без invented start. Не копировать предписания в performed sets.
2. Добавить ограниченное day association для manual completed report с strength
   evidence или exact named program workout, confirmed Garmin mode и единственной
   current совместимой парой полной даты. Не обходить known timestamp conflict.
3. Новый basis/version и additive CHECK migration; существующие explicit/v2/v3
   сохраняются. Смена mode, corrections и поздний второй кандидат пересчитывают
   auto-links; explicit links не отзываются новым правилом.
4. Provider timestamp остаётся у linked activity; manual temporal precision не
   повышается искусственно. Общие consumers используют существующую association
   для единого cadence/load и отдельно actual performed evidence для progression.
5. Meaningful unit/MCP/isolated PostgreSQL tests по Verification ADR, static
   identifier byte gate, typecheck/build/lint, relevant regression suites.
6. Независимая Quality и Architecture Review. После acceptance обновить только
   affected Training Wiki и необходимые ADR supersession links; docs validator.
7. Commit/push/deploy и live conversational canary после отдельных разрешений.

## Альтернативы для решения оператора

- Ограниченное day association (предлагается): автоматическая связь при одном
  совместимом занятии; остаётся риск ещё не импортированного второго занятия.
- Сохранить точное manual time обязательным: отчёт сохраняется, но агент
  продолжает спрашивать подтверждение даже при единственной provider activity.

## Проверяемый пользовательский результат

«Пришёл в зал, дай программу» не создаёт выполненную тренировку.
«Сделал первый подход» сохраняет только известное выполнение.
«Вчера сделал B» без времени/sets сохраняет completed exact B, связывает одну
совместимую provider activity и использует её время как provider evidence.
При двух тренировках не угадывает. Любой результат локальных tests не обещает
исполнение моделью: живой canary указан отдельно.

## Результат и проверка

Реализованы natural-report MCP guidance, `reported_strength_day` / v4,
полная population даты, отзыв derived links при конкурирующих фактах,
сохранение manual temporal precision и additive CHECK migration.
Новые сущности, deployable boundaries и источники данных не добавлены.

394 unit tests и 202 PostgreSQL integration tests, включая 77 migration tests
и все 59 upgrade prefixes,
API typecheck/build/scoped lint прошли. Регрессионные integration suites
проверены на synthetic PostgreSQL; четыре Docker startup timeout при полном
параллельном запуске устранены повтором с двумя workers. Старый тест вопроса
для единственной пары обновлён на действительно неоднозначный случай.

Независимая Quality: `task-0166-natural-report-quality-20261007`,
33 unit + 106 PostgreSQL checks, без замечаний.
Architecture Review: `task-0166-architecture-review-20261007`;
лишняя сложность, premature services, DDD/ownership, duplication и возможности
упрощения проверены. Сохранены existing entities и derived association.
После acceptance обновлены affected Wiki и ADR supersession.

## Оставшиеся delivery gates

Staging delivery новой версии не выполнена. Новая migration authored и verified
в isolated tests; она не committed, не pushed и не применена delivery pipeline
к staging. Live conversational canary с реальной моделью остаётся отдельной
проверкой после выкладки; локальные MCP tests его не заменяют.
