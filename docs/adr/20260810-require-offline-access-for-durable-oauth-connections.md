---
id: "decisions-20260810-require-offline-access-for-durable-oauth-connections"
kind: adr
title: "Require OIDC offline access for durable OAuth connections"
status: accepted
date: 2026-08-10
supersedes: []
superseded_by: null
tags:
  - "authentication"
  - "chatgpt"
  - "identity"
  - "mcp"
  - "oauth"
  - "openid-connect"
  - "security"
---

# Require OIDC offline access for durable OAuth connections

## Context

Shape of You already issues short-lived audience-bound access tokens and
rotating refresh tokens for an administrator-provisioned ChatGPT public
client. The first staging connection can authorize and read MCP data, but
ChatGPT later marks the connection as expired and asks the operator to connect
again. Identity and API logs contain no corresponding refresh request or token
rejection, so the reconnect prompt occurs before either Shape of You service is
called.

The authorization request contains `openid` and the approved MCP resource
scopes but omits the standard OIDC `offline_access` scope. Identity also omits
`offline_access` from authorization-server discovery and from the predefined
client allowlist. Issuing a refresh token without the client explicitly
requesting offline access is therefore not a durable interoperability contract:
an external client may discard that credential or decline to refresh after the
access token expires.

The Identity schema already separates OIDC grant scopes from resource-specific
grant scopes. The runtime currently adds the complete requested scope set to
both collections, which obscures that protocol scopes are not MCP domain
permissions. The correction must preserve that ownership boundary and must not
expand the API's authority.

## Decision

Add `offline_access` to the supported OIDC protocol profile and advertise it in
Identity authorization-server and OpenID Provider metadata. A client may
request it only when its exact administrator-managed scope allowlist contains
`offline_access` and rotating refresh tokens are enabled. The initial
`shape-of-you-chatgpt-staging` client is reprovisioned through the existing
Identity-owned operator command with `openid`, `offline_access`, and the five
approved resource scopes.

Treat `openid` and `offline_access` as OIDC protocol scopes. Persist them only
in `oauth_grant_oidc_scopes`. Persist `person:read`, `weight:write`,
`body-measurement:write`, `meal:write`, and `workout:write` only in
`oauth_grant_resource_scopes` for the exact MCP resource. Protocol scopes do
not become MCP permissions, are not advertised by protected-resource metadata,
and are never sufficient for API authorization.

Keep the existing ten-minute access-token lifetime, 30-day rotating refresh
token lifetime, family reuse detection, session binding, client binding,
resource binding, revocation, and exact scope allowlist checks. Do not add a
new endpoint, deployable, database, credential type, DCR, CIMD, or long-lived
access token.

After deployment and predefined-client reprovisioning, recreate the ChatGPT
application connection so it fetches the updated authorization-server metadata
and starts a new authorization flow that requests `offline_access`. Reconnect
acceptance requires an actual access-token-expiry boundary followed by refresh
rotation and an MCP read without another interactive authorization prompt.

## Considered alternatives

- **Keep issuing refresh tokens without `offline_access`:** requires external
  clients to infer durable authorization from non-standard behavior. The first
  ChatGPT staging connection already demonstrates that this is not a reliable
  interoperability contract. Rejected.
- **Increase the access-token lifetime:** delays the reconnect prompt but
  increases bearer-token exposure and does not provide durable renewal.
  Rejected.
- **Issue non-expiring access tokens:** removes rotation and bounded revocation,
  conflicts with the accepted security profile, and turns a transient bearer
  credential into durable authority. Rejected.
- **Add a Shape of You-specific reconnect endpoint or ChatGPT workaround:**
  duplicates standard OAuth/OIDC behavior and couples Identity to one client
  implementation. Rejected.
- **Adopt CIMD or DCR now:** may improve future multi-client provisioning but
  does not replace the need for an explicit offline-access grant and adds an
  unrelated registration/security surface. Deferred by the parent Identity
  ADR.

## Consequences

- Durable external connections receive an explicit, discoverable contract for
  refresh-token use.
- The predefined ChatGPT client gains one protocol scope but no additional MCP
  or Person-data permission.
- Grant persistence aligns with the existing typed OIDC/resource scope model.
- Existing grants remain valid, but the ChatGPT connection must be recreated
  and consented again to obtain a grant containing `offline_access`.
- Staging client reprovisioning remains an operator-approved, service-owned
  action; manual SQL remains forbidden.
- Clients that do not request or are not allowed `offline_access` cannot rely
  on a durable background connection.

## Verification

- Discovery tests require `offline_access` in `scopes_supported` while MCP
  protected-resource metadata continues to expose only resource scopes.
- Client/interaction tests reject `offline_access` when it is absent from the
  exact predefined-client allowlist or refresh tokens are disabled.
- Grant persistence tests prove that `openid` and `offline_access` are stored
  only as OIDC scopes and resource permissions are stored only for the exact
  MCP resource.
- End-to-end OAuth tests authorize with `openid offline_access` plus approved
  resource scopes, exchange the code, advance beyond the access-token lifetime,
  rotate the refresh token, reject refresh-token reuse, and complete an MCP
  read without interactive reconnection.
- Regression tests retain exact issuer, redirect URI, S256 PKCE, resource,
  audience, subject, session, client, and API Person-grant checks.
- Staging verification observes refresh activity without printing tokens,
  cookies, authorization codes, verifiers, or credentials.

## Related material

- [Identity service and protocol libraries](20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
- [Typed Identity protocol state](20260803-model-identity-protocol-state-in-typed-lifecycle-tables.md)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
- [TASK-0035 execution plan](../../plans/2026/08/2026-08-10-task-0035-connect-chatgpt-mcp-oauth.md)
