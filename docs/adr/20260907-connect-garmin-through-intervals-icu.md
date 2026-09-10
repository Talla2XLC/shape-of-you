---
id: connect-garmin-through-intervals-icu
kind: adr
title: "Подключать Garmin через официальный канал Intervals.icu"
status: accepted
date: 2026-09-07
supersedes: []
superseded_by: null
tags:
  - architecture
  - integrations
  - recovery
  - training
  - privacy
  - oauth
---

# Подключать Garmin через официальный канал Intervals.icu

## Context

Shape of You должен автоматически получать пользовательские показатели Garmin
и тренировки после понятного consent flow, показывать состояние синхронизации,
не создавать дубликаты и независимо поддерживать disconnect и удаление уже
импортированных данных.

Прямой Garmin Connect Developer Program предназначен для business-use и не
обещает доступ частному персональному проекту. Неофициальные Garmin Connect
клиенты требуют пароль или эмулируют приватную сессию, не дают Garmin-hosted
consent и противоречат выбранной границе безопасности.

Intervals.icu уже подключён к официальному Garmin API. Пользователь может
отдельно связать Garmin с Intervals.icu через Garmin-hosted authorization, а
Shape of You — получить `ACTIVITY:READ` и `WELLNESS:READ` через публичный
Intervals.icu OAuth 2.0 и REST API. API допускает персональные ключи для
собственных данных, но пользовательский продуктовый flow должен использовать
OAuth application и не просить пользователя копировать API key.

Garmin через Intervals.icu подтверждён для тренировок и части ежедневного
wellness: sleep duration, sleep score/quality, resting heart rate, HRV rMSSD,
steps и Body Battery встречаются в текущем потоке. Доступность зависит от
устройства и того, что официальный Garmin API передаёт Intervals.icu. Нельзя
обещать continuous all-day heart-rate series, average sleeping heart rate,
overnight SpO2, respiration или Garmin Readiness до контрактного подтверждения.

Intervals.icu не передаёт надёжную origin attribution для каждого wellness
поля, когда аккаунт агрегирует несколько источников. Для activity можно
использовать `device_name` и provider metadata, но wellness следует считать
данными Intervals.icu, которые могут включать Garmin. Продукт не должен
представлять такую запись как доказанно Garmin-originated.

## Decision

Первую официальную персональную Garmin-интеграцию реализовать как adapter к
Intervals.icu внутри существующего `apps/api`. Не создавать отдельный сервис,
database или deployable worker.

Пользовательский flow состоит из двух явно показанных разрешений:

1. пользователь связывает Garmin с Intervals.icu на Garmin-controlled consent
   page, если ещё не сделал этого;
2. пользователь разрешает Shape of You читать activity и wellness в
   Intervals.icu OAuth 2.0 flow.

Кнопка и disclosure называются `Garmin через Intervals.icu`, а не создают
видимость прямого договора Shape of You с Garmin. Shape не принимает Garmin
пароль, Garmin token или Intervals.icu API key.

Provider-specific HTTP, OAuth и payload types находятся в in-process adapter.
Provider-neutral application port описывает start authorization, callback,
reconciliation, disconnect и remote erasure attempt. Recovery, Training и
Physical State получают только проверенные typed commands.

OAuth authorization transaction является одноразовой, короткоживущей и
Person-bound: cryptographic `state` хранится только как hash, callback URI
точно allowlisted, code обменивается server-to-server и не логируется. Глобальные
Intervals.icu client credentials поступают только из runtime configuration.
Person access token хранится только authenticated-encrypted с key id и
associated data, связывающими provider, Person и connection.

Person connection остаётся authority для consent, import enablement, status и
erasure. Connection projection отдельно хранит lifecycle и sync health:
`connecting`, `active`, `degraded`, `disconnected`, время последней попытки,
успешной синхронизации и последнего нового факта, а также безопасный failure
code без provider response или персональных данных.

Автоматический импорт использует bounded reconciliation в API runtime. Activity
webhook применяется только после подтверждения и проверки webhook contract;
wellness читается ограниченным sliding window, потому что суточная запись может
обновиться повторно. Отсутствие подтверждённого wellness webhook не блокирует
polling. Rate limits и backoff принадлежат adapter и не влияют на обычные API
reads.

Каждая доставка сначала проходит size/status/schema validation и сохраняется в
техническом inbox как locator, identity, checksum и retry state. Полный raw JSON
не является доменной моделью и не хранится после нормализации. Если для
диагностики понадобится ограниченный payload, это требует отдельной retention
границы и не включается по умолчанию.

Дедупликация выполняется на двух уровнях:

- provider delivery/activity identity плюс checksum;
- Person connection плюс typed fact identity (`activity id` или
  `local date + metric`) плюс normalized checksum.

Повтор с тем же checksum является no-op. Изменившийся sleep/wellness/activity
создаёт полную typed correction/supersession, а не скрытое обновление факта.

Activity с подтверждённым Garmin `device_name` получает Garmin attribution по
требованиям Intervals.icu API Terms и Garmin brand guidelines. Wellness без
origin metadata хранится как `Intervals.icu wellness; may include Garmin`.

Disconnect сначала атомарно отзывает локальный consent, прекращает claim/new
import и отменяет pending work, затем вызывает Intervals.icu
`disconnect-app`. Уже импортированные факты сохраняются. Отдельное erasure
использует существующий fresh-passkey и fail-closed Recovery journal lifecycle;
его dependency graph включает все connection-linked Recovery, Training и
Physical State facts. Remote deletion/revocation failure оставляет request в
безопасном retryable состоянии и не удаляет старые данные молча.

Локальные и integration tests используют contract fake provider и fake OAuth
server. Реальные credentials, OAuth application registration, migration apply,
deployment, VM access и production validation остаются отдельными operator
gates.

## Considered alternatives

- **Прямой Garmin Connect Developer Program.** Даёт лучший контроль и точную
  Garmin provenance, но персональный проект не имеет гарантированного права на
  участие и выдачу credentials.
- **FitnessSyncer.** Поддерживает официальный Garmin flow, OAuth, API и
  notifications при низкой персональной цене. Оставлен fallback, потому что
  production redirect и webhook activation требуют отдельного согласования, а
  Intervals.icu лучше подтверждает нужные Recovery metrics.
- **Terra, Spike или Thryve.** Дают более готовый widget, нормализацию и
  enterprise controls, но Terra и Spike стоят примерно USD 499 и USD 450 в
  месяц, а Thryve выдаёт цену по запросу; это непропорционально одному
  пользователю.
- **Неофициальный Garmin client или scraping.** Отклонён: нет поддерживаемого
  consent contract, требуется чувствительная Garmin session и остаётся высокий
  риск поломки или блокировки.
- **Intervals.icu personal API key.** Допустим только для ручного developer
  spike с собственными данными после отдельного разрешения; не является
  продуктовым flow и не должен запрашиваться у пользователей.

## Consequences

- Shape of You получает доступную персональному проекту официальную цепочку до
  Garmin без Garmin password/token custody.
- Пользователю нужен аккаунт Intervals.icu и одноразовая отдельная настройка
  Garmin connection; полностью одноэкранный `Connect Garmin` невозможен через
  документированный публичный API.
- Для unattended импорта бесплатный Intervals.icu account может стать dormant
  после длительного отсутствия; Supporter subscription или письменное
  подтверждение иной политики считается production prerequisite.
- Wellness provenance ограничена возможностями Intervals.icu, поэтому UI и
  домен честно показывают посредника и не утверждают недоказанное происхождение.
- Новый adapter остаётся заменяемым внутри API, но provider-neutral port
  проектируется узко под реально используемый flow, без преждевременной
  универсальной aggregator framework.
- Schema changes нужны для encrypted credentials, OAuth transactions, inbox,
  sync status и cross-domain connection provenance. Создание и применение
  migration требуют отдельного operator approval.

## Verification

- Contract tests фиксируют OAuth URLs, scopes, callback replay protection,
  token encryption boundary, timeout/retry и sanitized errors без настоящего
  Intervals.icu account.
- Unit и PostgreSQL integration tests доказывают duplicate no-op, changed-value
  correction, late sleep update, activity attribution, disconnect race и
  fail-closed erasure dependency coverage.
- Web tests проверяют двухступенчатый disclosure, состояния connection,
  last-sync presentation, disconnect и отдельный passkey-gated erasure action.
- Static checks запрещают secrets/tokens/provider payloads в logs, responses,
  browser storage и repository artifacts.
- PostgreSQL migration identifiers проверяются на предел 63 UTF-8 bytes до
  выполнения migration.
- Реальный provider smoke test проводится только после отдельного approval на
  регистрацию, credentials и external account access.

## Related material

- [Recovery and Readiness](../wiki/domain/recovery-and-readiness.md)
- [Training and Performance](../wiki/domain/training-and-performance.md)
- [Data ownership](../wiki/architecture/data-ownership.md)
- [Recovery retention and authenticated erasure](20260903-enforce-recovery-retention-and-authenticated-connection-erasure.md)
- [Intervals.icu Open API](https://www.intervals.icu/features/open-api/)
- [Intervals.icu Wellness Integration](https://www.intervals.icu/features/wellness/)
- [Intervals.icu OAuth support](https://forum.intervals.icu/t/intervals-icu-oauth-support/2759)
- [Intervals.icu API Terms](https://forum.intervals.icu/t/intervals-icu-api-terms-and-conditions/114087)

