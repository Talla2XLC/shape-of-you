# TASK-0110 — Полный импорт поддерживаемых Intervals wellness-показателей

## Статус

Выполнено 2026-09-12. Implementation, независимые Quality и Architecture
Review, а также обновление только затронутых Wiki-страниц завершены. Применение
migration, secrets, commit, push и deployment остаются отдельными gates.

## Цель

Сделать Garmin -> Intervals.icu -> Shape of You обычным автоматическим каналом
для всех доступных и однозначно моделируемых recovery-показателей, чтобы
пользователь не пересылал Garmin screenshots для повседневных рекомендаций.

## Объём

1. Расширить provider-neutral wellness record средним ночным пульсом, SpO2,
   respiration и отдельными Body Battery min/max.
2. Запрашивать из Intervals API только явный whitelist стандартных и
   подтверждённых custom fields.
3. Нормализовать новые поля с bounded numeric validation и без raw JSON
   persistence.
4. Расширить Recovery contracts и relational persistence метриками
   `body_battery_min` и `body_battery_max`; создать additive migration после
   отдельного одобрения реализации, но не применять её.
5. Сохранять `avgSleepingHR`, `spO2`, `respiration`, `BodyBatteryMin` и
   `BodyBatteryMax` через существующие inbox, correction, withdrawal, consent,
   disconnect и erasure paths.
6. Расширить fake provider и targeted unit/integration tests для rolling и
   historical reconciliation.
7. После Quality acceptance обновить только затронутые current-state Wiki
   страницы и согласовать coverage semantics с TASK-0107.

## Не входит

- прямой либо неофициальный Garmin API, scraping или хранение Garmin password;
- обещание получить поля, которые Intervals не передаёт для данного Garmin
  аккаунта/устройства;
- выдуманная нормализация sleep stages, nightly SpO2 minimum, Garmin readiness,
  stress, skin temperature или nightly respiration;
- универсальная custom-field map или raw JSON domain model;
- новый микросервис, очередь, dependency или secret;
- применение migration, commit, push, deploy, production/VM operations;
- полная Data coverage UI из TASK-0107, кроме совместимого backend contract.

## Затронутые области

- `packages/contracts/src/recovery.ts`;
- `apps/api/src/database/schema.ts` и additive Drizzle migration;
- `apps/api/src/domain/recovery.ts`;
- `apps/api/src/integrations/provider.ts`;
- `apps/api/src/integrations/intervals-icu/provider.ts`;
- `apps/api/src/integrations/intervals-icu/normalizer.ts`;
- `apps/api/src/integrations/integration.service.ts`;
- `apps/api/src/integrations/fake-provider.ts`;
- targeted contracts/API unit and PostgreSQL integration tests;
- после Quality acceptance — только затронутые Recovery/Connections Wiki.

## Порядок реализации

1. После одобрения обновить shared Recovery contract и доменную validation map.
2. Создать additive migration enum/check constraint без применения.
3. Расширить provider-neutral record и Intervals `fields` whitelist.
4. Реализовать strict normalization и typed fact mapping.
5. Расширить correction/withdrawal fact-key set и fake provider fixtures.
6. Добавить unit/integration regressions на каждую метрику, duplicate,
   correction, removal, historical import и disconnect race.
7. Выполнить Developer report и без промежуточного gate передать изменения на
   независимую Quality-проверку.
8. После отдельного разрешения обновить затронутую Wiki и провести обязательный
   Architecture Review.

## Критерии приёмки

1. Intervals `sleepSecs`, `sleepScore`, `restingHR`, `avgSleepingHR`, `hrv`,
   `spO2`, `respiration`, `BodyBatteryMin` и `BodyBatteryMax` при непустом
   корректном значении сохраняются как соответствующие typed Recovery facts.
2. `BodyBatteryMin` и `BodyBatteryMax` никогда не схлопываются в общий current
   `body_battery` и остаются различимыми downstream.
3. Неподдерживаемые и неизвестные provider fields игнорируются на transport
   boundary и не сохраняются как raw JSON.
4. Повторная rolling/historical выдача не создаёт дубликаты; изменение создаёт
   correction; исчезновение ранее импортированного поля создаёт withdrawal.
5. Ошибка provider record не удаляет старые данные, не раскрывает payload/token
   и не ломает остальные API endpoints.
6. Disconnect и consent-generation fencing прекращают новые записи; erasure
   удаляет новые metric facts через существующий fail-closed journal lifecycle.
7. Все сценарии проверяются contract fake provider без реального Garmin account
   или production credentials.
8. Публичная документация не обещает Garmin metrics, которые Intervals фактически
   не возвращает.
9. Новый deployable service, dependency, secret или ручная VM configuration не
   появляются.

## Проверки

- contracts build/schema tests;
- API lint, typecheck, build и полные unit/integration suites;
- provider URL/whitelist and redaction assertions;
- PostgreSQL migration clean-chain/idempotency и identifier-length guard;
- Recovery duplicate/correction/withdrawal/disconnect/erasure regressions;
- rolling и explicit historical fake-provider tests;
- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- `4dt-board validate`;
- независимые Quality и Architecture Review.

## Approval gates

- Явно одобрить ADR и этот план до первого implementation patch.
- Создание migration входит только в отдельно одобренную реализацию; её
  применение требует нового operational approval.
- Wiki write после Quality acceptance, commit, push, deploy, credentials,
  production и VM operations требуют отдельных подтверждений.
