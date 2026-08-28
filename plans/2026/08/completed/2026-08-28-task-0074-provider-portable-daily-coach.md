# TASK-0074 — Переносимый Daily Coach protocol без authority в чате

## Статус

- Архитектурный вариант B одобрен оператором 2026-08-28.
- Canonical ADR и current-state Wiki обновлены 2026-08-28.
- Independent Quality и Architecture Reviews дали `ACCEPT`.
- Provider implementation не входит в scope.
- Commit, push, deployment, staging writes и OAuth client registration не разрешены.

## Цель

Определить минимальную архитектуру, при которой Daily Coach может работать в
любом отдельно одобренном MCP client или provider session, сохраняя PostgreSQL
единственной operational authority и не превращая chat history в память,
fallback или источник фактов.

## План

1. Зафиксировать границу между provider-neutral Daily Coach protocol и
   существующим ChatGPT Work launcher.
2. Сравнить сохранение одного чата, protocol portability, multi-provider
   launcher registry и собственную chat platform.
3. Записать выбранный минимальный вариант в canonical ADR.
4. Обновить только затронутую current-state Wiki.
5. Провести независимые Quality и Architecture Reviews документационного
   решения и проверить canonical docs.

## Acceptance criteria

1. Chat/session не является authority и не синхронизируется между providers.
2. Каждая session восстанавливает состояние через `get_daily_projection` и
   необходимые typed MCP reads.
3. Существующий `chatgpt_work` launcher остаётся единственной поддержанной
   one-click surface и не обобщается преждевременно.
4. Новый provider допускается только отдельной задачей после capability probe
   remote MCP, OAuth, scopes, confirmation UX и typed read-back.
5. Provider token, OAuth client, callback, binding, service, database и chat UI
   не создаются этой задачей.
6. Unsupported или unavailable client работает fail closed без Sheets и chat
   history fallback.

## Проверка

- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- `4dt-board validate`;
- Independent Quality Review;
- Architecture Review по complexity, boundaries, DDD, duplication и
  simplification.
