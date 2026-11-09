# TASK-0176 — Полный процесс ведения тренировок Coach

Дата: 2026-11-08. Статус: архитектура и план согласованы оператором 2026-11-08 («го»).
Реализация разрешена; реальные записи пользователя не разрешены.

## Цель и границы

Coach выбирает силовую, кардио или отдых по цели, истории и интенсивности,
восстановлению, самочувствию, времени и оборудованию. Стабильная программа
сохраняет историю прогрессии. Сервис предоставляет факты и объективные расчёты,
проверяет целостность записи. Основание — принятый ADR 20261009.
Новая часть решения — [lifecycle ADR](../../../docs/adr/20261108-complete-and-replace-training-programs-through-coach.md).

Ahilej, Millennium и отсутствие стойки дома — исходный сценарий, не разрешение
менять данные. Оборудование Millennium, новая программа, A/B/C, 3+2 и стартовые
веса не утверждены. Гибрид не навязывается. Коммит, push, deploy, ВМ и миграции
не входят в разрешение. Существующие посторонние Git changes сохраняются.

## Проверенные исходные точки

- `apps/api/src/mcp/server.ts`: MCP_OPERATIONAL_INSTRUCTIONS уже передаёт выбор
  Coach, снимает обязательную цепочку reads и eligibility gates. Обычный save
  достаточен для проверки результата; специальные progression tools скрыты.
- Подключённый каталог Shape of You 8 ноября публикует другую инструкцию:
  MUST get_daily_decision_context first и fail closed при сбое; save требует
  обязательного повторного context read. Legacy progression tools видны.
  Это наблюдаемый разрыв публикации, а не доказательство его конкретной причины.
- `apps/api/src/domain/training.ts`: training-next-step-v5 возвращает strength
  и lightCardio вместе, targets означают guidance; очередь силовых сохраняется.
  Но complete_today, needs_classification, schedule_unavailable и отсутствие
  cadence возвращаются раньше вариантов. Это проекция, не запрет; не превращать
  её в единственный список разрешённых действий. Отдых выбирает Coach.
- `apps/api/src/coaching/daily-decision-context.service.ts`: составной контекст
  проверяет согласованность, возвращает сравнения, coverage, wellbeing и nextStep,
  но не полный program snapshot и performed sets. Для прогрессии нужны отдельные
  Training V2/history reads; ошибка этого контекста не обнуляет другие факты.
- `apps/api/src/storage/training-repository.ts`: save при active обновляет ту же
  идентичность; HTTP create/activate существуют, MCP complete/new-program нет.
- `packages/contracts/src/training.ts`: есть nullable equipment упражнения,
  notes, cadence и program versions; нет реестра залов и завершённого статуса.
  Cadence cardio требует численных пульсовых границ: их нельзя выдумывать ради
  заполнения схемы. Пока можно не задавать cadence и обсуждать кардио по фактам;
  ослабление схемы при необходимости согласовать отдельно.
- V2 capture различает in_progress/completed, неизвестные подходы и дату без
  времени. Connected summaries дают duration/trainingLoad, не performed sets.
  FIT details доступны отдельным read; summary load нельзя разносить по упражнениям.
- TASK-0153 и TASK-0168 имеют completed планы и принятые ADR. Их локальные тесты
  и исторические delivery записи не доказывают качество сегодняшнего ответа Coach.

## Неизвестность

Нет trace вызовов Coach из переписки: причина ошибки истории и фактически
полученная им инструкция неизвестны. Не проверены текущий deployment revision,
актуальность connector registration, дополнительные инструкции конкретного чата
и естественный ответ модели после обновления. Не читались реальные персональные
записи в рамках аудита; фактическая текущая активность Ahilej не утверждается.
Не подтверждены текущие цель, время занятий, самочувствие и оборудование зала.
Startup memory содержит устаревшие ссылки на managed ADR/Sheets; актуальный
AGENTS.md имеет приоритет. Ремонт памяти в этот объём не включён.

## Порядок работ после согласования

1. Зафиксировать принятие lifecycle ADR; текущий ADR 20261009 не переписывать.
2. Выяснить источник подключённого каталога: сопоставить исходный server policy,
   опубликованные descriptions и client-level instructions. Подготовить refresh
   и canary; выполнить внешние изменения только по отдельному разрешению.
3. Уточнить одну связную политику Coach: выбрать релевантную историю с пагинацией,
   учитывать выполненную интенсивность отдельно от плана; сохранять неизвестность;
   объяснять изменение рекомендации через новые факты или изменившуюся цель.
   Не вводить обязательный полный read или скрытый физиологический gate.
4. Реализовать согласованный lifecycle в существующих contracts/Training/store/MCP.
   До кода уточнить точные входы, результаты, replay и конкурентную активацию.
   При необходимости новой таблицы/миграции остановить этот подпункт до решения.
5. Проверить полезность фактов для решения: точные версии упражнений, sets/reps/load,
   качественные effort notes, Recovery и давность, цель/время/оборудование. Объём
   считать только из известных измерений с явной областью и единицами. Не вводить
   общий intensity score. Новый read projection — только если существующие reads
   доказанно не покрывают сценарий, с отдельным согласованием контракта.
6. Провести contract/unit и isolated PostgreSQL integration проверки lifecycle,
   ownership, conflicts, atomicity, dedupe, истории и неизменённых полей.
   API typecheck/build, применимые unit/integration suites. При SQL изменениях
   статически проверять PostgreSQL identifiers <= 63 UTF-8 bytes.
7. Независимая Quality и Architecture Review; обновить только affected Wiki
   после принятия. `node scripts/validate-docs.mjs`. Поведение внешней LLM проверять
   отдельными диалогами: unit tests инструкций не доказывают качество разговора.
8. Отдельно согласовать доставку/обновление каталога и безопасный разговорный
   canary. Реальные данные меняются только в рамках нового явного разрешения.

## Проверяемые сценарии приёмки

| Сценарий | Ожидаемое поведение |
| --- | --- |
| Вчера силовая, сегодня доступно мало времени | Coach сопоставляет intensity, цель и время; может выбрать кардио или отдых, без обязательного A→кардио→B |
| Человек хочет силовую после выполненной нормы | Нет запрета quota/complete_today; объяснение опирается на факты и самочувствие |
| Плохое самочувствие при нормальном HRV | Отчёт человека учитывается; HRV не выдаётся за разрешение тренироваться |
| Нет свежего Recovery или history read упал | Неизвестность названа; доступны условные рекомендации по остальным фактам, без выдуманного нуля/нормы |
| Нет cadence, неясная старая Garmin activity | Очередь неизвестна; это не блокирует совет или обсуждение другой нагрузки |
| «Было легко», «поставь 25 кг» | Качественная история без выдуманного RIR; точное изменение сохраняется один раз по имеющемуся согласию |
| Изменённый тренажёр / разные load basis | Разные identities и весовые смыслы не склеиваются; стартовый вес не переносится автоматически |
| «Заверши Ahilej» без новой программы | Только завершение, история доступна, нет автоматически созданной A/B/C |
| Обсуждение Millennium | Не утверждается оборудование; гибрид не навязывается; обсуждение не активирует программу |
| Принято полное новое предложение | Новый programId; прежние сессии и версии сохранены, замена атомарна |
| «Да» после нескольких вариантов | Один короткий вопрос о реальной неоднозначности; однозначная инструкция не переподтверждается |
| Concurrent update / lost acknowledgement | Перечитать/проверить, сохранить чужие изменения, не создать дубль; новое согласие только для изменившегося смысла |

## Предварительный Architecture Review

1. Сложность: переиспользуются существующие версии и active pointer.
2. Новых deployable boundaries нет; монорепо и единый API сохранены.
3. Training владеет программой/сессиями, Recovery — наблюдениями; Coach рассуждает.
4. ADR описывает новое решение, этот план — исполнение; Wiki остаётся текущим
   состоянием и не переписывается как будто проект уже реализован.
5. Самое простое улучшение — исправить публикацию инструкций; lifecycle добавляется
   только ради доказанного отсутствия операций. Финальный review после реализации.


## Результат локальной реализации 2026-11-08

- Добавлены `complete_training_program`, `list_training_programs` и
  `get_training_program_version`; confirmed save поддерживает `newProgramId`
  и обязательный в этом режиме `expectedActiveVersionId`. Новая идентичность
  обеспечивает durable replay через исходную версию 1 без дополнительной таблицы.
- Завершение сохраняет current draft и историю, допускает повтор как desired-state
  no-op и не делает inactive программу снова активной. Последующая активация
  инвалидирует старый completion lock. Отдельная новая программа создаётся атомарно.
- Coach policy связывает выбор с целью, реальной интенсивностью, самочувствием,
  временем и подтверждённым оборудованием; не требует гибрида и чередования.
- Contracts build, API typecheck/build, scoped ESLint и diff check прошли.
  API unit: 428/429 при первом прогоне; ожидаемый каталог после добавления трёх
  инструментов обновлён, повтор MCP adapter: 11/11. Остальные 418 unit прошли.
- Полный MCP PostgreSQL flow: 13/13; после расширения lifecycle проверок его
  отдельный сценарий повторно прошёл. Reviewer независимо повторил расширенный
  сценарий и MCP unit 11/11. Проверены чужой Person, история, pagination, current
  draft != active, concurrent retries, concurrent replacements, rollback,
  завершение, повторная активация и stale completion.
- Docker недоступен; использован отдельный временный PostgreSQL 17.6 в
  `/private/tmp/soy-task0176-pg`, только synthetic fixtures. Test-only override
  допускает исключительно loopback, отдельное фиксированное имя тестовой БД
  и нестандартный порт. Агент выполнил существующие миграции только в этой
  изолированной тестовой БД. ВМ и реальные среды не затронуты.
- Исходный MCP initialize публикует полную актуальную policy, а tools/list
  исключает legacy progression tools. Устаревшие MUST/fail-closed/readback
  строки в действующем исходном дереве не найдены. Причина старых метаданных
  подключённого каталога без проверки его публикации остаётся неизвестной.

## Подготовленная проверка публикации и диалога

Выполнять после отдельного разрешения соответствующих delivery действий.
Сначала проверить exact revision опубликованного API и получить initialize /
tools/list тем же клиентом, которым пользуется Coach. Сравнить instructions и
описания с текущим `MCP_OPERATIONAL_INSTRUCTIONS`, наличие новых lifecycle tools,
отсутствие legacy tools в discovery и обязательного daily read/readback.
Сбой сравнения — незавершённая доставка, а не повод переписывать спортивные правила.
Затем повторить сценарии таблицы в отдельном тестовом контексте без реальных
записей; lifecycle writes — только synthetic Person. Проверить естественный
выбор силовой/кардио/отдыха, неизвестное оборудование, качественную прогрессию,
однозначное и неоднозначное согласие. До этого реальное поведение внешней LLM
и исправление подключённого Coach не заявлять подтверждёнными.


## Статус приёмки и оставшиеся gates

Независимая локальная Quality и Architecture Review записаны в
`task-0176-local-quality-architecture-20261108`. После этой ограниченной приёмки
обновлены canonical Wiki API Training, Training domain и Coaching domain.
Временная PostgreSQL остановлена. Локальная реализация готова; TASK-0176 в целом
остаётся открытым до отдельно разрешённой публикации и разговорных canary.
План остаётся в активном каталоге, чтобы эти ограничения не потерялись.
Коммит, push, delivery и реальные записи не выполнялись.

## План доставки от 2026-11-09

Ветка: `main`. Основание: принятые локальные Quality и docs Quality TASK-0176.
Перед staging/commit и push требуется соответствующее явное разрешение AGENTS.md.
Сообщение: `feat(training): support program completion and atomic replacement`.
Tag и GitHub Release не планируются. CHANGELOG.md отсутствует; запись добавлена
в canonical `docs/wiki/changelog.md`. Managed Wiki не используется.

Включить только 16 файлов:

- `apps/api/src/mcp/server.ts`
- `apps/api/src/storage/training-repository.ts`
- `apps/api/src/training/training.service.ts`
- `apps/api/test/app.unit.test.ts`
- `apps/api/test/fixtures/mcp-meal-server.ts`
- `apps/api/test/mcp-context-read-errors.unit.test.ts`
- `apps/api/test/mcp-recovery-write-errors.unit.test.ts`
- `apps/api/test/mcp-server.unit.test.ts`
- `apps/api/test/mcp-training-flow.integration.test.ts`
- `packages/contracts/src/training.ts`
- `docs/adr/20261108-complete-and-replace-training-programs-through-coach.md`
- `docs/wiki/api/training.md`
- `docs/wiki/domain/training-and-performance.md`
- `docs/wiki/domain/coaching-and-decision-support.md`
- `docs/wiki/changelog.md`
- `plans/2026/11/2026-11-08-task-0176-training-coach-process.md`

Исключить прежние изменения DreamTeam: `.gitignore`, `AGENTS.md`, `README.md`,
`docs/README.md`, `docs/wiki/architecture/overview.md`,
`docs/wiki/architecture/repository-and-runtime.md`, `scripts/validate-docs.mjs`,
`scripts/validate-docs.test.mjs`.

После разрешения: stage только перечисленные файлы; commit; отдельно разрешённый
push `origin main`; дождаться exact Publish run. Promote staging выполняется
для успешно опубликованного current-main SHA; затем проверить migration step,
readiness и smoke exact run. Новых миграций TASK-0176 нет; существующий pipeline
API migration step сохраняется. При несовпадении ожидаемого staging base применять
предусмотренную ручную полную публикацию current main, не обходить base check.
Последний доступный успешный Promote — 37918246971 для
634237ff855a674f9a6b7cd28ed1b5a7ba81792a: это историческое свидетельство workflow,
не сегодняшняя проверка runtime. После доставки — сравнение MCP initialize /
tools/list и разговорный canary без реальных записей пользователя.
