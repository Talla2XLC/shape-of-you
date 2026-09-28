---
id: temporarily-use-host-managed-identity-signing-keys
kind: adr
title: "Временно хранить production signing keys на одной VM"
status: accepted
date: 2026-09-28
supersedes: []
superseded_by: null
tags:
  - architecture
  - identity
  - oauth
  - security
---

# Временно хранить production signing keys на одной VM

## Context

Принятый [Identity ADR](20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
разрешал private ES256 key ring в runtime environment только для local/staging
и блокировал production до выбора Vault/KMS-grade provider. Сейчас доступна
одна VM, а оператор выбрал временно принять риск её потери и компрометации,
чтобы не вводить отдельный secret provider до появления инфраструктуры.
Это решение изменяет только production provider gate исходного ADR; владение
Identity, протокольный профиль, API-owned Person authorization и TLS ownership
сохраняются.

Текущий staging handoff уже передаёт signing key ring в root-owned Identity
runtime environment. PostgreSQL хранит публичный SPKI, `kid`, lifecycle
metadata и `env:<kid>` handle; private material остаётся вне БД. Код умеет
предварительно публиковать новый `kid`, но bounded overlap, retirement и
emergency deny при тёплом JWKS cache пока не реализованы полностью. API
проверяет Identity JWT в MCP bearer и browser OAuth callback через
кэшируемый JWKS.

## Decision

1. Для первого production этапа допускается versioned host-managed ES256 key
   ring на той же VM. Только Identity получает private material через
   owner-controlled runtime environment. Файл handoff принадлежит root,
   доступен только владельцу (`0600`) и создаётся из защищённого delivery
   secret; он не входит в Git, image, PostgreSQL, release manifest, backup
   dump, логи или API runtime environment. Проверка владельца и режима файла
   входит в production deployment gate. TLS private keys остаются у edge.
2. Это временное исключение из требования Vault/KMS-grade provider, а не
   утверждение эквивалентной защиты. Компрометация VM или root может раскрыть
   signing keys; потеря VM может уничтожить их единственную копию. Для этого
   сценария нет гарантированного восстановления. Отдельный provider и
   независимая копия секретов потребуют нового решения и drill.
3. Обычная ротация использует `staged` → `active` → `verifying` →
   `retired`. Новый публичный `kid` появляется во внешнем JWKS в отдельном
   проверенном release до первой подписи. Активация ждёт не меньше
   измеренного максимума JWKS cache lifetime плюс допустимый clock skew.
   Старый `kid` остаётся проверяемым не меньше максимального срока ранее
   выданных access/ID tokens плюс clock skew. Численные интервалы
   фиксируются в runbook по измерению, до первой production ротации.
4. Retirement выполняется как согласованное изменение metadata и runtime
   ring: после проверки overlap старый ключ исчезает из опубликованного JWKS,
   перестаёт быть доступен для подписи и переходит в `retired` до открытия
   Identity трафика. Startup отказывает при отсутствующем обязательном ключе,
   подмене public material под существующим `kid`, повторной публикации
   `retired`/`revoked` key или несоответствии ring и metadata. Rollback
   никогда не возвращает retired key к подписи.
5. При подозрении на компрометацию доступ закрывается до истечения обычного
   overlap, а сам overlap сохраняется как консервативный retirement gate.
   API получает локальную versioned deny policy для `kid`, независимую от
   JWKS cache, и применяет её на обоих текущих путях Identity JWT:
   MCP bearer и browser OAuth callback. Incident порядок: запретить `kid`
   на API и инвалидировать API browser sessions, остановить выдачу токенов
   Identity, отозвать затронутые Identity sessions и refresh families,
   опубликовать replacement key в режиме только metadata/JWKS, выдержать
   publication interval, затем активировать и позднее вывести старый key.
   Выдача возобновляется только после проверки отсутствия старого `kid` в
   JWKS. Оператор принял временный отказ OAuth login/refresh на время этой
   процедуры вместо отдельного аварийного перехода с досрочной активацией.
   Если deny policy не доставлена,
   затронутый API путь остаётся закрытым; короткий отказ доступа допустим.
   Новые resource servers обязаны принять тот же deny contract.
6. Операции оставляют типизированный security audit с `kid`, временем,
   outcome и correlation ID без токенов и private material. Оператор владеет
   ротацией и incident response; производственная процедура требует
   проверяемый checklist и подтверждение результата внешними запросами.
   Перед production deployment проходят независимый Security Review и
   воспроизводимый OpenID/OAuth conformance run.

## Considered alternatives

- **Versioned Vault/KMS-grade secret provider.** Снижает риск хранения и
  доставки на VM и остаётся целевой архитектурой. Сейчас provider и отдельная
  инфраструктура отсутствуют; требование блокировало бы выбранный временный
  single-VM этап.
- **Non-exportable KMS signing.** Не выдаёт private material процессу, но
  требует отдельной проверки external signing adapter в `oidc-provider`,
  добавляет latency и зависимость выпуска токенов от provider. Отложено.
- **Одношаговая смена active signer.** Может выпустить JWT с `kid`, которого
  ещё нет в кэше resource server. Отклонена.
- **Ротация только после инцидента.** Не проверяет процедуру до критического
  события. Отклонена.

## Consequences

- Production может использовать текущую single-VM topology после реализации
  lifecycle и остальных production gates; этот ADR сам по себе не означает
  готовность к production и не разрешает deployment или доступ к секретам.
- Ротация требует минимум двух проверенных release и измеренного ожидания.
- API получает только public JWKS trust и локальную deny policy; private
  signing material остаётся в Identity runtime boundary.
- Host compromise и VM loss остаются принятыми рисками. Краткоживущие JWT,
  Person grant и security audit уменьшают часть последствий, но не делают
  украденный private key безопасным.
- Переход на внешний provider позже сохраняет `kid`, metadata и двухфазный
  lifecycle, но меняет delivery adapter и потребует отдельного ADR.

## Verification

- Integration tests: staged publication и cold/warm JWKS, activation после
  заданного ожидания, старые и новые JWT, retirement, rollback и fail-closed
  ошибки ring/metadata.
- Incident drill: оба API пути отвергают compromised `kid` при тёплом JWKS
  cache; refresh authority отозвана; replacement key работает.
- Deployment check: root-owned mode-`0600` runtime handoff, Identity-only
  access, отсутствие private material в БД, image, Git, логах и manifest.
- Security Review проверяет key handling, операционный checklist, incident
  order и ограничения одной VM. Conformance evidence и измеренные
  cache/clock интервалы сохраняются до production go/no-go.

## Related material

- [Identity service ADR](20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
- [Typed Identity lifecycle](20260803-model-identity-protocol-state-in-typed-lifecycle-tables.md)
- [Identity Wiki](../wiki/architecture/identity-and-external-tool-access.md)
- [Production hardening plan](../../plans/2026/09/2026-09-28-identity-production-hardening.md)
- [Single-VM recovery risk](20260928-accept-single-vm-identity-recovery-risk.md)
