---
id: activate-intervals-icu-from-complete-configuration
kind: adr
title: "Активировать Intervals.icu по полной конфигурации без отдельного флага"
status: accepted
date: 2026-09-10
supersedes: []
superseded_by: null
tags:
  - architecture
  - integrations
  - deployment
  - configuration
---

# Активировать Intervals.icu по полной конфигурации без отдельного флага

## Context

Первая staging-доставка Garmin через Intervals.icu успешно развернула код и
миграцию, но оставила интеграцию выключенной, потому что OAuth credentials и
ключ шифрования были настроены, а независимый `INTERVALS_ICU_ENABLED` — нет.
Два сигнала описывали одно operational состояние и позволяли получить
формально успешный, но бесполезный релиз.

Локальные и тестовые среды должны по-прежнему запускаться без provider
credentials. Частичная конфигурация недопустима: она не должна молча отключать
интеграцию или приводить к ошибке только при первом пользовательском запросе.

## Decision

Удалить `INTERVALS_ICU_ENABLED` и `STAGING_INTERVALS_ICU_ENABLED` из runtime и
deployment contracts.

Состояние интеграции определяется атомарной группой:

- `INTERVALS_ICU_CLIENT_ID`;
- `INTERVALS_ICU_CLIENT_SECRET`;
- `INTERVALS_ICU_REDIRECT_URI`;
- `INTEGRATION_ENCRYPTION_KEY_RING`;
- `INTEGRATION_ENCRYPTION_ACTIVE_KEY_ID`.

Если отсутствует вся группа, Intervals.icu adapter и worker не создаются. Если
присутствует вся группа, интеграция активируется автоматически. Любой частичный
набор отклоняется при проверке application config и deployment input. Точный
redirect URI должен использовать HTTPS.

GitHub Actions всегда передаёт пять значений из protected staging Environment.
Versioned deployment controller переносит их в root-owned API environment
только полным набором. Ручное редактирование VM не требуется.

## Considered alternatives

- **Сохранить отдельный enable flag.** Отклонено: флаг дублирует наличие полной
  конфигурации и уже привёл к успешному deployment без пользовательской
  функции.
- **Всегда требовать provider credentials.** Отклонено: локальные, unit и
  provider-neutral test environments должны работать без внешнего аккаунта.
- **Считать частичный набор выключенным состоянием.** Отклонено: это скрывает
  ошибку доставки secrets/configuration и откладывает диагностику.

## Consequences

- После доставки полного набора стабильных credentials/configuration
  интеграция доступна без второго ручного переключателя.
- Удаление всей группы остаётся способом собрать среду без Intervals.icu.
- Ошибка или неполная ротация любого значения останавливает startup/deployment,
  а не создаёт ложное состояние unavailable.
- OAuth, typed observations, deduplication, disconnect и erasure lifecycle не
  меняются.

## Verification

- Config unit tests проверяют полностью отсутствующую, полную и частичную
  группы.
- Deployment contract запрещает старый flag и требует атомарную передачу пяти
  значений.
- API tests подтверждают запуск без provider config и с полным fake/test
  config без реального Intervals.icu аккаунта.
- Staging enablement подтверждается только отдельным approved deployment и
  live OAuth smoke.

## Related material

- [Garmin через Intervals.icu](20260907-connect-garmin-through-intervals-icu.md)
- [Deployment](../wiki/architecture/deployment.md)

