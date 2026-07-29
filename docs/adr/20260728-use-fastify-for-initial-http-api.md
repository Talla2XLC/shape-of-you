---
id: "decisions-20260728-use-fastify-for-initial-http-api"
kind: adr
title: "Fastify для начального HTTP API"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - "api"
  - "runtime"
  - "technology"
---

# Fastify для начального HTTP API

## Контекст

DEV-023 требует один минимальный зрелый HTTP runtime с runtime validation,
structured logging, единым error handler, graceful shutdown и OpenAPI из тех
же schemas, которые проверяют запросы и ответы. Отдельный framework spike не
оправдан, а собственный framework layer увеличил бы стоимость первой
вертикали.

## Решение

Использовать Fastify для начального deployable API в `apps/api`.

Route schemas задаются как JSON Schema в `packages/contracts`. Fastify
использует их для runtime validation и serialization, Type Provider — для
TypeScript inference, а Swagger plugin — для построения OpenAPI. Встроенный
Pino logger используется для JSON structured logging. `fastify.close()`
является границей graceful shutdown.

Решение относится к одному начальному modular backend и не создаёт
обязательство использовать Fastify во всех будущих deployables.

## Рассмотренные альтернативы

- Express: зрелая и широко известная экосистема, но validation, typed schemas,
  logging и OpenAPI потребовали бы больше самостоятельной композиции и
  дополнительных точек рассинхронизации.
- Hono: компактный и современный runtime с хорошей переносимостью, но текущей
  задаче важнее зрелая server-side plugin model и прямой путь к JSON Schema,
  Pino и lifecycle PostgreSQL API.
- Собственный Node.js HTTP layer: минимальное число dependencies, но
  неоправданная реализация routing, validation, errors и shutdown вместо
  продуктовой вертикали.

## Последствия

- API получает единый validation/error/logging lifecycle без собственного
  framework abstraction.
- Contracts должны оставаться transport schemas и не содержать domain
  implementation.
- Fastify и его plugins являются runtime dependencies deployable API и должны
  обновляться совместимым набором.
- Замена framework или добавление второго HTTP stack требует нового ADR.

## Проверка

- Build и typecheck подтверждают Type Provider integration.
- Tests проверяют validation, единый error shape и OpenAPI.
- Integration tests проверяют HTTP routes с PostgreSQL.
- Docker smoke проверяет запуск и graceful lifecycle при доступном Docker.

## Связанные материалы

- [План DEV-023](../../plans/2026/07/completed/2026-07-28-backend-bootstrap-and-weight-vertical.md)
- [Репозиторий и runtime](../wiki/architecture/repository-and-runtime.md)
- [Node.js, TypeScript и pnpm workspaces](20260728-use-nodejs-typescript-and-pnpm-workspaces.md)
