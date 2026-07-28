---
id: "architecture-local-development"
kind: architecture
title: "Локальный запуск backend"
status: draft
tags:
  - "development"
  - "docker"
  - "runtime"
---

# Локальный запуск backend

## Кратко

Для полного локального запуска нужны Node.js 24, pnpm 11 и Docker с Compose.
Compose поднимает PostgreSQL, применяет migrations и запускает API.

## Содержание

Полный containerized запуск:

```powershell
docker compose up --build
```

После readiness API доступен на `http://localhost:3000`; проверки:

```powershell
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod http://localhost:3000/ready
Invoke-RestMethod http://localhost:3000/openapi.json
```

Host development:

```powershell
pnpm install
Copy-Item .env.example .env
pnpm db:migrate
pnpm dev
```

Validation:

```powershell
pnpm lint
pnpm typecheck
pnpm build
pnpm test
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-docs.ps1
```

`pnpm test` включает integration suite и требует working container runtime.
`pnpm test:unit` запускает только быстрые проверки без Docker.

## Основания

- `package.json`, `pnpm-workspace.yaml` и `.env.example`.
- `docker-compose.yml` и `apps/api/Dockerfile`.
- Проверенные локально build, typecheck, lint и unit tests.

## Решения

- [Docker Compose для локальной разработки](../../adr/20260728-use-docker-compose-for-local-development.md).

## Открытые вопросы

- Compose smoke и integration suite должны быть повторно выполнены в среде с
  Docker; текущая Codex-среда не предоставляет container runtime.

## Связанные материалы

- [Backend runtime](backend-runtime.md)
- [Migration notes](../data/backend-migrations.md)
