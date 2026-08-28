---
id: "decisions-20260828-resolve-replaceable-staging-upstreams-at-runtime"
kind: adr
title: "Разрешать адреса заменяемых staging upstream во время работы edge"
status: accepted
date: 2026-08-28
supersedes: []
superseded_by: null
tags:
  - "deployment"
  - "nginx"
  - "staging"
---

# Разрешать адреса заменяемых staging upstream во время работы edge

## Context

Staging deployment пересоздаёт контейнеры API и Identity перед edge. Docker
назначает новым контейнерам новые адреса, а nginx с обычным hostname в
`proxy_pass` разрешает адрес при загрузке конфигурации и может продолжать
обращаться к удалённому контейнеру до собственного restart.

Run `33116025289` подтвердил окно: API начал пересоздаваться в `21:07:00Z`,
стал healthy в `21:07:35Z`, а edge начал пересоздаваться только в `21:07:37Z`.
Попавший в это окно Web request получил fail-closed экран. Client retry снижает
влияние сбоя, но не исправляет deployment contract.

## Decision

Определить API и Identity как именованные nginx upstream groups с shared memory
zones. Использовать Docker embedded DNS `127.0.0.11` и параметр `resolve`, чтобы
долгоживущий edge отслеживал смену адресов контейнеров без reload или restart.

Сохранить один API, один Identity и один edge container, существующие Docker
network aliases, routes, timeouts, headers и fail-closed static boundary.
Runtime regression обязан удалить и создать заново каждый upstream под тем же
alias и доказать, что неизменный edge начинает направлять запросы в новый
container.

## Considered alternatives

- Перезапускать или останавливать edge перед API/Identity: отклонено, потому
  что это превращает адресную гонку в намеренный полный downtime.
- Сохранить только bounded retry в Web: отклонено как лечение симптома; другие
  API и OAuth routes остаются уязвимыми.
- Ввести blue-green slots и health-gated switch: даёт более сильную гарантию
  непрерывности, но добавляет deployment state, replicas и эксплуатационную
  сложность без текущего SLO, оправдывающего их.
- Использовать variable-based `proxy_pass`: возможно, но сильнее затрагивает
  URI rewriting semantics каждой location, чем именованные upstream groups.

## Consequences

Edge перестаёт удерживать адрес удалённого API или Identity до собственного
restart. Существующие deployable boundaries и release coordinates не меняются.

Однорепличный runtime всё ещё может кратко быть недоступен между остановкой
старого процесса и готовностью нового. Это решение устраняет stale-address
период после появления нового контейнера, но не заявляет zero-downtime. Если
появится соответствующий SLO, blue-green deployment потребует отдельного ADR.

Edge зависит от доверенного Docker embedded DNS внутри своей Compose network.
Выбранный edge base image `nginxinc/nginx-unprivileged:1.27-alpine` принимает
open-source upstream `resolve`, доступный начиная с nginx 1.27.3; runtime test
проверяет конфигурацию фактической сборкой и запуском image.

## Verification

- Static contract проверяет resolver, shared zones, `resolve` и использование
  именованных upstream во всех зарезервированных routes.
- Runtime E2E заменяет API и Identity containers без restart edge и проверяет
  новые response markers через прежний published edge port.
- Existing tests продолжают проверять TLS, static fallback, route ownership,
  security headers и upstream fail-closed behavior.

## Related material

- [Deployment topology](../wiki/architecture/deployment.md)
- [Stable deployment controller](20260807-use-stable-root-bootstrap-and-versioned-deployment-controller.md)
- [TASK-0071 plan](../../plans/2026/08/completed/2026-08-28-task-0071-runtime-dns-upstreams.md)
