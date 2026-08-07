# Static Web Client Rules

## Boundary

`apps/web` is the independently buildable Nuxt browser client. Its initial
production output is immutable static content shipped by the existing edge
image. It is not a backend, deployable runtime, data owner, or security-policy
authority.

- Do not add server routes, Nitro runtime handlers, databases, migrations,
  credentials, or secrets.
- Do not import implementation modules from `apps/api` or `apps/identity`.
- Call only published HTTP contracts. Keep browser/API adapters separate from
  presentation so a future SSR deployment does not change those contracts.
- Do not duplicate fitness-domain or Identity security policy in the client.

## Browser security

- Identity ceremonies execute only on the configured exact Identity origin.
- Initial enrollment accepts the bearer only from the URL fragment, removes
  the fragment before network access, and never persists or logs the value.
- Never store session, CSRF, enrollment, WebAuthn, or OAuth credentials in
  browser storage, logs, analytics, fixtures, screenshots, or rendered errors.
- Cookie-authenticated mutations must send the current session-bound CSRF
  cookie value in `X-CSRF-Token`. JavaScript must never attempt to access the
  HttpOnly session cookie.
- Do not add third-party scripts or analytics without a separate security and
  privacy decision.

## Accessibility and validation

- Use semantic HTML, keyboard-operable controls, visible focus, labelled
  fields, live status announcements, and reduced-motion-safe styling.
- Run `pnpm --filter @shape-of-you/web lint`, `typecheck`, `build`, and `test`.
- Verify the generated artifact contains no runtime server and no credential
  material.
