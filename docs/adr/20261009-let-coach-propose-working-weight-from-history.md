---
id: decisions-20261009-let-coach-propose-working-weight-from-history
kind: adr
title: "Shape of You хранит знания, Coach принимает решения"
status: accepted
date: 2026-10-09
supersedes: [decisions-20261006-allow-single-session-high-reserve-progression, decisions-20261007-allow-single-session-working-weight-audit, decisions-20260927-invoke-progression-in-ordinary-next-strength-coaching, decisions-20260928-let-coach-decide-from-verified-daily-facts, decisions-20260928-let-coach-choose-safe-training-options, decisions-20260912-persist-confirmed-training-programs-through-one-mcp-command, decisions-20260925-explain-session-backed-training-progression, decisions-20260929-confirm-working-weight-increase-atomically, decisions-20260927-record-qualitative-wellbeing-in-recovery-and-reassess, decisions-20260923-materialize-confirmed-training-program-cadence-atomically]
superseded_by: null
tags:
  - training
  - coaching
  - architecture
---

# Shape of You хранит знания, Coach принимает решения

## Context

Оператор уточнил целевую архитектуру: максимально снять продуктовые ограничения
backend и оставить Shape of You базой знаний для агента. Предыдущий проект
этого ADR сохранял Recovery gate, шаг программы, потолки 10%/5 kg и требование
хотя бы одной завершённой сессии. Это не соответствует уточнённому запросу.

Backend уже хранит Person-scoped immutable facts, corrections, program versions
и source provenance. Existing save_confirmed_training_program может атомарно
сохранять согласованную программу; отдельная команда working-weight change
добавляет eligibility формулы. MCP инструкции содержат дополнительные запреты
по текущему Recovery, числу тренировок, next A/B и обязательным последовательностям
чтения. Удаление только одного порога не меняет эту модель authority.

## Decision

Оператор утвердил следующую границу: агент отвечает за интерпретацию и рекомендации;
Shape of You отвечает за достоверное хранение, получение и изменение данных.
Решение принято 2026-10-09. Supersession заменяет только правила полномочий
и orchestration нового Coach в перечисленных ADR. Хранение, historical
snapshots, compatibility commands и владельцы данных сохраняются.

1. Агент выбирает рекомендации и изменение программы: вес и его шаг, подходы,
   повторения, RIR, cadence, substitutions и последовательность занятий.
   Backend не вычисляет eligibility решения и не запрещает его из-за числа
   сессий, величины прибавки, missing RIR, Recovery status, completed week/day,
   next A/B, отсутствия тренировочной истории или другого продуктового порога.
   progressionIncrementKg становится сведением о программе, не ограничителем.
2. Отсутствующие показатели и неполная история являются данными о неизвестности.
   Агент выбирает достаточный контекст под запрос, учитывает прямые сообщения
   пользователя и объясняет существенную неопределённость. Сбой составного read
   не создаёт обязательного запрета на полезный ответ или иной доступный read.
   Он не доказывает отсутствие Garmin данных. Нельзя выдавать неизвестное за
   измеренный факт, успешную запись или проверенное текущее восстановление.
3. Количественные facts, notes, qualitative reports, source provenance и
   comparisons доступны агенту без API training permission. Он сам выбирает
   релевантную историю с пагинацией. Отчёты «легко» и «пришёл в зал» не требуют
   искусственной формулировки или придуманных чисел. Разные тренажёры/смыслы
   веса сохраняют разные identities; агент может сравнивать их с объяснением,
   а backend не выдаёт такое сравнение за фактическую идентичность.
4. Согласие пользователя разрешает соответствующее изменение программы.
   Прямое «поставь 25 кг» уже содержит согласие; не требуется ритуальное
   «да», отдельный вопрос об отсутствии боли или повторный пересказ полной
   программы. Если агент только предлагает существенное изменение, он получает
   согласие один раз. Согласие и последняя формулировка пользователя определяют
   объём записи; backend не оценивает физиологическую правильность решения.
   Routine факт записи и correction по сообщению не получают нового approval gate.
5. Для подтверждённых изменений используется existing
   save_confirmed_training_program и существующая immutable версия. Агент
   изменяет только согласованные поля прочитанного active snapshot и передаёт
   optimistic expectation; оставшиеся поля сохраняет. Existing version note
   может содержать rationale без обязательного текста/списка evidence для допуска.
   Новый prepare lifecycle, proposal entity, audit evidence table и миграция
   из предыдущего проекта ADR отменяются как лишние для этой границы.
6. Existing специализированные progression/proposal/apply tools перестают быть
   разрешающей authority Coach. Основной путь идёт через универсальный
   подтверждённый program save. Legacy audit rows сохраняются без переписывания;
   historical reads/replay сохраняют прежний смысл. Их compatibility surface
   не должна оставаться обязательным маршрутом нового Coach. Если нужен compact
   patch вместо complete snapshot, это отдельное упрощение контракта, не gate.
7. Backend сохраняет техническую целостность: authorization/Person ownership,
   типы и единицы, ссылочную целостность, доступность адресуемой записи,
   версии и optimistic concurrency, immutable correction chains,
   атомарность и идемпотентность. Невозможный объект, foreign Person или
   конфликт актуальной записи не сохраняется. Такие проверки не кодируют
   «достаточно ли восстановился» или «достаточно ли тренировок».
8. При concurrency conflict агент перечитывает изменившиеся поля. Если точное
   принятое изменение всё ещё применимо и ничего существенного не изменилось,
   повторяет в пределах имеющегося согласия. Новое согласие нужно только при
   существенном изменении предложения, не при каждом техническом retry.
   Неопределённый write outcome сначала проверяется чтением, чтобы не создать дубль.
9. Backend fact projections, deterministic dedupe/linking и completeness labels
   остаются механизмами учёта, а не разрешениями тренироваться или менять план.
   Любая derived recommendation, score или target передаётся с происхождением
   и статусом, без скрытого mandatory gate. Legacy assessments — historical
   facts, не сегодняшнее решение. Медицинские/общие правила поведения самой
   внешней модели это решение не отменяет и не обещает отменить.
10. Требуется inventory всех artificial gates в MCP инструкции, contracts,
    Coaching/Training и смежных write paths. Применить границу к обнаруженным
    местам: прежде всего progression, Recovery и Training flow, затем прямому
    факту записи/коррекции. Не превращать семантическую неполноту в техническую
    невалидность; не ослаблять authorization и не создавать вымышленные facts.

## Considered alternatives

- Сохранить формулы и добавить исключения: меньше изменений, но сохраняет backend
  в роли тренера и требует всё новых условий. Не выполняет уточнённый запрос.
- Агент рассуждает, backend повторно разрешает по Recovery/step/evidence:
  прежний проект; снятие одного ограничения оставляет остальные. Отклонён.
- Агент принимает решения, backend обеспечивает знания и целостность записей:
  выбранный вариант. Меньше новых сущностей; поведение и качество рекомендаций
  зависят от модели и доступного контекста. Нужны сценарные проверки.
- Полностью бесструктурное хранение и отсутствие ownership/version checks:
  разрушает факты и допускает смешение пользователей/дубли. Не соответствует
  роли надёжной базы знаний и не требуется запросом.

## Consequences

Система перестаёт подменять рассуждение Coach eligibility формулами. Убираются
избыточные вопросы и обязательные цепочки tool calls. Нет новой доменной сущности
или planned migration. Полный program snapshot сохраняет существующий контракт,
но требует аккуратного переноса неизменяемых полей; его надёжность проверяется.

Передача решений модели уменьшает их воспроизводимость: одна и та же история
может дать разные рекомендации. Backend не гарантирует правильность rationale.
Авторство фактов, неизвестность и фактический результат writes остаются явными.
Runtime read failure TASK-0167 требует отдельного расследования; эта архитектура
не устраняет неисправность, но убирает лишний глобальный запрет при её проявлении.

## Verification

- Ноль/одна/много сессий, missing RIR/Recovery, qualitative reports, unknown шаг,
  прибавка больше 10% или 5 kg, bodyweight/assisted и пользовательский выбор:
  ни один продуктовый порог не блокирует structurally valid confirmed save.
- Изменение сразу после completed A/week, будущая программа и несколько явно
  согласованных параметров; никаких обязательных next B или today-ready flags.
- Прямое согласие не вызывает второй вопрос; факты записи не требуют нового
  согласия. Существенно изменённое предложение требует нового согласия.
- Foreign Person/refs, неизвестные IDs, противоречивые units, stale snapshot,
  concurrent update и lost acknowledgement сохраняют технические гарантии.
- Legacy audit/history/replay сохранены. Нет новых fictitious sessions/sets.
- Независимая Quality, пять пунктов Architecture Review, affected Wiki после
  принятия, docs validator. NLP canary при настоящей тренировке, без фиктивной.

## Related material

- [Прежняя политика прогрессии](20261006-allow-single-session-high-reserve-progression.md).
- [Прежний специализированный audit](20261007-allow-single-session-working-weight-audit.md).
- [Coach по проверенным фактам](20260928-let-coach-decide-from-verified-daily-facts.md).
- [Training](../wiki/domain/training-and-performance.md).
- [План TASK-0168](../../plans/2026/10/completed/2026-10-09-task-0168-coach-weight-progression.md).
