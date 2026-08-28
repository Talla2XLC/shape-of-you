# TASK-0072 — Coach в новой вкладке и понятный CTA

## Статус

- Реализация завершена локально 2026-08-28.
- Independent Quality Review дал `ACCEPT`.
- Canonical Wiki актуализирована после отдельного одобрения оператора.
- Commit, push и deployment не входят в разрешённый scope.

## Проблема

CTA на странице Progress открывает постоянный Coach conversation в текущей
вкладке. Пользователь теряет открытый контекст Shape of You, а текст
`Open Shape of You Coach` описывает техническое действие вместо ожидаемого
диалога.

## Решение

1. Переименовать CTA в `Chat with your AI Coach`.
2. Открывать существующий `/api/v1/chat-assistant/launch` в новой вкладке с
   изоляцией `window.opener`.
3. Не менять API, OAuth, Person-owned conversation binding и fail-closed
   поведение launcher.
4. Обновить browser E2E для успешного и misconfigured сценариев.
5. После Quality acceptance актуализировать только затронутое описание в
   canonical Wiki; новый ADR не требуется.

## Acceptance criteria

1. CTA имеет accessible name `Chat with your AI Coach`.
2. CTA сохраняет существующий launcher route и открывает новый top-level
   browsing context с `rel="noopener"`.
3. При успешном launch исходная страница `/progress` остаётся открытой, а новая
   вкладка переходит в существующий Coach conversation.
4. При misconfigured binding новая вкладка остаётся на Web origin и показывает
   fail-closed сообщение без прямого ChatGPT fallback.
5. Релевантные Web checks и Independent Quality Review проходят.

## Validation

- targeted Playwright tests для Progress launcher;
- Web lint, typecheck и build;
- `node scripts/validate-docs.mjs` после post-acceptance alignment;
- `git diff --check`;
- `4dt-board validate`.
