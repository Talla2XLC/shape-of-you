---
title: Миграция managed Wiki в канонический Markdown
status: completed
created: 2026-07-28
updated: 2026-07-28
related_roadmap_items:
  - DEV-027
---

# Миграция managed Wiki в канонический Markdown

## Цель

Перенести проектные знания Shape of You из managed Wiki 4DreamTeam в обычные
Markdown-файлы под Git, сохранив 4DreamTeam для board, memory, sources и
workflow.

## Принятое решение

- `docs/wiki/**/*.md` — единственный канонический источник Wiki.
- `docs/adr/**/*.md` — единственный канонический источник ADR.
- Managed Wiki 4DreamTeam после проверенной миграции не используется как
  хранилище содержательных страниц.
- Существующие 32 managed-страницы временно сохраняются в `.4dt/db.sqlite3`
  как legacy-копия на период практической проверки Markdown workflow.
- Возможная очистка рассматривается только отдельной будущей задачей после
  периода эксплуатации и нового явного решения.
- Параллельные содержательные источники истины запрещены.

## Ограничения

- Не создавать business source code, apps, services, packages, infrastructure,
  package manifests, Docker, PostgreSQL или Drizzle schemas.
- Не изменять board, memory и source registry без необходимости.
- Не удалять `.4dt/db.sqlite3`.
- Не очищать managed Wiki до отдельного подтверждения оператора.
- Не выполнять Git commit.
- Не переносить этот план в `completed/` до финального review.

## Объём работ до destructive gate

1. Получить полный JSON export текущих 32 managed Wiki-страниц.
2. Преобразовать ADR в `docs/adr/`, остальные страницы — в `docs/wiki/`.
3. Сохранить идентификаторы, содержание, статусы, теги, связи и логические пути.
4. Добавить canonical templates для Wiki и ADR.
5. Создать read-only validator без renderer, sync, manifest и Wiki index.
6. Создать root README, documentation guide, source-boundary guide и
   `.gitignore`.
7. Обновить `AGENTS.md` под canonical Markdown workflow.
8. Зафиксировать принятые архитектурные решения в canonical ADR без
   дублирования полного текста в других документах.
9. Проверить полноту, ссылки, структуру и Git-visible diff.
10. Выполнить Architecture Review.
11. Проверить типовые Markdown workflow без изменения рабочего набора
    документации.

## Вне объёма текущей фазы

- Очистка таблиц `wiki_*` в `.4dt/db.sqlite3`; она сознательно отложена.
- Реализация MarkdownStore или fork 4DreamTeam.
- Регистрация `docs/` в `4dt-sources`: при текущем объёме основным поиском
  остаются Git, IDE и `rg`.
- Автоматическое восстановление board или memory из Markdown.

## Проверка эквивалентности

Для каждой исходной managed-страницы сверяются:

- logical path и canonical path;
- `id`;
- title;
- status с документированным преобразованием enum;
- все исходные section bodies;
- tags;
- относительные связи;
- присутствие страницы в итоговом наборе.

Исходные managed ADR используют универсальные Wiki-секции. При миграции они
переносятся в ADR-секции с явными подзаголовками, чтобы ни один исходный блок
не был потерян.

## Критерии готовности до очистки

- Все 32 managed-страницы представлены в canonical Markdown.
- Новые принятые решения оформлены отдельными ADR.
- Validator завершается успешно.
- Broken links и несовместимости перечислены.
- Mapping managed path → canonical path сформирован.
- Managed Wiki по-прежнему содержит 32 страницы.
- Board, memory и sources остаются ready.
- Architecture Review выполнен.
- Практические сценарии canonical Markdown проверены в изолированном каталоге.

## Политика резервного копирования

Repository bootstrap не создаёт `.4dt/backups` и не определяет стратегию
резервного копирования SQLite. Локальный migration export удалён. Backup policy
для NAS, Git, restic или другого средства будет спроектирована отдельно до
любых необратимых действий.

## Результаты недеструктивной фазы

- 32 из 32 managed-страниц сопоставлены с canonical path.
- Для всех 32 страниц canonical-файл существует и сохраняет исходный `id`.
- Созданы 23 Wiki-страницы и 12 ADR; три ADR фиксируют решения, принятые после
  исходного export.
- `scripts/validate-docs.ps1` проверяет структуру, metadata, ID, статусы,
  секции, ADR naming/date, UTF-8, ссылки, conflict markers, чувствительные
  ссылки и признаки секретов.
- Validator проходит из произвольной текущей директории:
  23 Wiki-страницы, 12 ADR, 35 уникальных ID.
- Managed Wiki остаётся ready и содержит 32 страницы.
- Board, memory и source registry остаются ready.
- `.4dt/backups` удалён; repository не навязывает backup policy.
- Cleanup managed Wiki и Git commit не выполнялись.

## Практическая проверка Markdown workflow

Проверка выполнена в изолированной временной копии без тестовых файлов в
workspace:

- существующая Wiki-страница изменена;
- новая Wiki-страница создана по canonical template;
- новый ADR создан по canonical template;
- взаимные относительные ссылки разрешены;
- `rg` находит новые и существующие документы;
- validator успешно принял 24 Wiki-страницы, 13 ADR и 37 уникальных ID;
- тестовая копия после проверки удалена.

Базовый Codex/file workflow удобен и не требует managed Wiki. Обнаружено
ограничение интеграции ролей 4DreamTeam v0.5.8:

- `product` и `analytic` читают принятую базу через `4dt-wiki`;
- `wiki post-acceptance` создаёт и обновляет страницы и ADR через `4dt-wiki`;
- `release` обновляет changelog и выполняет export через `4dt-wiki`;
- `developer` и `quality` по умолчанию используют wiki-domain search, хотя
  могут работать по точным repository paths.

Workspace `AGENTS.md` запрещает managed Wiki writes, поэтому содержательная
безопасность сохраняется, но переходы `quality → wiki` и release workflow пока
требуют явного workspace-specific routing. Никакая адаптация ролей в рамках
этой проверки не применялась.

## Architecture Review

1. **Избыточная сложность.** Добавлен один read-only PowerShell validator без
   renderer, manifest, hashes, sync, rebuild, временных каталогов, поискового
   индекса и сторонних зависимостей. Проверки соответствуют утверждённому
   контракту документации. Дополнительная инфраструктура не нужна.
2. **Преждевременная микросервисность.** Миграция не создаёт сервисы, базы,
   package manifests или deployable boundaries. Wiki явно сохраняет позицию
   modular backend / modular monorepo без преобразования bounded contexts в
   микросервисы.
3. **Domain-Driven Design.** Закреплены независимые факты, узкий
   `DayClosure`/`JournalDay` как неутверждённый кандидат, `Daily_Log` как legacy
   projection и пять draft bounded contexts. Общий `Observation` не превращён
   в context или service boundary.
4. **Дублирование authority.** ADR хранит историю и обоснование решения; Wiki
   описывает текущее состояние и ссылается на ADR; `AGENTS.md` задаёт процесс;
   план хранит только ход и доказательства выполнения. 32 managed-страницы
   временно сохранены как явно неавторитетная legacy-копия.
5. **Возможность упрощения.** Более простой вариант без validator потеряет
   проверку структуры и ссылок; более сложный MarkdownStore или export pipeline
   не даёт нужной пользы при текущем объёме. Текущее решение — минимальное,
   сохраняющее Git review, читаемость и переносимость.

Review обнаружил небольшое улучшение workflow, которое пока только предложено:
явно маршрутизировать project-knowledge reads всех ролей в `docs/` через
repository file tools/`rg`, заменить post-acceptance Wiki writes прямым
Markdown update плюс validator и направить release changelog в
`docs/wiki/changelog.md`. Это не требует fork или регистрации `docs/` в
`4dt-sources`, но создаёт workspace-specific adapter к bundled role rules.
Компромисс — несколько явных правил в `AGENTS.md` вместо нативной поддержки со
стороны 4DreamTeam. Решение не применяется без обсуждения.

## Состояние

Завершён. Недеструктивная миграция и практическая проверка приняты оператором.
Managed Wiki остаётся неизменяемой legacy-копией; дальнейшее обсуждение storage
запрещено до отдельного решения.
