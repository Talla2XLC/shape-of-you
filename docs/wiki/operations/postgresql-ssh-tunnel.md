---
id: "operations-postgresql-ssh-tunnel"
kind: architecture
title: "SSH tunnel к PostgreSQL staging"
status: draft
tags:
  - "postgresql"
  - "ssh"
  - "staging"
---

# SSH tunnel к PostgreSQL staging

## Кратко

PostgreSQL доступен на внешнем port `5431` без SSL. Для IDE рекомендуется SSH
tunnel, чтобы database traffic не передавался открыто через публичную сеть.

## Содержание

После отдельного approval на SSH access локальный tunnel создаётся без вывода
credentials:

```sh
ssh -N -L 15431:127.0.0.1:5431 <ssh-user>@2.58.15.24
```

IDE подключается к:

```text
host: 127.0.0.1
port: 15431
database: shape_of_you_api
user: shape_of_you_api
SSL: disabled
```

SSH host key должен быть проверен через доверенный канал. Private key не
копируется в repository, документацию или task timeline.

Текущий прямой доступ к `2.58.15.24:5431` остаётся свойством чужого
PostgreSQL deployment. Shape of You его не создаёт и не считает частью своей
security topology.

## Основания

- Подтверждённый прямой доступ к PostgreSQL 17.4 без SSL.
- Security gate throwaway staging.

## Решения

- Tunnel рекомендуется для IDE, но не используется API container.
- API подключается через `host.docker.internal:5431`.

## Открытые вопросы

- Firewall policy внешнего port `5431` контролируется владельцем VM.

## Связанные материалы

- [Deployment topology](../architecture/deployment.md)
- [Временный deployment](temporary-vm-deployment.md)
