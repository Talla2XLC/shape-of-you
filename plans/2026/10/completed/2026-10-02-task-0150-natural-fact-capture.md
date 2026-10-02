# TASK-0150 — свободное общение и сохранение неполных фактов

## Цель и статус

Принимать обычные сообщения о тренировке и еде без выдуманных деталей,
обязательного полного отчёта и навязанных рекомендаций в каждом ответе.

Статус: реализация завершена локально 2026-10-02 после утверждения оператором
сообщением «го», независимого Quality и Architecture Review. Canonical Wiki
выровнена с принятым ADR. Доставка в staging и внешний conversational canary
остаются отдельной областью с operational approvals.

## Архитектурная authority

[Принятый ADR](../../../../docs/adr/20261002-capture-incomplete-facts-and-use-contextual-coach-replies.md).
План задаёт порядок исполнения, а не отдельный источник архитектурных правил.

## Область

- Training contracts, database/migration, repository, projections и V2 MCP
  capture/correction/read; существующие service и Person ownership.
- Предложение и подтверждённая замена упражнения в программе через существующий
  TrainingProgram lifecycle; автоматическая замена из одного отчёта запрещена.
- Meal MCP normalization/completeness guards поверх существующего domain:
  обычные estimates сохраняются, unknown — только при отсутствии основы оценки.
- Общая Coach reply policy, специализированные presenters и tool descriptions.
- Затронутые current-state Wiki после independent acceptance.

Вне scope: собственный chat runtime, универсальный inbox, media storage,
новые сервисы, live изменение программы пользователя, массовый импорт, live
сохранение процитированной тренировки/обеда, commit/push/deploy и запуск миграций
в staging/production. Дата переписки и runtime факт не установлены.

## Порядок

1. Утвердить ADR и этот план; зафиксировать approval в timeline TASK-0150.
2. Реализовать Training storage и новые contracts с legacy compatibility;
   добавить correction/concurrency и migration verification.
3. Обновить все consumers: cadence, progression, personal records, external
   linking, Coaching facts, timeline, import и HTTP/MCP serialization.
   Добавить естественное предложение постоянной замены упражнения и выполнение
   после ясного согласия через существующий optimistic TrainingProgram write.
4. Ослабить Meal adapter guard до существующих честных domain states; сохранить
   estimates, correction assembly, partial totals и numeric validation.
5. Выровнять все presenters, initialization и tool descriptions: полезность
   по смыслу сообщения вместо обязательного совета. Сохранить verified read-back.
6. Проверить критерии ниже и провести независимый Quality Review, затем
   Architecture Review через 4DreamTeam; исправить замечания.
7. После acceptance обновить только затронутые Wiki и оформить supersession
   прежних ADR в действительно пересмотренной части; validate-docs.
8. Подготовить отдельный delivery scope с публикацией V2 catalog, migration,
   staging readiness/smoke и conversational canary. Исполнять после approvals.
9. После завершения реализации перенести план в completed с исправлением links.

## Критерии приёмки

- «Разведения сделал» сохраняется без выдуманных repetitions, веса и RIR;
  известные части тренировки не теряются из-за неизвестных.
- «15*12*3, дальше тяжко» связывается с однозначным упражнением из разговора,
  содержит три reported sets и исходное усилие, без fabricated числового RIR.
- Smith и масса блинов сохраняются с фактической семантикой. Coach может
  спросить, разовая ли замена или нужно изменить программу, и после согласия
  применяет точное изменение. Прямой запрос замены не требует повторного
  разрешения или пересказа программы. При ответе «только сегодня» программа
  сохраняется; параметры разных механизмов не переносятся молча, старые
  тренировки не переписываются, progression evidence не смешивается.
- Запись по дню не получает fabricated instant; partial session не закрывает
  день. «Закончил A» закрывает ровно одну связанную сессию, если A определена.
- Correction добавляет подробности без потери прочих упражнений; повторы,
  stale predecessor и параллельные записи не создают дублей/потери данных.
- Meal без точных граммов/БЖУ получает разумную оценку по фото, описанию и
  средним значениям продукта с явным «примерно»; нет обязательного допроса.
  Honest unknown используется только без достаточной основы для оценки;
  кукуруза заменяет ошибочный item с пересчётом только затронутых данных.
- Обычный ответ может быть «Понял, записал» после успешного matching read-back.
  При сбое допускается короткое честное сообщение; нет выдуманной причины,
  обещания фоновой записи или навязанного плана еды/восстановления.
- Legacy contracts защищены; V2 доступность клиенту проверяется отдельно,
  несовместимый legacy read не скрывает записанные факты.
- Изолированные contract/domain/repository/API/MCP и migration tests пройдены;
  все новые PostgreSQL identifiers не длиннее 63 UTF-8 bytes.
- Independent Quality и Architecture Review проверяют простоту, DDD,
  service boundaries, одну authority и отсутствие преждевременной инфраструктуры.
- `node scripts/validate-docs.mjs` проходит до завершения.

## Ограничения проверки

Переписка является regression scenario, а не доказательством конкретной
runtime ошибки или разрешением на запись персональных фактов.
Без staging delivery и live canary можно заявлять готовность реализации,
но нельзя заявлять исправление поведения в текущем разговоре внешнего клиента.


## Результат проверки

- Contracts build, API typecheck/build и полный ESLint прошли.
- Полный API unit suite: 44 files / 346 tests.
- Изолированный PostgreSQL 17: V2 capture, Training и migration chain —
  3 files / 38 tests; Progress Overview, Recovery и import — 3 files / 23 tests.
- Migration chain включает clean/prefix/idempotent проверки и статический
  предел PostgreSQL identifiers. Новая миграция применялась test runner только
  в изолированных ephemeral Docker databases.
- Независимый Quality: 44 focused tests, проверка decimal 3.3 через Meal
  JsonSchemaPipe, review полного evidence и критериев. Приёмка и пять проверок
  Architecture Review записаны в timeline TASK-0150, без отдельной authority.
- Документация отражает V2/legacy boundary, completed-only consumers,
  обоснованные оценки еды, targeted program acceptance и контекстные ответы.

Новая сущность, сервис, inbox, дублирующая Wiki или отдельный program lifecycle
не созданы. Unknown не превращается в measured/zero evidence. Дополнительная
сложность ограничена необходимым V2 compatibility boundary. Миграция authored
и verified в isolated tests; изменения не committed/pushed, staging migration,
runtime readiness, smoke и external conversational canary для них не выполнялись.
Текущий delivery flow публикует candidate и требует ручного Promote staging;
согласованный delivery должен проверить migration, readiness, smoke и V2 catalog.
