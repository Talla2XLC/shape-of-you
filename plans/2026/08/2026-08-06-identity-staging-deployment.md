# Автоматическое развёртывание Identity на staging

## Цель

Включить `apps/identity` в существующий автоматический staging-релиз, сохранив
отдельные образ, базу данных, credentials, миграции и runtime-конфигурацию
Identity.

## Подтверждённая архитектура

- Identity публикуется отдельным digest-pinned OCI-образом.
- API и Identity получают разные `DATABASE_URL` через разные root-owned env-файлы.
- Identity-миграции выполняются отдельным one-shot контейнером до запуска нового
  Identity runtime.
- Существующий edge проксирует `identity.staging.shape-of-you.ru` в Identity по
  внутренней Docker-сети; TLS остаётся ответственностью edge/Certbot.
- API, Identity, edge и Certbot входят в один согласованный staging-релиз и
  используют один release id, но сохраняют сервисные границы.
- Rollback откатывает образы API, Identity и edge; миграции баз данных назад не
  откатываются. Автоматический rollback Identity-релиза требует отдельного
  подтверждения обратной совместимости миграций API и Identity.

## Этапы

1. [x] Добавить публикацию Identity image и обратно совместимую поддержку его
   digest в проверяемый протокол root-owned deployment wrapper.
2. [x] Создать отдельный root-owned `identity.env` из
   `STAGING_IDENTITY_DATABASE_URL` и неизменяемой публичной конфигурации staging.
3. [x] Добавить `identity` и `identity-migrate` в опциональный Compose overlay
   без host ports и с
   отдельной database-access сетью.
4. [x] Запускать Identity migrations до runtime и ждать `/ready` перед запуском
   edge.
5. [x] Заменить Identity `503` placeholder на reverse proxy и добавить HTTPS
   smoke для `/live` и `/ready`.
6. [x] Подготовить Identity в rollback, preflight и regression contracts с
   сохранением работоспособности старых release manifests.
7. [x] Обновить только затронутые Wiki/runbook страницы и основной Identity
   план; ADR не требуется, потому что решение уже принято.
8. [ ] Прогнать lint, typecheck, build, unit/integration tests, Compose renders,
   shell contracts, проверку документации и Architecture Review.

## Граница первого развёртывания

Репозиторная автоматизация не создаёт PostgreSQL database/login и не читает
секреты. Перед первым deployment оператор отдельно создаёт
`shape_of_you_identity`, выдаёт Identity-owned credentials, добавляет секрет
`STAGING_IDENTITY_DATABASE_URL`, устанавливает обновлённый root-owned wrapper и
только затем разрешает deployment/migration на VM.

## Критерии готовности

- `main` публикует и аттестует отдельный Identity image.
- Deployment отвергает отсутствующий или некорректный Identity digest/URL.
- API credentials не используются Identity и наоборот.
- Identity migration chain применяется воспроизводимо до запуска сервиса.
- `https://identity.staging.shape-of-you.ru/live` и `/ready` проходят smoke.
- Rollback и оба Compose topology render включают Identity без публикации его
  host ports.
