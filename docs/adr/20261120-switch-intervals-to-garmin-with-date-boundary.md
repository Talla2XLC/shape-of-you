---
id: switch-intervals-to-garmin-with-date-boundary
kind: adr
title: "Переходить с Intervals на Garmin с будущей границей импорта"
status: accepted
date: 2026-11-20
supersedes: []
superseded_by: null
tags:
  - architecture
  - integrations
  - recovery
  - training
---

# Переходить с Intervals на Garmin с будущей границей импорта

## Context

TASK-0179/0180 доставили прямое подключение Garmin, подтверждённые wellness
поля и отдельный последний Body Battery. Проверка обновлённого MCP-клиента
успешна. Однако существующий guard намеренно запрещает подключать второй
импорт при активном Intervals или сохранённых provider-derived фактах.

Deduplication и correction pointers привязаны к connection и provider identity.
Intervals activity ID и Garmin activity ID не имеют подтверждённого общего
контракта. Совпадение времени, названия, пульса или distance не доказывает
тождество событий. Удаление старых фактов разрушит историю и ссылки Training,
Coach, FIT evidence и пользовательских подтверждений.

Прямой adapter пока не импортирует `hrv_rmssd` и общий `sleep_score`.
Переход без проверки покрытия может лишить пользователя привычных показателей.
Подтверждённые HTTP endpoints и непустые поля сами по себе не подтверждают
domain semantics этих двух metrics.

Оператор утвердил ADR и локальную реализацию 2026-11-20 ответом
«Да, утвердить и реализовать». Разрешены код API/Web, авторинг миграции,
изолированные тесты и независимая приёмка. Shared-environment migration,
delivery и реальное переключение остаются отдельными approvals.

## Decision

### Первый поддерживаемый переход

Предлагается однократный forward-only переход `intervals_icu` →
`garmin_personal` с сохранением всей уже импортированной истории. Историю
перед границей не импортировать повторно через Garmin. Новых сервисов,
баз, универсального deduplication framework и cross-provider activity mapping
не создавать.

Для обычных задержек синхронизации предусмотреть 14 локальных календарных
дней дозагрузки старого периода. В это время Intervals и Garmin могут быть
подключены одновременно, но право записи каждой записи определяется
непересекающейся границей. Это не два полных writer и не fallback по метрикам.

Выбрать будущую дату `D` в сохранённой Person timezone `Z` и вычислить
`T = startOfDay(D, Z)` средствами timezone library, без прибавления фиксированных
24 часов. `D` должна быть позже текущего локального дня и всех уже сохранённых
дней Intervals wellness; `T` — позже начала каждой сохранённой Intervals activity.
Уже существующие FIT-derived Recovery facts также проверяются при preview.
Обычно минимальная граница — следующий локальный день, но это не hardcoded дата.
Например, при переходе с 21 ноября сегодня продолжает работать Intervals;
последний Body Battery через Garmin начнёт поступать с 21 ноября.

| Поток | Intervals | Garmin |
| --- | --- | --- |
| Daily wellness | `localDate < D` | `localDate >= D` |
| Activity | `occurredAt < T` | `occurredAt >= T` |
| Activity FIT/details и derived Recovery | Владелец исходной activity | Владелец исходной activity |
| Manual facts/programs/sessions/notes | Существующие правила, без переноса | Существующие правила, без переноса |

Activity, начавшаяся до `T` и закончившаяся после него, принадлежит Intervals
целиком. Не разделять FIT по полуночи и не выбирать владельца derived fact
по времени окончания. Смена timezone после состоявшегося перехода не пересчитывает
границу, не переносит старые факты и не включает старый импорт снова.

Wellness разделяется по исходным provider `calendarDate` labels: текущий
Intervals adapter может подставить UTC при отсутствии timezone, что не
доказывает соответствие его даты Person timezone. Не пересчитывать дату по
такому fallback. Preview явно показывает date-label ограничение. Partition
гарантирует непересекающиеся права записи, но не semantic deduplication,
если провайдеры расходятся в календарной дате или времени начала одного
физического события. Не обещать такую гарантию без cross-provider identity;
неоднозначность на границе выявлять и показывать без эвристического merge.

### Новая сущность и хранение

Спроектировать одну Person-owned конфигурацию перехода `IntegrationCutover`
в существующем API-owned PostgreSQL, таблица `integration_cutovers`.
Это конфигурация полномочий импорта и audit, не health fact и не новый bounded
context. Не копировать границы ещё и в connection fields как второй authority.

Минимальные поля: local `id`, `person_id`, source/target provider keys,
local integration/recovery connection references и consent generations,
`starts_on`, `timezone`, `starts_at`, `source_drains_until`, `state`, CAS `version`,
mapping-contract version, явно принятые coverage gaps, local actor reference,
created/activated/cancelled timestamps и bounded failure code. Не хранить
raw payload, health values, credentials, external account/activity IDs.
Ключ остаётся только в existing authenticated-encrypted target connection.

Состояния: `scheduled`, `draining`, `active`, `cancelled`, `failed`.
Для Person допускается не более одного `scheduled/draining` перехода.
Policy fields состоявшегося `draining/active` перехода неизменяемы; operational auth
failures меняют connection status, а не источник владения фактами.
Неизменяемы provider pair, `D/Z/T`, drain deadline, capability version и
подтверждённые gaps. Expected consent generations являются operational fence
и обновляются при допустимой ротации только под lock/CAS, без изменения policy.
Первый UI не поддерживает цепочку обратных переходов или повторный перенос
истории; такие случаи отвергаются явно, а не обходят прежний overlap guard.

Возможные переходы:

- `scheduled → draining`: успешная атомарная активация не раньше `T`;
- `draining → active`: в `source_drains_until = startOfDay(D + 14 days, Z)`
  локально остановить source и отозвать consent; remote revoke асинхронен;
- `scheduled → active`: поздний restart, когда deadline уже прошёл;
  те же activation checks и target catch-up, без нового drain периода;
- `scheduled → cancelled`: явная отмена с удалением pending key/consent;
- `scheduled → failed`: pre-activation key, timezone, erasure или generation
  conflict; атомарно подтвердить отсутствие target facts и освободить
  provisional fences, Intervals остаётся рабочим источником;
- `failed → scheduled`: новый preview и будущая граница, явный retry;
  сохранённый pending key можно повторно использовать внутри backend, если
  он ещё действителен. Ошибка не требует нового ввода ключа автоматически;
- `failed → cancelled`: окончательная отмена и очистка pending credential.

`draining` уже является состоявшимся переходом. После activation commit
автоматический возврат запрещён даже при нуле target facts: он был бы новым
решением о владении периодом. Дозагрузка ограничена сроком, а не обещанием,
что все старые записи когда-либо синхронизировались.

### Пользовательский и публичный контракт

Существующие обычные connect/check/disconnect endpoints сохраняются.
Cutover является отдельным явным действием страницы Connections.
Предлагаются authenticated Person/CSRF-protected endpoints с `no-store`:

- `POST /v1/integrations/garmin-personal/cutover/preview`: запрошенная
  будущая дата либо выбор ближайшей допустимой; возвращает границу, timezone,
  безопасный статус source, capability gaps, ограничения истории и
  opaque `expectedRevision` текущей конфигурации. Preview ничего не отключает
  и не сохраняет секрет. Revision — stale-state guard, не authorization token.
- `POST /v1/integrations/garmin-personal/cutover/schedule`: `apiKey`,
  `consent: true`, дата, `expectedRevision`, закрытый список
  `acceptedCoverageGaps`. Backend проверяет ключ и bounded candidate coverage
  без записи domain facts, затем повторно проверяет revisions и границы под
  Person evidence lock. Только успешный schedule сохраняет key encrypted
  в pending target connection и запись перехода.
- `GET /v1/integrations/garmin-personal/cutover`: безопасные state/version,
  даты, source/target provider labels, accepted gaps и понятное действие при
  ошибке; без credentials, fingerprints и external IDs.
- `POST /v1/integrations/garmin-personal/cutover/cancel`: `expectedVersion`,
  reason; идемпотентная отмена только ещё не состоявшегося перехода.
- `POST /v1/integrations/garmin-personal/cutover/retry`: новый preview revision
  и дата, повторная проверка сохранённого ключа; новый `apiKey` нужен только
  при явном обновлении доступа. Не читать ключ в диагностические инструменты.

Ключ вводится один раз в обычном интерфейсе сайта, не в системные окна агента.
Frontend очищает его после успешного schedule/отмены/ухода; не сохраняет
в browser storage. Повторная submission использует idempotency key и CAS;
потерянный response проверяется через status, не создаёт второй schedule.

### Coverage и готовность

Preview отделяет подтверждённый mapping от отсутствия данных конкретного дня.
Unmapped/unconfirmed metric не объявляется `confirmed_absent`.
Если исходный канал поддерживает используемые метрики, которых нет у target,
переход блокируется до закрытия mappings либо отдельного явного подтверждения
каждого конкретного пробела. Capability keys — отдельный закрытый cutover
contract: `recovery.hrv_rmssd`, `recovery.sleep_score`,
`training.normalized_load`, `training.device_attribution`, `training.original_fit`.
Матрица учитывает не только wellness: прямой adapter не заменяет Intervals
relative training stress, а device attribution и фактический FIT decode
требуют отдельного подтверждения. Waiver привязан к mapping/capability version
и реально показанному списку; он не превращает unverified в supported.
Список gaps вычисляет сервер; неизвестное значение waiver не принимается.
Молчаливый default «потерю данных принимаю» запрещён.

Preview без ключа показывает известную capability matrix. Если key-based
preflight в `schedule` обнаружил новый gap или другую version, вернуть
`409 coverage_changed` с обновлённым safe preview до сохранения перехода,
credential или facts. Пользователь подтверждает именно новый список; форма
держит введённый ключ только в памяти и повторно отправляет его без repaste.
Неверный ключ, malformed FIT/ZIP или отказ обязательного provider request
не превращаются в waived success. Отсутствие activity означает unverified
FIT capability; это отличается от найденного невалидного файла.

Candidate preflight читает только bounded sample и возвращает availability/
validation outcomes. При наличии подходящей activity проверить исходный FIT
существующим bounded ZIP + FIT decoder в памяти, без domain writes/raw dumps.
При отсутствии activity отметить «не проверено», не объявлять FIT валидным.
Пустой аккаунт и отсутствие stable ID не блокируют саму проверку ключа;
coverage limitations при переходе старого пользователя подтверждаются отдельно.
Не сравнивать Intervals athlete ID с Garmin profile ID из разных namespaces.
Новый target ID связывается по прежним Garmin identity guards.

### Активация, окна и fencing

До `T` Intervals продолжает обычный rolling import, target остаётся pending
без domain facts. Worker внутри существующего API исполняет scheduled transition.
Даты, account generation и credential readiness проверяются до активации;
network requests не выполняются внутри PostgreSQL transaction.
Изменение capability/mapping version с момента принятого preview требует
повторного согласования; scheduled waiver не распространяется на другую
версию контракта автоматически.

Под одним Person evidence lock/CAS атомарно установить ограниченные
source permissions `< D / < T`, активировать target import/current consent
и перевести cutover в `draining`. Source consent остаётся действующим только
для дозагрузки старого периода. Stale source claims, FIT downloads, corrections
и callbacks не могут записать факт вне новых bounds или статус поверх новой
generation. В конце drain под тем же lock выключить source/revoke consent и
перевести cutover в `active`. Remote Intervals disconnect выполняется обычным
bounded retry после локального отключения; его отказ не включает source writer
и не отменяет target. Source auth failure в drain не возвращает новый период
Intervals; deadline не продлевается молча.

Во время drain source polling использует фиксированный календарный хвост
`[D - 14 days, D)`, а не скользящий от текущего дня window. Уже явно
запрошенный старый history job может дозагружать более ранние даты только
до того же deadline. Это не автоматический повторный scan всей истории.
Для activity transport допускается bounded padding query dates вокруг
`T`, если provider local dates отличаются; окончательная принадлежность
всегда проверяется по parent activity UTC start. Padding не создаёт ложные
receipts/absence и не расширяет право записи.

Каждая source write transaction проверяет также `clock_timestamp()` после
получения Person lock: оно должно быть раньше `source_drains_until`.
`now()`/`CURRENT_TIMESTAMP` начала transaction недостаточны при ожидании lock.
Точка проверки под lock — linearization point, а не обещание realtime commit.
Задержка
scheduler не продлевает полномочия. В deadline локально выключить import и
отозвать consent до bounded remote retry/credential cleanup. Source rotation
в drain разрешается только с атомарным обновлением expected generation,
сохранением bounds/deadline и прежними account identity guards; обычный
reconnect не начинает второй полный импорт.

Claim, admission нового provider request и sync-status update также проверяют
действующий scope/deadline. Ответ source request, пересёкшего deadline,
не даёт права записи или нового запроса. Для remote revoke после локального
stop нужен фиксированный предел attempts/time; по исчерпании удалить
локальный credential, сохранить лишь безопасный признак неподтверждённого
remote revoke и действие владельца. Не удерживать старый секрет бессрочно
ради бесконечного retry.

При source rotation OAuth callback обязан сравнить новый Intervals
`externalUserId` с сохранённым source athlete ID: текущий общий activate
сам по себе такого равенства не гарантирует. Другой аккаунт отвергается,
не заменяет историю source периода и не получает её права записи. Callback
проверяет current cutover state/version/deadline под тем же lock; после
окончания drain обычная reauthorization не возобновляет старый writer.

Если source history job не завершилась к deadline, остановить её с сохранением
cursor: `historicalImport.status = failed`, новый safe non-retryable code
`cutover_source_stopped`. Не оставлять вечный running и не переводить
непроверенную историю в completed. Preview заранее показывает этот предел.

Persisted policy проверяется во всех import write boundaries вместе с
connection/consent, а не только при построении HTTP query или claim. Уже
`scheduled` source не может записать owned records по другую сторону границы,
даже если network request пересёк `T`. Если pre-activation попытка завершается
`failed`, target ни разу не получал права записи: source продолжает работу,
а retry требует новой будущей границы после всех появившихся source facts.
После activation commit (`draining/active`) ошибки target не возвращают source
это право автоматически.

Rolling/history windows target обрезаются снизу по `D/T`, включая
первый rolling request. Вне policy результаты не импортируются, не создают
receipts/withdrawals и не продвигают history cursor как проверенный Garmin
период. History UI говорит «история Garmin с даты перехода», без обещания
полного Garmin backfill до 2000 года. Старые данные читаются с прежним
provenance; старые ID, correction chains, activity links, Coach snapshots,
trusted titles и manual decisions не переносятся и не перенумеровываются.

Существующий check `integration_connections_historical_state_shape` требует
для completed cursor `2000-01-01`. Его необходимо явно изменить: existing
history job получает `scopeFromDate` snapshot (по умолчанию `2000-01-01`,
для target cutover — `D`), completed cursor равен именно этому snapshot.
Это граница конкретной history job, не второй источник import permissions:
каждый window дополнительно проходит действующий cutover guard. Snapshot
вычисляет backend; его нельзя передать произвольно через browser input.
Добавить `historicalImport.scopeFromDate` в public schema и UI, с согласованной
доставкой API/Web. Existing rows мигрируют с прежней границей, проверки
cursor progress сохраняются. Нельзя писать completed/2000 для непроверенных
дат, держать вечный running или обходить check на уровне приложения.

Согласие на schedule явно включает bounded catch-up target периода `D…now`
после перезапуска/поздней активации. Если downtime превысил обычный rolling
window, существующий history worker с job scope `D` дозагружает пропущенный
начальный участок; это не доступ к старой Intervals истории. Cursor сохраняется
и возобновляется. Если к моменту активации drain deadline уже прошёл,
атомарно перейти сразу в `active` с выключенным source, не добавляя новые
14 дней. Ключ и consent проверяются до этого commit; pre-commit отказ
по-прежнему оставляет source и снимает provisional fences без target writes.

Смена timezone или source consent до активации инвалидирует preview/schedule;
устаревшая задача не срабатывает молча. Повторная проверка не требует ручного
копирования уже сохранённого pending key. После перехода обычная ротация
Garmin key сохраняет bounds и identity guards.

### Ошибки, поздние данные и возврат

До активации отмена сохраняет исходный режим. После активации auth failure
показывает обновление ключа; старая история читается локально, новый период
остаётся с честным unknown/stale coverage до восстановления. Допустим stop
target import без автоматического возобновления Intervals.

Автоматический rollback после activation commit, даже без target facts,
и «удалить Garmin, начать заново через Intervals» не поддерживаются.
Обратный переход требует
отдельного решения и новой непересекающейся границы. Это сознательно более
узкий первый этап, чем универсальная миграция источников.

Сохраняется уже импортированная история; обычные поздние данные до границы
дозагружаются Intervals в течение drain. Поздняя загрузка/исправление после
его окончания не гарантируется этим контрактом: Garmin не импортирует её
вместо старого источника. Отдельный ограниченный refresh старой истории
потребует собственного явного действия/consent.
Нельзя обещать полную старую историю только по факту завершения cutover.

### Erasure и владение конфигурацией

Connection erasure сначала отключает соответствующие claims и pending
activation; journal-backed deletion остаётся authority для удаления фактов,
FIT и links. Удаление source history не разрешает target backfill до `D`.
Удаление target не включает Intervals. Отмена schedule очищает pending
credential/consent без каскадного удаления сохранённой source history.

Minimal Person-owned import bounds нужны и после connection erasure, чтобы
не разрешить автоматическое повторное заполнение удалённого диапазона.
Connection-specific references/audit metadata очищаются или tombstone-ятся
по erasure manifest; конфигурация не удерживает raw facts, keys, external IDs
или удаляемые source records. Удаление Person удаляет конфигурацию целиком.
Точный API-owned DDL и integration с erasure journal должны быть представлены
и проверены до реализации; FK не должны блокировать erasure либо молча
удалять действующие bounds через cascade.

После restore replay erasure journal должен блокировать восстановленные
pending activations и их credentials до запуска import workers. Воскрешённый
schedule не может вернуть отозванный consent или начать удалённый импорт.

## Considered alternatives

- **Будущая граница без переимпорта (предлагается).** Сохраняет stable IDs,
  не требует cross-provider identity и больших изменений читающих моделей.
  Цена — scheduled activation, ожидание нового дня, 14-дневная дозагрузка старого
  backfill и отсутствие автоматического обратного перехода.
- **Переключиться сегодня, скрыв прежние wellness facts precedence-правилом.**
  Даёт новый Body Battery немедленно, но требует согласованного фильтра во всех
  Recovery reads, baseline/coverage, ретроспективах и Coach citations. Training
  всё равно требует отдельной instant boundary. Дороже и легче потерять
  значения/ссылки незаметно; не предлагается первым этапом.
- **Intervals для HRV/score, Garmin для остальных wellness, Training оставить
  прежним.** Быстрее добавляет новые показатели, но сохраняет зависимость от
  двух каналов и вводит по-метричный authority/consent routing. Возможный
  отдельный продуктовый вариант, а не скрытый fallback выбранного перехода.
- **Два полных writer с эвристическим dedupe.** Нет доказанной event identity,
  могут удвоиться Training frequency/load и смешаться provenance/erasure;
  отклонено.
- **Удалить Intervals и целиком импортировать Garmin.** Риск утраты manual
  links, старых значений и исправлений; новая авторизация не является
  разрешением на erasure. Отклонено.
- **Полностью сопоставить обе истории до переключения.** Может дать общий
  canonical activity identity, но требует отдельного подтверждённого контракта
  и миграции ссылок. Не нужен для future-only перехода.

Неограниченная дозагрузка через Intervals сохраняла бы зависимость от старого
канала навсегда; мгновенный revoke мог бы потерять обычную полуночную
финализацию. 14 календарных дней — выбранный продуктовый предел первого
этапа, а не гарантия latency Garmin/Intervals. Deadline показывается в UI.

## Consequences

Нужны одна API-owned конфигурация, миграция её и existing history job scope,
narrow public cutover contracts, scheduled worker path, import-policy guards
и UI preview/status. Сервисы,
базы и ownership Recovery/Training не меняются. Старые факты сохраняют authority
для своего периода; текущее delivery выбирает provider по policy на дату,
а не по условию «Garmin подключён — значит он главный».

Первый день Garmin не становится мгновенным результатом сегодняшнего
schedule. Нет гарантии HRV/score до подтверждённого mapping или явного
выбора пользователя принять конкретный пробел. Обычные новые пользователи
без retained Intervals по-прежнему подключаются существующим простым flow.

## Verification

- Preview без mutations; schedule без domain writes и остановки текущего дня;
  stale revision,
  duplicated/lost response, concurrent rotation/timezone/erasure.
- До/в момент/после `T`, DST и разные provider timezones; активность через
  полночь, FIT-derived metric после `T`, late records и retry после рестарта.
- Old in-flight writes/callbacks и новые history/rolling jobs не пересекают
  ownership bounds; нет ложного history-completed/confirmed-absent.
- Старые IDs, corrections, trusted titles, workout links и Coach citations
  неизменны; manual facts не фильтруются и не удаляются.
- Target key failures до активации сохраняют source; после активации не
  включают его. Coverage gaps не принимаются автоматически.
- Переключение current delivery только на назначенную дату, сохранение
  consent-scoped receipts и неизвестной измерительной точности Body Battery.
- Journal-backed source/target erasure и Person erasure не обходят bounds
  и не блокируются новыми FK; PostgreSQL identifiers не длиннее 63 UTF-8 bytes.
- Независимые Quality и Architecture Review; staging отдельно проверяет
  authored/tested/applied migration, runtime readiness и smoke.

## Related material

- [Прямое подключение Garmin](20261118-connect-garmin-personal-api.md)
- [Подтверждённые wellness mappings](20261120-garmin-observed-wellness-mapping.md)
- [Consent-scoped delivery](20260919-bind-recovery-delivery-to-consent-generation.md)
- [Recovery](../wiki/domain/recovery-and-readiness.md)
- [Training](../wiki/domain/training-and-performance.md)
- [План TASK-0181](../../plans/2026/11/completed/2026-11-20-task-0181-intervals-garmin-cutover.md)
