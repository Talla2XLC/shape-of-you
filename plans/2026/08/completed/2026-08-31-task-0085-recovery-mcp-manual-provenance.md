# TASK-0085 — Manual provenance для Recovery-фактов из чата

Завершено 2026-08-31: исправление реализовано; Quality и Architecture Reviews
дали `ACCEPT`.

## Статус и основание

- Исправление реализует уже принятое решение ADR
  `docs/adr/20260831-model-wearable-sleep-score-and-normalize-recovery-mcp-input.md`:
  текст и screenshot, прочитанные ChatGPT, являются `manual` provenance.
- Нового архитектурного решения, сервиса, OAuth client или persistence boundary
  не требуется.
- Не разрешены staging/production writes, deployment, secrets, OAuth reconnect,
  Google Sheets actions, commit и push.

## Проблема

Connector schema всё ещё позволяет модели передать `sourceReference.channel =
device` и служебные `connectionId`/`consentId`. Такой command проходит внешнюю
JSON Schema, но затем домен корректно отклоняет его, потому что реального device
connection/consent у сообщения пользователя нет. MCP скрывает исключение общей
ошибкой, и пользователь не может сохранить даже однозначные Recovery-факты.

## Цель

Гарантировать на серверной MCP-границе, что Recovery-факт из сообщения или фото
пользователя записывается как manual report независимо от ошибочной
классификации модели, сохранив строгий device contract для реальных интеграций.

## Scope

1. В Recovery MCP normalizer всегда устанавливать manual provenance и nullable
   ownership для chat-originated writes.
2. Не доверять переданным моделью `device`, `connectionId` и `consentId`.
3. Уточнить connector schema/description, что источник на фото не превращает
   chat report в прямую device integration.
4. Не пропускать производную `sleepQuality`, когда модель ошибочно
   классифицировала wearable screenshot как `device`; wearable score должен
   сохраняться отдельной typed-метрикой без конвертации.
5. Добавить regression test: legacy/cached command с `channel = device` и без
   connection/consent нормализуется в валидный manual command и доходит до
   Recovery service.
6. Выполнить focused/full tests, typecheck, lint, build, docs validation,
   независимые Quality и Architecture Reviews.

## Acceptance criteria

1. Точный сценарий `474 min` и `HRV 48 ms` со screenshot не падает на device
   consent invariant.
2. Переданные через MCP `channel = device`, connection и consent не достигают
   domain service; normalized command содержит manual/null ownership.
3. Прямой API/device contract и active-consent enforcement не меняются.
4. Tool count, OAuth scopes, PostgreSQL authority и deployable topology не
   меняются.
5. Регрессия воспроизводится тестом до исправления и закрывается после него.

## Риски и stop conditions

- Если для ChatGPT действительно потребуется direct device connection, это
  отдельный OAuth/provider проект и отдельное архитектурное решение.
- Если исправление потребует изменения Recovery storage/domain model, вернуться
  к архитектурному согласованию; текущий fix должен остаться в MCP adapter.
- Staging verification с реальными writes требует отдельного подтверждения.
