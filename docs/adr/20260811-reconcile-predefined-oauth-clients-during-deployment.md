---
id: "decisions-20260811-reconcile-predefined-oauth-clients-during-deployment"
kind: adr
title: "Reconcile predefined OAuth clients during deployment"
status: accepted
date: 2026-08-11
supersedes: []
superseded_by: null
tags:
  - "deployment"
  - "identity"
  - "oauth"
  - "operations"
  - "security"
---

# Reconcile predefined OAuth clients during deployment

## Context

Identity stores administrator-provisioned OAuth clients in its own PostgreSQL
database. Deployments update images and run service-owned migrations, but they
do not currently reconcile client rows. When the predefined ChatGPT client
gained the accepted `offline_access` scope, the new Identity runtime was
deployed successfully while the database retained the old scope allowlist.
An operator had to run `oauth-client:provision` manually before the deployed
protocol contract and persisted client policy matched.

OAuth client configuration combines two kinds of authority. Stable client
identity, display name, refresh-token capability, and allowed scopes are
versioned product/security policy. The exact ChatGPT redirect URI is
environment-specific external configuration obtained from ChatGPT and may
change independently of source code. Treating the complete client as either a
manual database row or a hard-coded staging fixture creates configuration
drift or environment coupling.

Deployment must not silently take ownership of arbitrary operator-created
clients, print redirect URIs or credentials, run cross-service SQL, or turn
normal server startup into a migration/provisioning path. Rollback must also
remain fail-closed when an older Identity image cannot support the currently
reconciled predefined-client contract.

## Decision

Define a small versioned manifest of reserved predefined public OAuth clients
inside the Identity deployable. The manifest owns each reserved `client_id`,
display name, refresh-token capability, and exact allowed protocol/resource
scope set. It contains no environment hostname, redirect URI, secret, token,
or credential. Membership in this manifest reserves the client ID; the
general operator provisioning command must reject reserved IDs so the manifest
and an operator command cannot compete for the same configuration.

Supply each predefined client's exact redirect URI through a dedicated,
validated deployment variable. For the initial staging client, GitHub Actions
passes a non-secret repository/environment variable through the existing
restricted deployment wrapper into the root-owned Identity runtime
environment. Validation requires a credential-free HTTPS URI on the approved
ChatGPT origin and exact connector callback path. The value is never emitted
by the reconcile command or deployment diagnostics.

Add an Identity-owned one-shot reconciliation command and Compose operations
service. It loads the versioned manifest and environment-specific redirects,
then transactionally reconciles only the reserved clients. Redirect and scope
child rows are exact desired state. A client already matching the manifest is
reported as unchanged without rewriting `updated_at`; drift is updated, and a
missing row is created. Absence from the manifest never deletes or disables an
existing client; client retirement remains an explicit lifecycle decision.

The staging deployment runs reconciliation after successful Identity
migrations and before replacing the running Identity container. Missing or
invalid redirect configuration, an unknown manifest version, or any database
failure aborts deployment before service replacement. Normal Identity startup
remains read-only with respect to schema and predefined clients.

Treat predefined-client policy as persistent deployment state, analogous to a
forward database migration rather than image-local state. Every Identity
release declares whether its runtime is backward-compatible with the current
predefined-client contract. Automatic rollback is allowed only when both
schema and client-contract compatibility are declared; otherwise it stops for
operator-led recovery. Rollback does not guess or reconstruct an external
callback.

## Considered alternatives

- **Keep manual provisioning after deployment:** preserves a narrow deploy
  pipeline but repeatedly permits code/database drift and depends on an
  operator remembering a security-critical step. Rejected for predefined
  clients; retained for non-reserved operator clients.
- **Hard-code the ChatGPT callback in source control:** makes deployment fully
  declarative but couples generic Identity code to one staging connector and
  requires a code release when ChatGPT changes the callback. Rejected.
- **Store the whole desired client as JSON in a deployment variable:** avoids a
  code manifest but duplicates security policy outside reviewable typed code
  and creates an untyped second source of truth for scopes and refresh policy.
  Rejected.
- **Provision on every Identity server startup:** eventually repairs drift but
  gives horizontally scaled runtime replicas write-side initialization work,
  complicates readiness, and mixes serving with operations lifecycle.
  Rejected.
- **Add nullable ownership metadata to OAuth client rows:** can distinguish
  manual and deployment-managed clients explicitly, but the reserved manifest
  already provides an unambiguous namespace boundary. A schema migration and
  one-time adoption state would add complexity without improving the initial
  invariant. Deferred unless multiple management systems require it.
- **Delete database clients that disappear from the manifest:** makes absence
  destructive and can invalidate external integrations during rollback.
  Rejected; retirement must be explicit.

## Consequences

- A successful deployment proves that predefined Identity client rows match
  the versioned policy and current environment callback.
- External callbacks remain environment configuration; scope and refresh
  policy remain code-reviewed Identity configuration.
- Reserved client IDs can no longer be changed through the general manual
  provisioning command.
- Deployment gains one bounded, idempotent Identity database operation and one
  required non-secret environment variable.
- A missing variable or reconciliation failure blocks deployment before
  replacing Identity, which favors consistency over partial availability of a
  new release.
- Existing grants are not rewritten. Changed allowlists affect subsequent
  authorization and consent according to the existing OAuth lifecycle.
- Releases that change client compatibility may disable automatic rollback and
  require an explicit operator recovery procedure.

## Verification

- Unit tests validate the manifest, reserved-ID boundary, exact ChatGPT
  redirect shape, credential-free output, and created/updated/unchanged
  results.
- Integration tests prove exact transactional reconciliation, idempotent
  repeats without `updated_at` churn, drift repair, preservation of grants,
  and refusal to touch non-reserved clients.
- Deployment contract tests require the callback variable, operations service,
  post-migration/pre-replacement ordering, and client compatibility declaration.
- Controller tests reject missing, malformed, credential-bearing, off-origin,
  or incorrectly shaped callback values without printing them.
- Rollback tests prove automatic rollback requires both schema and predefined-
  client compatibility.
- Staging verification checks only public discovery/client behavior and fixed
  credential-free command summaries; it never prints runtime environment or
  protocol credentials.

## Related material

- [Identity service and protocol libraries](20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
- [Typed Identity protocol state](20260803-model-identity-protocol-state-in-typed-lifecycle-tables.md)
- [Durable OAuth connections](20260810-require-offline-access-for-durable-oauth-connections.md)
- [Temporary VM deployment](../wiki/operations/temporary-vm-deployment.md)
- [TASK-0036 implementation plan](../../plans/2026/08/completed/2026-08-11-task-0036-reconcile-predefined-oauth-clients.md)
