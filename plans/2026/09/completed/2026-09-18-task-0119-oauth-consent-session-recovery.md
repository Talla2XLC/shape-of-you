# TASK-0119 — Восстановление стабильной OAuth-сессии при consent

Статус: завершён 2026-09-18; Quality Review и Architecture Review приняты.

## Контекст и разрешение

После автоматического staging deployment пользователь воспроизвёл два
последовательных reconnect-дефекта: `authentication_required` при отсутствии
browser-session и `Internal Server Error` после `Allow`. Read-only staging logs
по отдельному разрешению оператора установили точную вторую причину:
`oauth_sessions_provider_uid_uq` при попытке связать существующую provider
session с новой application-session.

Оператор одобрил сохранение стабильного `oauth_sessions` aggregate командой
«го» 2026-09-18. Решение зафиксировано в
[ADR](../../../../docs/adr/20260918-preserve-stable-oauth-session-during-consent-reauthentication.md).
План реализации одобрен оператором командой «Go» 2026-09-18.

## Scope

- Восстановить consent reauthentication без новой session row.
- Сохранить provider UID/credential, grants, authorizations и refresh families
  на прежнем session ID.
- Ротировать только browser credential/CSRF и passkey binding под exact pending
  consent interaction.
- Добавить полный regression от WebAuthn verify до callback, code exchange и
  rotation ранее выданного refresh token.
- Не менять DailyRecommendationFeedback, Coach policy, OAuth scope model,
  схему БД, deploy topology или runtime env.

## Этапы реализации

1. Расширить internal WebAuthn authentication verification input optional
   `oauthInteractionCredential`, сохранив strict validation и совместимость
   существующих callers.
2. Передавать interaction credential только из consent recovery page; обычный
   OAuth login и general browser login не должны выбирать существующую session.
3. В `IdentityAuthenticationService` после успешной WebAuthn verification
   выполнить transaction branch для exact consent recovery:
   - найти interaction по credential hash;
   - потребовать `pending`, unexpired и prompt `consent`;
   - заблокировать interaction и связанную active session;
   - проверить совпадение authenticated account;
   - ротировать browser credential и CSRF hashes, WebAuthn credential binding,
     activity/expiry внутри той же session row;
   - записать typed `passkey_authentication` event с тем же session ID.
4. Сохранить текущий branch создания новой session для вызовов без interaction
   context и OAuth `login` prompt.
5. Не изменять `provider_uid`, `provider_credential_hash`, session ID,
   provider authentication timestamp, grants, authorizations, codes и refresh
   families.
6. Обеспечить rollback без частичных mutations для wrong-account, stale,
   completed, abandoned, wrong-prompt и concurrent replay.
7. Добавить browser E2E: missing browser-session → passkey → reload → consent →
   Allow → provider resume → ChatGPT callback.
8. Добавить PostgreSQL integration pins:
   - stable session ID и provider binding;
   - отсутствие новой session row;
   - старый browser credential invalid, новый valid;
   - old refresh token продолжает rotation;
   - authorization code после reconnect обменивается;
   - wrong-account/no-mutation;
   - exact interaction state validation;
   - concurrent/replayed challenge.
9. Выполнить Identity unit/integration/browser suites, typecheck, lint, build,
   repository-wide regression gates, docs validation и `git diff --check`.
10. Передать frozen diff независимому Quality Review. После acceptance провести
    отдельный Architecture Review по session lifecycle, security boundaries и
    отсутствию лишней сложности.
11. После reviews синхронизировать только затронутый current-state Wiki раздел
    и changelog; ADR остаётся источником decision history.

## Acceptance criteria

1. Reconnect с действующей provider cookie и отсутствующей browser cookie не
   возвращает JSON 401 или HTTP 500.
2. После passkey и `Allow` browser достигает точного ChatGPT callback с code и
   исходным state.
3. До и после recovery сохраняются session ID, provider UID, provider
   credential ownership, grants и refresh-token family.
4. Refresh token, выданный до recovery, успешно ротируется после recovery.
5. Предыдущий browser credential больше не авторизует запросы; новый credential
   требует новый session-bound CSRF token.
6. Другой account, неизвестный/stale/completed interaction и wrong prompt
   отклоняются без mutation и без утечки состояния.
7. Concurrent/replayed verification не создаёт вторую session и не нарушает
   unique constraints.
8. Обычный passkey login по-прежнему создаёт независимую session; recovery
   branch невозможно вызвать без exact interaction credential.
9. В логах нет credentials, cookies, token values, interaction IDs или OAuth
   query parameters.
10. Изменение не требует migration, нового env, ручного provisioning или
    изменения deployable boundaries.

## Проверки

- `pnpm --filter @shape-of-you/identity test:unit`
- `pnpm --filter @shape-of-you/identity test:integration`
- `pnpm --filter @shape-of-you/identity exec playwright test test/e2e/oauth-browser-ui.spec.ts`
- `pnpm --filter @shape-of-you/identity typecheck`
- `pnpm --filter @shape-of-you/identity lint`
- `pnpm --filter @shape-of-you/identity build`
- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm lint`
- `pnpm build`
- `node scripts/validate-docs.mjs`
- `git diff --check`
- `4dt-board validate`
- независимый Quality Review
- отдельный Architecture Review

## Риски и ограничения

- Session aggregate содержит одновременно browser и provider authority;
  transaction branch обязан сохранить их единый lifecycle.
- Interaction credential является bearer-like opaque correlation value и не
  должен логироваться или становиться общим session selector.
- Повторная аутентификация не меняет provider authentication timestamp; свежий
  passkey фиксируется отдельным typed security event.
- До staging deployment постоянного исправления временный workaround — удалить
  site data только для `identity.staging.shape-of-you.ru` и начать reconnect
  заново.

## Отдельные operator gates

После принятой реализации отдельно требуются разрешения на:

1. commit;
2. push;
3. staging deployment;
4. live OAuth reconnect verification;
5. любые дополнительные staging logs или data inspection;
6. production deployment.
