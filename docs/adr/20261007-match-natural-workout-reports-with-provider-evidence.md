---
id: decisions-20261007-match-natural-workout-reports-with-provider-evidence
kind: adr
title: "Сопоставлять естественные отчёты о тренировках с provider evidence"
status: accepted
date: 2026-10-07
supersedes: [decisions-20260925-link-garmin-strength-with-recording-context]
superseded_by: null
tags:
  - architecture
  - training
  - integrations
---

# Сопоставлять естественные отчёты о тренировках с provider evidence

## Context

TASK-0166. Оператор уточнил реальные сценарии: «пришёл в спортзал, дай
программу», сообщения о выполненных подходах, «вчера сделал B» постфактум.
Специальная фраза начала и ручное указание часов не являются пользовательским
контрактом. TASK-0165 доставил доступные MCP schemas и receipt clock для
явного начала, но основной retrospective сценарий не закрыт.

В действующем matcher manual session без occurredAt не допускается к
recording-context association. Provider start_date сохраняется корректно;
наличие времени у активности не доказывает, какой manual session она описывает.

Прежнее предложение date-only matching было отклонено, когда ожидалось,
что собственное начало всегда доступно из чата. Здесь эта предпосылка снята
оператором. Предлагаемое ниже ослабление association является новым решением:
оно не считается одобренным прошлым «го» и не переименовывает rejected ADR.

## Decision

Оператор одобрил конкретный ADR и план сообщением «го». Приняты один
server-owned association rule и уточнение Coach workflow:

1. «Пришёл в зал, дай программу» читает контекст и выдаёт программу. Это
   присутствие/намерение, не точное начало и не выполненная тренировка.
   Не создавать completed session или performed sets из выданной программы.
   Текущее выполнение сохраняется по сообщениям о фактически сделанных
   подходах; общепринятые выражения вроде «тренируюсь», «первый подход сделал»
   не требуют команды сохранения. Explicit start receipt остаётся доступным,
   но не является основным или обязательным путём.
2. «Сделал B» сохраняет completed факт с известной датой и точной program
   identity, когда B однозначно определена из текущего контекста. Sets остаются
   неизвестными, если пользователь их не сообщил. Retrospective время
   сообщения не становится временем старта. При неизвестном дне допустимо
   одно необходимое уточнение даты, но не обязательных часов/минут.
3. Для manual completed session с неизвестным occurredAt добавить association
   по единственной совместимой силовой паре на Person-local дату. Подробный
   факт должен содержать performed strength evidence или точную immutable
   program workout identity, явно названную в отчёте. Запрос программы сам по
   себе такого completed evidence не даёт.
4. External сторона: current Garmin-attributed Intervals activity, exact
   Person-confirmed recording mode title, no distance, duration >=600 seconds.
   Conflicting classification, другая program identity или explicit occupancy
   блокируют путь. A/B принадлежит manual report, не generic Garmin title.
5. Проверять полную current дату и correction lineage, не historyLimit и не
   только свободные записи. При нескольких completed strength reports или
   совместимых external strength activities не создавать новый day link.
   При известных временах сохранять действующую tolerance 15 минут: day rule
   никогда не обходит явное противоречие timestamp.
6. Сохранять association с отдельным basis `reported_strength_day` и policy
   `automatic-activity-link-v4`; additive API migration расширяет существующий
   CHECK. Explicit links и v2/v3 остаются совместимы. Late imports/corrections
   и отзыв recording mode пересчитывают auto-links. Поздний второй кандидат
   снимает v4 auto-link, но не explicit link. Это продуктовая эвристика с
   явно сохранённым основанием, а не доказательство source identity.
7. Manual occurredAt и SourceReference не переписываются provider временем.
   После связи Coach использует начало/конец linked activity как provider
   evidence, а подробные упражнения — как user evidence; нагрузка и cadence
   учитывают занятие один раз. Для ambiguous пары задаётся конкретный вопрос.

После Quality acceptance recording-context ADR superseded этим решением;
остальные положения прежней политики сохранены, affected Wiki обновлена.

## Considered alternatives

- Только расширить распознаваемые фразы начала: улучшит ongoing сценарий,
  но отчёт постфактум всё равно останется без manual start и без автосвязи.
- Каждый раз спрашивать время или подтверждение пары: сохраняет прежний
  matcher, но не удовлетворяет требованию уточнять только неоднозначность.
- Связать по одной дате без type/mode/program/uniqueness проверок: слишком
  широкая эвристика; не предлагается.
- Предложенное ограниченное day rule: закрывает retrospective сценарий без
  выдуманного времени. Компромисс — возможная ошибка ассоциации, если второе
  занятие ещё не импортировано; компенсируется пересчётом при поздних данных.

## Consequences

Нет новой entity, сервиса или хранения chat history. Требуется миграция
существующего association CHECK и versioned matching policy. Неизвестное
время ручного факта остаётся неизвестным даже при известном provider времени.
Отчёт без sets может связаться при явно указанном exact program workout,
но не создаёт records или progression evidence.

Историческая ambiguity может появиться после позднего импорта. Server tests
проверяют сохранение и корреляцию; живой conversation canary отдельно проверяет
выбор инструментов моделью. Доставка и live writes имеют отдельные разрешения.

## Verification

- Unit: date-only completed с sets; completed exact B без sets; planning и
  in_progress не подходят; unknown mode, wrong type/date, classification
  conflict, multiple reports/imports и known time disagreement не обходятся.
- PostgreSQL: import-first/report-first, dedupe/correction lineage, late second
  activity/session, revoke mode, explicit occupancy, один cadence/load факт.
- MCP: programme request не записывает performed work; partial reports не
  копируют программу; retrospective B без start сохраняется и связывается.
  Примеры «в зале, что делать», «сделал первый подход», «вчера отработал B».
- Migration: clean/upgraded journal, v2/v3/explicit compatibility, identifiers
  <=63 UTF-8 bytes; no generated identifier truncation.
- Independent Quality, Architecture Review, accepted canonical Wiki alignment,
  docs validator; live model canary не заменяется проверкой строк prompt.

## Related material

- [Recording-context policy](20260925-link-garmin-strength-with-recording-context.md).
- [Отклонённое раннее предложение](20261007-link-unique-date-only-strength-recordings.md).
- [Explicit receipt capture](20261007-capture-reported-workout-start-time.md).
- [Training API](../wiki/api/training.md).
- [План TASK-0166](../../plans/2026/10/completed/2026-10-07-task-0166-natural-workout-reports.md).
