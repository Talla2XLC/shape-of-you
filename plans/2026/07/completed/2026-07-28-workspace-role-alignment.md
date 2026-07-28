---
title: Выравнивание ролей 4DreamTeam с canonical Markdown
status: completed
created: 2026-07-28
updated: 2026-07-28
related_roadmap_items:
  - DEV-027
---

# Выравнивание ролей 4DreamTeam с canonical Markdown

## Цель

Адаптировать инструкции workspace так, чтобы роли 4DreamTeam использовали
`docs/wiki/` и `docs/adr/` как единственный источник проектных знаний, не
изменяя 4DreamTeam, его storage layer или принятые lifecycle gates.

## Зафиксированные ограничения

- Не очищать, не переносить и не синхронизировать managed Wiki в SQLite.
- Не реализовывать Markdown backend и не создавать fork 4DreamTeam.
- Не менять storage layer.
- Не регистрировать `docs/` в `4dt-sources`.
- Не создавать export pipeline.
- Не возвращаться к выбору Wiki storage.
- Не создавать Git commit.
- До утверждения diff не изменять `AGENTS.md`.

## Анализ ролей

| Роль | Чтение знаний сейчас | Запись знаний сейчас | Зависимость от `4dt-wiki` | Минимальное workspace-переопределение |
| --- | --- | --- | --- | --- |
| `lead` | `4dt-search` по wiki и domain tools | Маршрутизация в `wiki` | Да, discovery и точные reads | Искать проектные знания через `rg` и читать точные файлы в `docs/` |
| `product` | Managed Wiki, board, memory, sources | Board timeline и task metadata | Да, read-only | Читать product knowledge из `docs/wiki/`, решения — из `docs/adr/` |
| `analytic` | Managed Wiki, sources, board | Board timeline и movement | Да, read-only | Использовать `docs/` для project knowledge; sources — только для настоящих исходных материалов |
| `developer` | Managed Wiki/search, board, sources | Код, тесты и board evidence | Да, read-only discovery | Использовать `rg`/точные `docs/` paths; сохранить handoff в `quality` и затем `wiki` |
| `quality` | Managed Wiki/search, board, sources | Только board acceptance/rejection | Да, read-only и managed validation assumptions | Проверять canonical metadata, links и status через `validate-docs.ps1`; не менять docs |
| `wiki` | Managed Wiki/search и approved sources | Managed pages и ADR через `4dt-wiki` | Полная | Сохранить acceptance gates и board report, но читать/писать canonical Markdown обычными file tools |
| `marketing` | Managed Wiki, board, sources | Внешние материалы и board notes | Да, read-only | Использовать canonical Wiki/ADR как accepted project knowledge |
| `devops` | Managed operational Wiki, sources, board | Runbooks через `4dt-wiki` | Полная для документации | Создавать спроектированные operational pages в canonical `docs/wiki/` и запускать validator |
| `release` | Board, Wiki, Git | Managed changelog и Wiki export | Полная для changelog/export | Обновлять `docs/wiki/changelog.md`, не выполнять export, включать validator в release checks |

Board, memory, source registry, approval gates, independent quality и timeline
evidence не требуют переопределения.

## Минимальное предлагаемое изменение

Изменить только корневой `AGENTS.md`:

1. Описать canonical documentation authority для всего workspace.
2. Зафиксировать managed Wiki как frozen legacy copy.
3. Запретить любому агенту использовать managed Wiki для discovery, чтения и
   записи проектной документации без явного решения оператора.
4. Не перечислять роли и не переопределять их обязанности, lifecycle или
   внутреннюю логику.
5. Сохранить override небольшим и удаляемым при появлении native support.

## Предлагаемый diff

```diff
--- a/AGENTS.md
+++ b/AGENTS.md
@@
- Канонические страницы редактируются обычными файловыми инструментами репозитория.
-- Не использовать встроенную роль записи managed Wiki или content-команды
-  `4dt-wiki` для проектных знаний.
-- `4dt-wiki` можно использовать только для readiness checks, одобренной
-  одноразовой миграции или явно разрешённой очистки. После очистки ожидаемое
-  число страниц равно нулю.
+Каждый агент и workflow использует canonical Markdown как источник проектных
+знаний.
+
+Managed Wiki 4DreamTeam является frozen legacy copy.
+
+Её запрещено использовать как источник проектных знаний для discovery,
+чтения, записи или архитектурных решений.
+
+Исключение требует явного решения оператора для конкретной операции и scope.
+
+Не регистрировать `docs/` в `4dt-sources`. Сохранить `sources/` как
+встроенную runtime boundary для отдельно одобренных исходных материалов.
+
+Если будущая версия 4DreamTeam нативно поддержит этот workflow, удалить
+избыточные workspace overrides, а не сохранять их.
```

## План выполнения после утверждения

1. Применить только показанный diff к `AGENTS.md`.
2. Запустить `scripts/validate-docs.ps1`.
3. Выполнить workspace pin-checks:
   - любой agent route использует canonical Markdown для project knowledge;
   - managed Wiki не используется для discovery, чтения или записи;
   - существующие role responsibilities и lifecycle gates не изменились.
4. Проверить, что `.4dt/db.sqlite3`, `4dt-sources` registry и installed
   4DreamTeam files не изменились.
5. Выполнить Architecture Review.
6. После принятия перенести план в `completed/`.

## Критерии приёмки

- Любой агент использует canonical Markdown для проектных знаний.
- Managed Wiki не используется для discovery, чтения или записи проектной
  документации.
- Wiki и ADR writes происходят только в canonical Markdown.
- Обязанности ролей и существующие lifecycle gates не переопределены.
- `docs/` не появляется в source registry.
- Validator проходит.
- Изменения ограничены `AGENTS.md` и этим планом.
- Нет fork, backend, export или storage изменений.

## Риски и совместимость

- Переопределение отдельных ролей быстро устареет. Поэтому override описывает
  только общий workspace contract.
- Legacy Wiki search может вернуть правдоподобный, но устаревший результат.
  Запрет его использования должен быть общим для любого агента и workflow.
- Future 4DreamTeam может добавить native Markdown support. Override должен
  быть удаляемым и не зависеть от внутренних команд или schema.

## Architecture Review до применения

1. **Избыточная сложность:** несколько общих workspace rules проще role
   overrides, source indexing, plugin, backend или fork.
2. **Микросервисность:** изменение касается только workspace instructions и не
   создаёт runtime boundaries.
3. **DDD:** domain model и bounded contexts не затрагиваются.
4. **Дублирование:** canonical authority остаётся в Wiki/ADR; `AGENTS.md`
   хранит только общий workspace contract; план хранит анализ и execution
   scope.
5. **Упрощение:** регистрация `docs/` как source не устраняет обращения ролей к
   wiki domain и добавляет index state, поэтому отклонена.

Архитектурных изменений и изменений обязанностей ролей не предлагается. Это
минимальная адаптация workspace contract к уже принятой storage architecture.

## Результат применения

- Утверждённый общий workspace contract применён к `AGENTS.md` дословно.
- Role-specific разделы и переопределения обязанностей не добавлялись.
- Canonical authority осталась в `docs/wiki/` и `docs/adr/`.
- Managed Wiki не читалась и не изменялась.
- `docs/` не регистрировался в `4dt-sources`.
- Installed 4DreamTeam files не изменялись.
- `.4dt/db.sqlite3` сохранил размер и timestamp во время validation.
- `.4dt/backups` отсутствует.
- Validator успешно проверил 23 Wiki-страницы, 12 ADR и 35 уникальных ID.
- Git commit не создавался.

## Architecture Review после применения

1. **Избыточная сложность:** применены только общие правила workspace; adapter,
   role copies, source index и дополнительная инфраструктура не создавались.
2. **Микросервисность:** runtime и deployable boundaries не затрагивались.
3. **DDD:** domain model, aggregates и bounded contexts не изменялись.
4. **Дублирование:** `AGENTS.md` описывает только authority и access policy;
   проектные знания остаются только в canonical Wiki/ADR.
5. **Упрощение:** более простой вариант не обеспечивает явного запрета на
   использование правдоподобной legacy-копии. Применённый contract является
   минимальным достаточным решением.

Новых архитектурных решений или причин менять утверждённый подход не
обнаружено.

## Состояние

Завершён. Workspace contract применён и проверен; план перенесён в
`completed/`.
