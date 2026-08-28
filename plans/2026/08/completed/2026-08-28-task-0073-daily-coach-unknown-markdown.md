# TASK-0073 — Unknown semantics и чистый Markdown в Daily Coach

## Статус

- Реализация завершена локально 2026-08-28.
- Independent Quality Review дал `ACCEPT`.
- Canonical Wiki актуализирована после acceptance.
- Commit, push и deployment не входят в разрешённый scope.

## Проблема

После ошибки typed read Coach одновременно сообщил, что активный план не
читается, и сделал неподтверждённый вывод об отсутствии тренировки. Ответ также
содержал HTML entities `&#x20;` вместо обычного Markdown.

## Решение

1. Закрепить в API-owned MCP initialization instructions, что failed,
   unavailable, incomplete или inconsistent typed read означает `unknown`, а
   не отсутствие, ноль или отсутствие плана.
2. Запретить dependent factual conclusions и требовать omission либо явную
   qualification зависимых предложений.
3. Требовать обычный Markdown без HTML entities и encoded whitespace.
4. Закрепить оба правила unit contract-тестом initialization response.
5. Не менять tools, schemas, OAuth, API, данные или provider bindings.

## Acceptance criteria

1. MCP instructions явно определяют unknown-not-absent semantics.
2. Failed read не может доказывать `no plan`, zero или другой dependent fact.
3. User-facing Daily Coach output требует plain Markdown без HTML entities.
4. Initialize response возвращает точные усиленные instructions.
5. Релевантные API checks и Independent Quality Review проходят.

## Validation

- targeted `mcp-server.unit.test.ts`;
- API lint, typecheck и build;
- `node scripts/validate-docs.mjs` после post-acceptance alignment;
- `git diff --check`;
- `4dt-board validate`.
