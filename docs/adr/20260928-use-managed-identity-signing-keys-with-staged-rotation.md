---
id: use-managed-identity-signing-keys-with-staged-rotation
kind: adr
title: "Хранить production signing keys во внешнем хранилище и ротировать через предварительную публикацию"
status: proposed
date: 2026-09-28
supersedes: []
superseded_by: null
tags:
  - architecture
  - identity
  - oauth
  - security
---

# Хранить production signing keys во внешнем хранилище и ротировать через предварительную публикацию

## Context

Принятый [Identity ADR](20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
разрешает local/staging private ES256 key ring в runtime environment и блокирует
production до выбора Vault/KMS-grade provider. Исходный `OAuthSigningKeyStore`
позволял сменить active signer при добавлении нового ключа, но отклонял новый
неактивный ключ без metadata. Репозиторная работа по этому плану добавляет
предварительную публикацию `kid` и локальный тест JWKS. Выдержка кэша,
retirement и аварийная процедура остаются непроверенными для production.

Проверка API использует удалённый JWKS с кэшированием. Краткий срок access token
снижает окно обычной ротации, но не делает украденный private key безопасным:
подпись по нему может быть признана действительной, пока resource server
принимает `kid`. API-owned `PersonAccessGrant` остаётся обязательным, однако
поддельный токен может указать уже связанный subject.

## Decision

Предлагается следующий production контракт:

1. Приватные ES256 signing keys принадлежат Identity и хранятся в отдельном
   versioned Vault/KMS-grade secret provider с workload-based доступом только
   Identity. PostgreSQL сохраняет только публичный ключ, `kid`, metadata и
   opaque provider handle. TLS keys остаются у edge. Конкретный provider,
   способ workload authentication, backup его состояния и модель доступа
   утверждаются до реализации; production не допускается при их отсутствии.
2. Для первого production сохранить совместимый с `oidc-provider` key-ring
   adapter: provider выдаёт ключ Identity только во время запуска/ротации,
   private material находится в памяти процесса и никогда не пишется в
   PostgreSQL, image, Git, логи или release manifest. Это сознательно не
   означает non-exportable KMS signing; такой переход требует отдельной оценки
   adapter и протокольной библиотеки.
3. Обычная ротация состоит из явных состояний `staged` → `active` →
   `verifying` → `retired`. Сначала Identity регистрирует новый неактивный
   `kid`, публикует его в JWKS и проверяет доступность через внешний issuer.
   После выдержки не меньше проверенного максимума JWKS cache lifetime и
   допустимого clock skew новый ключ становится active. Старый ключ остаётся
   в JWKS не меньше максимального срока уже выпущенного access/ID token плюс
   clock skew, затем удаляется из verification set и переводится в `retired`.
   Значения интервалов измеряются и фиксируются в runbook до активации.
4. Переход active signer и lifecycle metadata атомарен для одного Identity
   release; предварительная публикация — отдельный проверенный release.
   Неполная конфигурация, замена public material под старым `kid`, исчезновение
   обязательного verification key или расхождение provider/metadata
   останавливают запуск. Rollback не возвращает уже retired ключ к подписи.
5. При подозрении на компрометацию обычное overlap-ожидание не применяется.
   Incident runbook отзывает сессии и refresh families в затронутом scope,
   запрещает скомпрометированный `kid` на каждом resource server независимо от
   его JWKS cache, публикует новый ключ и проверяет отказ старых JWT.
   Возможный краткий отказ доступа считается безопаснее продолжения приёма
   скомпрометированной подписи.
6. Все операции записывают только типизированные security events с `kid`,
   временем, outcome и correlation ID; private material и токены не попадают
   в audit и telemetry. Назначаются владелец ротации, второй проверяющий и
   владелец реакции на alert.

Проект не меняет действующий ADR до принятия этого решения. OAuth/profile,
Person authorization и TLS ownership сохраняются.

## Considered alternatives

- **Оставить protected host key ring.** Минимум интеграции, но остаются ручная
  доставка, host compromise и отсутствие утверждённого production secret
  provider. Противоречит действующему production gate; потребует отдельного
  пересмотра Identity ADR. Не рекомендуется.
- **Non-exportable KMS signing.** Приватный ключ не выходит из provider, что
  уменьшает риск утечки из процесса. Потребует проверить поддержку внешней
  подписи в `oidc-provider` и изменить adapter; возможны latency и зависимость
  выпуска токенов от provider. Отложено до отдельного технического спайка.
- **Одношаговая смена активного ключа с прежним ключом в JWKS.** Уже близка к
  текущему коду, но resource server с кэшем может не знать новый `kid` при
  первом токене. Отклонено.
- **Ротация только по инциденту.** Уменьшает число операций, но не проверяет
  процедуру до критического события. Отклонено.

## Consequences

- В обычной ротации потребуется минимум два проверенных release и явное
  ожидание кэшей; выпуск нового JWT не должен опережать публикацию `kid`.
- Identity остаётся единственным владельцем подписи; API получает только
  публичную конфигурацию и emergency deny policy.
- Извлечение ключа в память оставляет риск компрометации процесса. Secret
  provider снижает риск хранения и доставки, но не устраняет его полностью.
- Без доступного provider новые экземпляры Identity не стартуют; действующие
  краткоживущие JWT остаются проверяемыми resource server в пределах policy.
- Emergency deny policy требует доставки на каждый resource server и проверки
  всех путей валидации токена, включая browser callback.

## Verification

- Integration tests проверяют `staged` publication до activation, JWKS cache
  cold/warm clients, старые и новые JWT, retirement и fail-closed ошибки.
- Incident drill проверяет запрет compromised `kid` при тёплом JWKS cache,
  отзыв refresh authority, недоступность provider и rollback release.
- Security Review проверяет workload identity, доступ к secret provider,
  отсутствие private material в БД/image/логах, аудит и runbook.
- До принятия ADR выбираются named provider, cache/clock интервалы,
  владельцы операций и подтверждённый механизм emergency deny на API.

## Related material

- [Identity service ADR](20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
- [Typed Identity lifecycle](20260803-model-identity-protocol-state-in-typed-lifecycle-tables.md)
- [Identity Wiki](../wiki/architecture/identity-and-external-tool-access.md)
- [Production hardening plan](../../plans/2026/09/2026-09-28-identity-production-hardening.md)
