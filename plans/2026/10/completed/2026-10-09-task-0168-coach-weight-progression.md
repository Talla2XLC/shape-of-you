# TASK-0168 — Shape of You как база знаний для Coach

## Статус и разрешение

Оператор уточнил направление: максимально снять ограничения и передать решения
агенту, сохранив Shape of You базой знаний. Этот обновлённый
[ADR](../../../../docs/adr/20261009-let-coach-propose-working-weight-from-history.md)
и план утверждены оператором 2026-10-09. Реализация и независимая Quality приняты; commit/push/deploy и персональные writes не разрешены
этим планом. Предыдущий проект с Recovery gate, bounded step, обязательным
training evidence и новой audit migration заменён.

## Продуктовый результат

Агент читает нужные знания, сам решает, рекомендует и сохраняет согласованные
изменения. Нет обязательных N тренировок, RIR каждого подхода, потолков
прибавки, today-ready/next-A-B допуска или ритуальных вопросов. Разговор может
быть естественным, а факты остаются достоверными и раздельными по владельцам.

## Объём

1. После утверждения ADR составить точный inventory artificial gates:
   MCP instructions/presenters, Training/Coaching paths, contracts и rules
   прямой записи/коррекции. Отдельно отметить product eligibility и technical
   integrity; не оставить прежнюю формулу в командной границе нового пути.
2. Оформить supersession только затронутых положений canonical ADR. Wiki
   остаётся описанием действующего кода до Quality acceptance.
3. Маршрутизировать подтверждённое изменение через existing
   save_confirmed_training_program/immutable version. Агент переносит неизменяемые
   поля active snapshot, меняет согласованные поля и сохраняет optimistic
   expectation. Не создавать новые proposal/audit entities или migration.
4. Убрать specialized progression/proposal/apply из обязательного Coach пути.
   Сохранить compatibility historical audit/replay без выдачи legacy eligibility
   за полномочия нового решения. Объяснения legacy результата не становятся
   запретом universal confirmed save.
5. Разрешить выбор контекста самим агентом: available facts, отдельные reads,
   история с пагинацией и сообщения пользователя. Missing metric/full-context
   failure не блокирует весь ответ. Не выдавать неизвестные факты за известные.
6. Убрать mandatory вопросы об отсутствии боли, явном RIR и повторном согласии,
   когда точное согласие уже дано. Routine facts/corrections по сообщениям
   сохранять без нового вопроса; минимальное уточнение только при существенной
   неоднозначности содержания, идентичности или разрешённого изменения.
7. Сохранить ownership/auth, contracts types/units/refs, immutable corrections,
   concurrency, атомарность, replay/dedupe и readback неизвестного write outcome.
   Удаление product gate не означает удаление безопасности хранения.
8. Сценарные unit/contract tests и isolated PostgreSQL integration проверяют
   confirmed program updates, preservation остальных полей, old audit/replay,
   direct approval и отсутствие hidden eligibility calls. Проверить discovered
   changes в факт-записи и соответствующие schema/runtime paths.
9. Независимая Quality; Architecture Review (сложность, service boundaries,
   domain/data ownership, отсутствие дублирования authority, возможность
   упрощения); affected Wiki; API typecheck/build/lint и docs validation.
   После принятия перенести план в completed. Live canary — настоящая тренировка.

## Критерии приёмки

- Backend не разрешает и не запрещает спортивное решение по числу сессий,
  количеству evidence, RIR, Recovery score, размеру прибавки, next A/B или дню.
- Нет mandatory training-history prerequisite и fixed progressionIncrement.
  Ноль истории — известная неопределённость, не техническая ошибка записи.
- Прямое «поставь 25 кг» позволяет сохранить ровно это изменение без второго
  approval вопроса. Согласованные изменения нескольких параметров допустимы.
- Прочие параметры программы сохранены. Facts/notes не получают придуманные
  численные значения. Реальная принадлежность записи проверена.
- Технические conflicts не приводят к дублированию или молчаливому overwrite.
  Повтор в пределах прежнего точного согласия возможен после актуального read.
- Compatibility старого audit/replay проверена; новых таблиц/миграций нет.
- Tests подтверждают routing/contracts, а не обещают поведение внешней модели.
  Независимая Quality и Architecture Review пройдены до завершения.

## Ограничения результата

Runtime сбой чтения остаётся отдельной задачей. Снятие ограничений backend не
отменяет общие/медицинские правила внешней модели и не гарантирует правильность
её рекомендаций. Последующие commit/push/staging delivery требуют разрешения
и проверки exact CI/CD run до readiness/smoke.

## Результат проверки

- Универсальный MCP save использует существующую техническую transaction без
  новых сущностей, таблиц, миграций и сервисов. Legacy команды остаются только
  compatibility dispatch, отсутствуют в discovery нового Coach.
- Убраны eligibility инструкции и обязательные read sequences, повторное согласие
  на точное уже согласованное изменение. Canonical successful result достаточно
  для подтверждения записи; uncertain outcome и concurrent state проверяются.
- API unit: 407/407. PostgreSQL: Training 18/18, MCP composition 12/12.
  Проверены zero-history 20→30 kg, несколько параметров, unknown RIR/increment,
  actual foreign Person reference, replay/conflict, untouched B/cadence,
  body_weight/assisted после completed A. Это isolated synthetic tests.
- API typecheck/build и scoped ESLint прошли. Docs validator: 54 Wiki / 137 ADR.
- Independent Quality: task-0168-quality-acceptance-20261009. Architecture Review
  пять пунктов: task-0168-architecture-review-20261009. Финальная Wiki QA принята: task-0168-docs-quality-acceptance-20261009.
  Все критерии закрыты; board release/accepted, доставка отдельно.
- Runtime unclassified read failure не исправлен этой задачей. Проверка поведения
  внешнего агента отложена до реальной тренировки по решению оператора.
- Оператор закоммитил и запушил `2ff996b9d4e15927347250216ac64497e02018ef`,
  затем отдельно разрешил мониторинг и применение. Publish `37905952320`
  и Promote `37907104925` прошли. Pipeline staging выполнил штатный API
  migration step, readiness и smoke; Identity reuse без Identity migration.
  После выкладки оба персональных context reads успешны. Причина прежнего
  отказа не установлена. Локально добавлена только документация доставки.
