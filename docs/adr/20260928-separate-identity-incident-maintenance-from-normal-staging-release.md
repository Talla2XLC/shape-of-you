---
id: 20260928-separate-identity-incident-maintenance-from-normal-staging-release
kind: adr
title: "Отделить аварийное обслуживание Identity от обычного staging release"
status: accepted
date: 2026-09-28
supersedes: []
superseded_by: null
tags:
  - identity
  - oauth
  - deployment
  - security
---

# Отделить аварийное обслуживание Identity от обычного staging release

## Context

[Решение о временных signing keys](20260928-temporarily-use-host-managed-identity-signing-keys.md)
предусматривает остановку OAuth выдачи при компрометации и публикацию нового
`kid` через JWKS до активации. Режим `IDENTITY_OAUTH_ISSUANCE_DISABLED=true`
намеренно возвращает `503` для `/ready` и всех путей выдачи. Обычный staging
deployment требует здоровый Compose service и внешний `/ready=200`, поэтому
он не может безопасно доставлять промежуточные аварийные фазы. Кроме того,
старый API image без локального `kid` deny нельзя возвращать автоматическим
rollback даже при совместимой схеме.

## Decision

1. Обычный `Promote staging` сохраняет строгие readiness и smoke gates.
   JWKS-only режим не проводится через этот release path.
2. Отдельный операторский maintenance path работает только с уже проверенными
   и развёрнутыми digest-pinned images, под общим deployment lock. Перед любым
   staging deployment, включая direct recovery dispatch, workflow сверяет API
   digest с artifact успешного `Publish staging images` для точного commit SHA.
   Candidate, созданный после проверки обоих API deny путей в CI, несёт
   явный versioned capability marker. Старый candidate может применяться для
   обычного recovery, но не даёт права начать incident maintenance. Runtime
   probe внутри API container дополнительно проверяет текущую deny policy.
   Оператор с
   отдельным разрешением готовит полный кандидат `api.env` для первой фазы и
   полный кандидат `identity.env` для каждой фазы как root-owned файлы режима
   `0600` вне Git. Команда не печатает их содержимое. Фиксированные фазы:
   `stage`, `activate`, `retire`, `resume`; переход назад запрещён.
3. `stage` сначала доставляет API deny policy и новый API browser-session
   cookie key без сохранения старого verification key, проверяет API readiness,
   происхождение digest из успешной CI публикации и runtime deny capability.
   Поле release manifest принимается только как результат сверки candidate,
   а не как утверждение контроллера или оператора. Затем stage запускает Identity в JWKS-only режиме
   и глобально отзывает Identity
   sessions, session authorizations и refresh families. Внешняя проверка
   должна разобрать пригодные ES256 JWK в массиве `keys`, увидеть ожидаемые
   metadata и `503` для выдачи/`/ready`. Время первой успешной внешней
   проверки JWKS сохраняется в incident marker.
4. `activate` и `retire` меняют только Identity runtime ring при выключенной
   выдаче. `activate` дополнительно ждёт не менее policy interval от
   зафиксированной внешней публикации; метаданные signing-key lifecycle
   также блокируют преждевременный
   переход. Внешние проверки подтверждают новый `kid`, затем исчезновение
   старого. `resume` разрешён только после retirement и возвращает обычный
   `/ready=200` при сохранённом API deny.
5. Активный incident marker запрещает обычный deployment и любой rollback.
   После `resume` marker остаётся до нового полного проверенного Identity
   deployment, который восстанавливает согласованность immutable release
   manifest и runtime environment. При активной deny policy автоматический и
   ручной rollback остаётся закрытым независимо от schema/client flags.
   Сбой любой фазы оставляет обслуживание закрытым до расследования.
6. Этот path не даёт общего доступа к Docker или shell из CI. Реальные
   команды на VM, секреты, staging/production deployment и отзыв authority
   требуют отдельных явных разрешений. До production нужен локальный
   воспроизводимый incident drill, затем Security Review и внешний drill.

## Considered alternatives

- **Использовать обычный Promote со специальным `503` исключением.** Это
  ослабило бы критерий готовности для штатных релизов и усложнило rollback.
- **Ручное редактирование runtime env и release manifest без контроллера.**
  Короче в коде, но создаёт дрейф и не обеспечивает проверяемый порядок фаз.
- **Немедленно активировать replacement key.** Клиенты с тёплым JWKS cache
  могут отвергнуть новые токены; оператор выбрал временный отказ доступа.
- **Убрать direct recovery dispatch.** Исключает произвольный digest, но
  лишает оператора восстановления из проверенного исторического candidate.
  Повторная верификация публикации сохраняет этот путь с fail-closed gate.

## Consequences

- Incident может вызвать длительный отказ OAuth login/refresh: минимум два
  интервала по 660 секунд плюс действия оператора и проверки. API остаётся
  доступным только в пределах оставшейся разрешённой authority.
- Операционный path добавляет отдельный root-owned state marker и тесты фаз;
  нормальный релиз остаётся строгим и не знает успешной maintenance фазы как
  полноценного нового release.
- Повторная публикация после incident требует полного Identity deployment,
  а не неявного восстановления старого manifest.
- Direct recovery с произвольным или уже недоступным candidate artifact
  закрывается до новой проверенной публикации либо отдельного архитектурного
  решения. Artifact сейчас хранится ограниченное время; это сужает
  историческое окно восстановления.

## Verification

- Локальный incident drill проходит все четыре фазы с контролем внешнего
  JWKS, ожидаемых HTTP статусов, отзыва authority, ложного JWKS,
  warm/cold JWT acceptance и запрета преждевременного перехода.
- Контрактные тесты подтверждают, что обычные deployment/smoke не принимают
  maintenance режим, а rollback закрыт при deny policy или active marker.
- Security Review проверяет права файлов, отсутствие secret output,
  восстановление после сбоя фазы и ручное rebaseline release metadata.

## Related material

- [Signing-key decision](20260928-temporarily-use-host-managed-identity-signing-keys.md)
- [Identity hardening plan](../../plans/2026/09/2026-09-28-identity-signing-key-retirement-and-emergency-deny.md)
- [Staging deployment](../wiki/operations/temporary-vm-deployment.md)
