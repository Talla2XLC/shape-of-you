import { randomUUID } from "node:crypto";

import {
  errors,
  type Adapter,
  type AdapterFactory,
  type AdapterPayload,
  type PromptDetail
} from "oidc-provider";
import type { Pool, PoolClient } from "pg";

import { hashBearerValue } from "../authentication/crypto.js";
import type { OAuthClientStore } from "./client-store.js";
import type { OAuthRequestContext } from "./request-context.js";

type SupportedModel =
  | "AuthorizationCode"
  | "Client"
  | "Grant"
  | "Interaction"
  | "RefreshToken"
  | "Session";

/** Dependencies shared by strict relational `oidc-provider` adapters. */
export interface OAuthProviderAdapterDependencies {
  readonly pool: Pool;
  readonly clients: OAuthClientStore;
  readonly requestContext: OAuthRequestContext;
  readonly issuer: string;
  readonly resource: string;
}

/**
 * Creates the `oidc-provider` adapter factory for the enabled OAuth profile.
 *
 * Unknown models and payload fields fail closed. No generic provider payload is
 * persisted; every supported value maps to an approved typed relational field.
 */
export function createOAuthProviderAdapterFactory(
  dependencies: OAuthProviderAdapterDependencies
): AdapterFactory {
  return (model: string): Adapter =>
    new RelationalOAuthProviderAdapter(assertSupportedModel(model), dependencies);
}

class RelationalOAuthProviderAdapter implements Adapter {
  public constructor(
    private readonly model: SupportedModel,
    private readonly dependencies: OAuthProviderAdapterDependencies
  ) {}

  public async upsert(
    id: string,
    payload: AdapterPayload,
    expiresIn?: number
  ): Promise<void> {
    switch (this.model) {
      case "AuthorizationCode":
        await upsertAuthorizationCode(this.dependencies, id, payload);
        return;
      case "Client":
        throw new Error("OAuth clients must be provisioned through the operator command");
      case "Interaction":
        await upsertInteraction(this.dependencies, id, payload, expiresIn);
        return;
      case "Session":
        await upsertSession(this.dependencies, id, payload);
        return;
      case "Grant":
        await upsertGrant(this.dependencies, id, payload);
        return;
      case "RefreshToken":
        await upsertRefreshToken(this.dependencies, id, payload);
    }
  }

  public async find(id: string): Promise<AdapterPayload | undefined> {
    switch (this.model) {
      case "AuthorizationCode":
        return findAuthorizationCode(this.dependencies, id);
      case "Client":
        return this.dependencies.clients.findProviderClient(id);
      case "Interaction":
        return findInteraction(this.dependencies, id);
      case "Session":
        return findSession(this.dependencies.pool, { providerCredential: id });
      case "Grant":
        return findGrant(this.dependencies.pool, id);
      case "RefreshToken":
        return findRefreshToken(this.dependencies, id);
    }
  }

  public async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    if (this.model !== "Session") {
      throw new Error(`OAuth adapter model ${this.model} does not support UID lookup`);
    }
    return findSession(this.dependencies.pool, { providerUid: uid });
  }

  public async findByUserCode(): Promise<undefined> {
    throw new Error(`OAuth adapter model ${this.model} does not support user codes`);
  }

  public async consume(id: string): Promise<void> {
    if (this.model === "AuthorizationCode") {
      await consumeAuthorizationCode(this.dependencies.pool, id);
      return;
    }
    if (this.model === "RefreshToken") {
      await consumeRefreshToken(this.dependencies.pool, id);
      return;
    }
    throw new Error(`OAuth adapter model ${this.model} is not consumable`);
  }

  public async destroy(id: string): Promise<void> {
    switch (this.model) {
      case "AuthorizationCode":
        await this.dependencies.pool.query(
          "delete from oauth_authorization_codes where code_hash = $1",
          [hashBearerValue(id)]
        );
        return;
      case "Interaction":
        await this.dependencies.pool.query(
          `update oauth_interactions
              set status = case when status = 'pending' then 'abandoned' else status end,
                  abandoned_at = case when status = 'pending' then now() else abandoned_at end
            where credential_hash = $1`,
          [hashBearerValue(id)]
        );
        return;
      case "Session":
        await destroyProviderSessionBinding(this.dependencies.pool, id);
        return;
      case "Grant":
        await this.dependencies.pool.query(
          "update oauth_grants set revoked_at = coalesce(revoked_at, now()) where id = $1",
          [id]
        );
        return;
      case "RefreshToken":
        await revokeRefreshFamilyByToken(this.dependencies.pool, id);
        return;
      case "Client":
        throw new Error("OAuth client deletion is an operator lifecycle action");
    }
  }

  public async revokeByGrantId(grantId: string): Promise<void> {
    if (this.model === "AuthorizationCode") {
      await this.dependencies.pool.query(
        "delete from oauth_authorization_codes where grant_id = $1",
        [grantId]
      );
      return;
    }
    if (this.model === "RefreshToken") {
      await this.dependencies.pool.query(
        `with revoked as (
           update oauth_refresh_token_families
              set revoked_at = coalesce(revoked_at, now())
            where grant_id = $1
          returning id
         )
         update oauth_refresh_tokens
            set revoked_at = coalesce(revoked_at, now())
          where family_id in (select id from revoked)`,
        [grantId]
      );
      return;
    }
    throw new Error(`OAuth adapter model ${this.model} has no grant-bound artifacts`);
  }
}

async function consumeAuthorizationCode(pool: Pool, credential: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const consumed = await client.query<{
      account_id: string;
      client_id: string;
      grant_id: string;
      session_id: string;
    }>(
      `update oauth_authorization_codes
          set consumed_at = now()
        where code_hash = $1 and consumed_at is null and expires_at >= now()
      returning account_id, client_id, grant_id, session_id`,
      [hashBearerValue(credential)]
    );
    const row = consumed.rows[0];
    if (!row) throw new errors.InvalidGrant("Authorization code is unavailable or already consumed");
    await insertOAuthSecurityEvent(client, {
      eventType: "oauth_code_exchange",
      actorKind: "oauth_client",
      accountId: row.account_id,
      clientId: row.client_id,
      sessionId: row.session_id,
      correlationId: row.grant_id
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function consumeRefreshToken(pool: Pool, credential: string): Promise<void> {
  const client = await pool.connect();
  let invalid = false;
  let reuseDetected = false;
  try {
    await client.query("begin");
    const consumed = await client.query(
      `update oauth_refresh_tokens
          set consumed_at = now()
        where token_hash = $1 and consumed_at is null and revoked_at is null
      returning id`,
      [hashBearerValue(credential)]
    );
    if (consumed.rowCount === 0) {
      invalid = true;
      const target = await client.query<{
        account_id: string;
        client_id: string;
        family_id: string;
        session_id: string;
      }>(
        `select account_id, client_id, family_id, session_id
           from oauth_refresh_tokens
          where token_hash = $1 and consumed_at is not null
          for update`,
        [hashBearerValue(credential)]
      );
      const row = target.rows[0];
      if (row) {
        const revoked = await client.query(
          `update oauth_refresh_token_families
              set revoked_at = coalesce(revoked_at, now()),
                  reuse_detected_at = now()
            where id = $1 and reuse_detected_at is null
          returning id`,
          [row.family_id]
        );
        await client.query(
          `update oauth_refresh_tokens
              set revoked_at = coalesce(revoked_at, now())
            where family_id = $1`,
          [row.family_id]
        );
        if (revoked.rowCount === 1) {
          await insertOAuthSecurityEvent(client, {
            eventType: "oauth_refresh_reuse_detected",
            actorKind: "oauth_client",
            accountId: row.account_id,
            clientId: row.client_id,
            sessionId: row.session_id,
            correlationId: row.family_id
          });
        }
        reuseDetected = true;
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  if (invalid) {
    throw new errors.InvalidGrant(
      reuseDetected ? "Refresh token reuse was detected" : "Refresh token is unavailable"
    );
  }
}

async function destroyProviderSessionBinding(pool: Pool, providerCredential: string): Promise<void> {
  await pool.query(
    `update oauth_sessions
        set provider_credential_hash = null
      where provider_credential_hash = $1
        and revoked_at is null`,
    [hashBearerValue(providerCredential)]
  );
}

function assertSupportedModel(model: string): SupportedModel {
  if (
    [
      "AuthorizationCode",
      "Client",
      "Grant",
      "Interaction",
      "RefreshToken",
      "Session"
    ].includes(model)
  ) {
    return model as SupportedModel;
  }
  throw new Error(`Unsupported oidc-provider adapter model: ${model}`);
}

function assertOnlyFields(
  model: SupportedModel,
  payload: AdapterPayload,
  fields: readonly string[]
): void {
  const allowed = new Set(fields);
  const unknown = Object.keys(payload).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${model} adapter payload contains unsupported fields: ${unknown.sort().join(", ")}`);
  }
}

async function upsertInteraction(
  dependencies: OAuthProviderAdapterDependencies,
  credential: string,
  payload: AdapterPayload,
  expiresIn: number | undefined
): Promise<void> {
  assertOnlyFields("Interaction", payload, [
    "cid",
    "exp",
    "grantId",
    "iat",
    "jti",
    "kind",
    "lastSubmission",
    "params",
    "prompt",
    "result",
    "returnTo",
    "session",
    "trusted"
  ]);
  assertOpaqueIdentifier(credential, "OAuth interaction credential");
  if (payload.jti !== credential || payload.kind !== "Interaction") {
    throw new Error("OAuth Interaction identity is inconsistent");
  }

  const existing = await dependencies.pool.query<{ id: string }>(
    "select id from oauth_interactions where credential_hash = $1",
    [hashBearerValue(credential)]
  );
  if (existing.rowCount === 1) {
    await completeInteraction(dependencies.pool, credential, payload);
    return;
  }

  const params = requireRecord(payload.params, "OAuth Interaction params");
  assertRecordFields(params, [
    "client_id",
    "code_challenge",
    "code_challenge_method",
    "nonce",
    "redirect_uri",
    "resource",
    "response_type",
    "scope",
    "state"
  ], "OAuth Interaction params");
  const clientId = requireString(params.client_id, "OAuth client id");
  const redirectUri = requireString(params.redirect_uri, "OAuth redirect URI");
  const codeChallenge = requireString(params.code_challenge, "OAuth PKCE challenge");
  if (params.code_challenge_method !== "S256" || params.response_type !== "code") {
    throw new Error("OAuth Interaction must use authorization code with S256 PKCE");
  }
  const requestedScopes = splitScope(requireString(params.scope, "OAuth scope"));
  const requestedResources = stringList(params.resource, "OAuth resource");
  if (
    requestedResources.length !== 1 ||
    requestedResources[0] !== dependencies.resource
  ) {
    throw new errors.InvalidTarget("OAuth Interaction targets an unsupported resource");
  }
  const allowedScopes = await dependencies.clients.listAllowedScopes(clientId);
  if (requestedScopes.some((scope) => !allowedScopes.has(scope))) {
    throw new errors.InvalidScope(
      "OAuth Interaction requests a scope outside the client allowlist",
      requestedScopes.join(" ")
    );
  }

  const prompt = requireRecord(payload.prompt, "OAuth Interaction prompt");
  assertRecordFields(prompt, ["details", "name", "reasons"], "OAuth Interaction prompt");
  const promptName = prompt.name;
  if (promptName !== "login" && promptName !== "consent") {
    throw new Error("OAuth Interaction prompt is unsupported");
  }
  const providerCid = requireString(payload.cid, "OAuth Interaction cid");
  assertOpaqueIdentifier(providerCid, "OAuth Interaction cid");
  const returnTo = requireString(payload.returnTo, "OAuth Interaction returnTo");
  if (new URL(returnTo).origin !== dependencies.issuer) {
    throw new Error("OAuth Interaction returnTo has an unexpected origin");
  }
  const iat = requireEpoch(payload.iat, "OAuth Interaction iat");
  const exp = requireEpoch(payload.exp, "OAuth Interaction exp");
  if (exp <= iat || (expiresIn !== undefined && exp - iat !== expiresIn)) {
    throw new Error("OAuth Interaction lifetime is inconsistent");
  }

  const session = await resolveInteractionSession(dependencies, payload.session);
  const grantId = payload.grantId === undefined
    ? null
    : requireUuid(payload.grantId, "OAuth Interaction grant id");
  const internalId = randomUUID();
  const client = await dependencies.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into oauth_interactions
         (id, credential_hash, client_id, account_id, session_id, grant_id,
          prompt, status, provider_cid, provider_return_to, redirect_uri,
          code_challenge, code_challenge_method, client_state, oidc_nonce,
          created_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10,
               $11, 'S256', $12, $13, $14, $15)`,
      [
        internalId,
        hashBearerValue(credential),
        clientId,
        session?.accountId ?? null,
        session?.sessionId ?? null,
        grantId,
        promptName,
        providerCid,
        returnTo,
        redirectUri,
        codeChallenge,
        optionalString(params.state, "OAuth state"),
        optionalString(params.nonce, "OIDC nonce"),
        new Date(iat * 1_000),
        new Date(exp * 1_000)
      ]
    );
    for (const scope of requestedScopes) {
      await client.query(
        `insert into oauth_interaction_requested_scopes
           (interaction_id, client_id, scope) values ($1, $2, $3)`,
        [internalId, clientId, scope]
      );
    }
    for (const resource of requestedResources) {
      await client.query(
        `insert into oauth_interaction_requested_resources
           (interaction_id, resource) values ($1, $2)`,
        [internalId, resource]
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function completeInteraction(
  pool: Pool,
  credential: string,
  payload: AdapterPayload
): Promise<void> {
  const result = requireRecord(payload.result, "OAuth Interaction result");
  assertRecordFields(result, ["consent", "error", "error_description", "login"], "OAuth Interaction result");
  if (result.error !== undefined) {
    if (result.error !== "access_denied") {
      throw new Error("OAuth Interaction error is unsupported");
    }
    await pool.query(
      `update oauth_interactions
          set status = 'abandoned', abandoned_at = now()
        where credential_hash = $1 and status = 'pending' and expires_at >= now()`,
      [hashBearerValue(credential)]
    );
    return;
  }
  if (result.login !== undefined) {
    const login = requireRecord(result.login, "OAuth login result");
    assertRecordFields(login, ["accountId", "acr", "amr", "remember", "ts"], "OAuth login result");
    const accountId = requireUuid(login.accountId, "OAuth login account id");
    const updated = await pool.query(
      `update oauth_interactions i
          set status = 'completed', completed_at = now()
        where i.credential_hash = $1 and i.status = 'pending'
          and i.expires_at >= now() and i.account_id = $2
          and exists (
            select 1 from oauth_sessions s
             where s.id = i.session_id and s.account_id = i.account_id
               and s.revoked_at is null and s.expires_at >= now()
          )`,
      [hashBearerValue(credential), accountId]
    );
    if (updated.rowCount !== 1) throw new Error("OAuth login interaction is not bound to the authenticated session");
    return;
  }
  if (result.consent !== undefined) {
    const consent = requireRecord(result.consent, "OAuth consent result");
    assertRecordFields(consent, ["grantId"], "OAuth consent result");
    const grantId = requireUuid(consent.grantId, "OAuth consent grant id");
    const client = await pool.connect();
    try {
      await client.query("begin");
      const updated = await client.query<{
        account_id: string;
        client_id: string;
        id: string;
        session_id: string;
      }>(
        `update oauth_interactions
            set status = 'completed', grant_id = $2, completed_at = now()
          where credential_hash = $1 and status = 'pending' and expires_at >= now()
            and account_id is not null and session_id is not null
        returning id, account_id, client_id, session_id`,
        [hashBearerValue(credential), grantId]
      );
      const row = updated.rows[0];
      if (!row) throw new Error("OAuth consent interaction is not bound to a session");
      await insertOAuthSecurityEvent(client, {
        eventType: "oauth_authorization",
        actorKind: "account",
        actorAccountId: row.account_id,
        accountId: row.account_id,
        clientId: row.client_id,
        sessionId: row.session_id,
        correlationId: row.id
      });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return;
  }
  throw new Error("OAuth Interaction result is unsupported");
}

async function findInteraction(
  dependencies: OAuthProviderAdapterDependencies,
  credential: string
): Promise<AdapterPayload | undefined> {
  const result = await dependencies.pool.query<{
    account_id: string | null;
    acr: string | null;
    amr: string[] | null;
    authenticated_at: Date | null;
    client_id: string;
    client_state: string | null;
    code_challenge: string;
    completed_at: Date | null;
    created_at: Date;
    expires_at: Date;
    grant_id: string | null;
    oidc_nonce: string | null;
    prompt: "login" | "consent";
    provider_credential_hash: Buffer | null;
    provider_cid: string;
    provider_return_to: string;
    provider_uid: string | null;
    redirect_uri: string;
    status: "pending" | "completed" | "abandoned";
  }>(
    `select i.client_id, i.account_id, i.grant_id, i.prompt, i.status,
            i.provider_cid, i.provider_return_to, i.redirect_uri,
            i.code_challenge, i.client_state, i.oidc_nonce, i.created_at,
            i.expires_at, i.completed_at, s.provider_uid,
            s.provider_credential_hash, s.authenticated_at, s.acr, s.amr
       from oauth_interactions i
       left join oauth_sessions s on s.id = i.session_id and s.account_id = i.account_id
      where i.credential_hash = $1 and i.expires_at >= now()`,
    [hashBearerValue(credential)]
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const scopes = await dependencies.pool.query<{ scope: string }>(
    `select scope from oauth_interaction_requested_scopes
      where interaction_id = (select id from oauth_interactions where credential_hash = $1)
      order by scope`,
    [hashBearerValue(credential)]
  );
  const resources = await dependencies.pool.query<{ resource: string }>(
    `select resource from oauth_interaction_requested_resources
      where interaction_id = (select id from oauth_interactions where credential_hash = $1)
      order by resource`,
    [hashBearerValue(credential)]
  );
  const params: Record<string, unknown> = {
    client_id: row.client_id,
    code_challenge: row.code_challenge,
    code_challenge_method: "S256",
    redirect_uri: row.redirect_uri,
    response_type: "code",
    scope: scopes.rows.map((item) => item.scope).join(" "),
    resource: resources.rows.length === 1
      ? resources.rows[0]!.resource
      : resources.rows.map((item) => item.resource)
  };
  if (row.client_state !== null) params.state = row.client_state;
  if (row.oidc_nonce !== null) params.nonce = row.oidc_nonce;
  const payload: AdapterPayload = {
    cid: row.provider_cid,
    exp: Math.floor(row.expires_at.getTime() / 1_000),
    iat: Math.floor(row.created_at.getTime() / 1_000),
    jti: credential,
    kind: "Interaction",
    params,
    prompt: interactionPrompt(row.prompt),
    returnTo: row.provider_return_to
  };
  if (row.grant_id !== null) payload.grantId = row.grant_id;
  if (
    row.provider_credential_hash &&
    row.provider_uid &&
    row.account_id &&
    row.acr &&
    row.amr
  ) {
    payload.session = {
      accountId: row.account_id,
      acr: row.acr,
      amr: row.amr,
      uid: row.provider_uid
    };
  }
  if (row.status === "abandoned") {
    payload.result = { error: "access_denied", error_description: "End-user denied access" };
  } else if (
    row.status === "completed" &&
    row.prompt === "login" &&
    row.account_id &&
    row.authenticated_at &&
    row.acr &&
    row.amr
  ) {
    payload.result = {
      login: {
        accountId: row.account_id,
        acr: row.acr,
        amr: row.amr,
        remember: true,
        ts: Math.floor(row.authenticated_at.getTime() / 1_000)
      }
    };
  } else if (row.status === "completed" && row.prompt === "consent" && row.grant_id) {
    payload.result = { consent: { grantId: row.grant_id } };
  }
  return payload;
}

function interactionPrompt(name: "login" | "consent"): PromptDetail {
  return {
    name,
    reasons: name === "login" ? ["no_session"] : ["missing_scope"],
    details: {}
  };
}

async function resolveInteractionSession(
  dependencies: OAuthProviderAdapterDependencies,
  value: AdapterPayload["session"]
): Promise<{ accountId: string; sessionId: string } | null> {
  if (value === undefined) return null;
  const session = requireRecord(value, "OAuth Interaction session");
  assertRecordFields(session, ["accountId", "acr", "amr", "cookie", "uid"], "OAuth Interaction session");
  const accountId = requireUuid(session.accountId, "OAuth Interaction session account");
  const providerUid = requireString(session.uid, "OAuth Interaction session uid");
  const result = await dependencies.pool.query<{ id: string }>(
    `select id from oauth_sessions
      where account_id = $1 and provider_uid = $2
        and revoked_at is null and expires_at >= now()`,
    [accountId, providerUid]
  );
  const row = result.rows[0];
  if (row) return { accountId, sessionId: row.id };

  const resumeIdentifier = dependencies.requestContext.requireResumeIdentifier();
  const bound = await dependencies.pool.query<{ id: string }>(
    `select s.id
       from oauth_interactions i
       join oauth_sessions s on s.id = i.session_id and s.account_id = i.account_id
      where (i.credential_hash = $1 or i.provider_cid = $2)
        and i.account_id = $3
        and s.revoked_at is null and s.expires_at >= now()`,
    [hashBearerValue(resumeIdentifier), resumeIdentifier, accountId]
  );
  const boundRow = bound.rows[0];
  if (!boundRow) throw new Error("OAuth Interaction references an unknown session");
  return { accountId, sessionId: boundRow.id };
}

async function upsertSession(
  dependencies: OAuthProviderAdapterDependencies,
  providerCredential: string,
  payload: AdapterPayload
): Promise<void> {
  assertOnlyFields("Session", payload, [
    "accountId",
    "acr",
    "amr",
    "authorizations",
    "exp",
    "iat",
    "jti",
    "kind",
    "loginTs",
    "uid"
  ]);
  assertOpaqueIdentifier(providerCredential, "OAuth provider session credential");
  if (payload.jti !== providerCredential || payload.kind !== "Session") {
    throw new Error("OAuth Session identity is inconsistent");
  }
  const accountId = requireUuid(payload.accountId, "OAuth Session account id");
  const uid = requireString(payload.uid, "OAuth Session uid");
  const resumeIdentifier = dependencies.requestContext.requireResumeIdentifier();
  const client = await dependencies.pool.connect();
  try {
    await client.query("begin");
    const bound = await client.query<{ id: string }>(
      `update oauth_sessions s
          set provider_uid = $4, provider_credential_hash = $5
         from oauth_interactions i
        where (i.credential_hash = $1 or i.provider_cid = $2)
          and i.session_id = s.id
          and i.account_id = $3 and s.account_id = $3 and s.id = i.session_id
          and s.revoked_at is null and s.expires_at >= now()
      returning s.id`,
      [
        hashBearerValue(resumeIdentifier),
        resumeIdentifier,
        accountId,
        uid,
        hashBearerValue(providerCredential)
      ]
    );
    if (bound.rowCount !== 1) {
      throw new Error("OAuth provider Session is not bound to the authorization resume");
    }
    await reconcileSessionAuthorizations(client, bound.rows[0]!.id, accountId, payload.authorizations);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function reconcileSessionAuthorizations(
  client: PoolClient,
  sessionId: string,
  accountId: string,
  value: AdapterPayload["authorizations"]
): Promise<void> {
  if (value === undefined) return;
  const authorizations = requireRecord(value, "OAuth Session authorizations");
  for (const [clientId, authorizationValue] of Object.entries(authorizations)) {
    const authorization = requireRecord(authorizationValue, "OAuth Session authorization");
    assertRecordFields(authorization, ["grantId", "sid"], "OAuth Session authorization");
    if (authorization.grantId === undefined) continue;
    const grantId = requireUuid(authorization.grantId, "OAuth Session grant id");
    await client.query(
      `insert into oauth_session_authorizations
         (session_id, account_id, client_id, grant_id)
       values ($1, $2, $3, $4)
       on conflict (session_id, client_id) do update
         set grant_id = excluded.grant_id, authorized_at = now(), revoked_at = null`,
      [sessionId, accountId, clientId, grantId]
    );
  }
}

async function findSession(
  pool: Pool,
  lookup: { readonly providerCredential?: string; readonly providerUid?: string }
): Promise<AdapterPayload | undefined> {
  const result = await pool.query<{
    account_id: string;
    acr: string;
    amr: string[];
    authenticated_at: Date;
    expires_at: Date;
    provider_uid: string;
  }>(
    `select s.account_id, s.acr, s.amr, s.authenticated_at, s.expires_at, s.provider_uid
       from oauth_sessions s
       join identity_accounts a on a.id = s.account_id and a.status = 'active'
      where (($1::bytea is not null and provider_credential_hash = $1)
         or ($2::text is not null and provider_uid = $2))
        and s.revoked_at is null and s.expires_at >= now()`,
    [
      lookup.providerCredential
        ? hashBearerValue(lookup.providerCredential)
        : null,
      lookup.providerUid ?? null
    ]
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const authorizations = await pool.query<{ client_id: string; grant_id: string }>(
    `select client_id, grant_id from oauth_session_authorizations
      where session_id = (
        select id from oauth_sessions where provider_uid = $1
      ) and revoked_at is null`,
    [row.provider_uid]
  );
  return {
    accountId: row.account_id,
    acr: row.acr,
    amr: row.amr,
    authorizations: Object.fromEntries(
      authorizations.rows.map((item) => [item.client_id, { grantId: item.grant_id }])
    ),
    exp: Math.floor(row.expires_at.getTime() / 1_000),
    iat: Math.floor(row.authenticated_at.getTime() / 1_000),
    jti: lookup.providerCredential ?? row.provider_uid,
    kind: "Session",
    loginTs: Math.floor(row.authenticated_at.getTime() / 1_000),
    uid: row.provider_uid
  };
}

async function upsertGrant(
  dependencies: OAuthProviderAdapterDependencies,
  id: string,
  payload: AdapterPayload
): Promise<void> {
  assertOnlyFields("Grant", payload, [
    "accountId",
    "clientId",
    "exp",
    "iat",
    "jti",
    "kind",
    "openid",
    "resources"
  ]);
  requireUuid(id, "OAuth Grant id");
  const accountId = requireUuid(payload.accountId, "OAuth Grant account id");
  const clientId = requireString(payload.clientId, "OAuth Grant client id");
  const resources = requireRecord(payload.resources, "OAuth Grant resources");
  const openid = requireRecord(payload.openid, "OAuth Grant OIDC scopes");
  assertRecordFields(openid, ["claims", "scope"], "OAuth Grant OIDC scopes");
  if (openid.claims !== undefined) {
    throw new Error("OAuth Grant OIDC claims are unsupported");
  }
  const oidcScopes = splitScope(requireString(openid.scope, "OAuth Grant OIDC scope"));
  const resourceScope = requireString(resources[dependencies.resource], "OAuth Grant resource scope");
  if (Object.keys(resources).length !== 1) throw new Error("OAuth Grant has unsupported resources");
  const scopes = splitScope(resourceScope);
  const allowed = await dependencies.clients.listAllowedScopes(clientId);
  if ([...oidcScopes, ...scopes].some((scope) => !allowed.has(scope))) {
    throw new Error("OAuth Grant exceeds client scope allowlist");
  }
  const client = await dependencies.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into oauth_grants (id, account_id, client_id, created_at, expires_at)
       values ($1, $2, $3, to_timestamp($4), case when $5::bigint is null then null else to_timestamp($5) end)
       on conflict (id) do update set expires_at = excluded.expires_at, revoked_at = null`,
      [id, accountId, clientId, requireEpoch(payload.iat, "OAuth Grant iat"), payload.exp ?? null]
    );
    await client.query("delete from oauth_grant_resource_scopes where grant_id = $1", [id]);
    await client.query("delete from oauth_grant_oidc_scopes where grant_id = $1", [id]);
    for (const scope of oidcScopes) {
      await client.query(
        `insert into oauth_grant_oidc_scopes
           (grant_id, client_id, scope) values ($1, $2, $3)`,
        [id, clientId, scope]
      );
    }
    for (const scope of scopes) {
      await client.query(
        `insert into oauth_grant_resource_scopes
           (grant_id, client_id, resource, scope) values ($1, $2, $3, $4)`,
        [id, clientId, dependencies.resource, scope]
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function findGrant(pool: Pool, id: string): Promise<AdapterPayload | undefined> {
  const result = await pool.query<{
    account_id: string;
    client_id: string;
    created_at: Date;
    expires_at: Date | null;
  }>(
    `select g.account_id, g.client_id, g.created_at, g.expires_at
       from oauth_grants g
       join identity_accounts a on a.id = g.account_id and a.status = 'active'
       join oauth_clients c on c.id = g.client_id and c.status = 'active'
      where g.id = $1 and g.revoked_at is null
        and (g.expires_at is null or g.expires_at >= now())`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const scopes = await pool.query<{ resource: string; scope: string }>(
    `select resource, scope from oauth_grant_resource_scopes
      where grant_id = $1 order by resource, scope`,
    [id]
  );
  const oidcScopes = await pool.query<{ scope: string }>(
    `select scope from oauth_grant_oidc_scopes
      where grant_id = $1 order by scope`,
    [id]
  );
  const resources: Record<string, string> = {};
  for (const item of scopes.rows) {
    resources[item.resource] = [resources[item.resource], item.scope]
      .filter(Boolean)
      .join(" ");
  }
  return {
    accountId: row.account_id,
    clientId: row.client_id,
    exp: row.expires_at ? Math.floor(row.expires_at.getTime() / 1_000) : undefined,
    iat: Math.floor(row.created_at.getTime() / 1_000),
    jti: id,
    kind: "Grant",
    openid: { scope: oidcScopes.rows.map((item) => item.scope).join(" ") },
    resources
  };
}

async function upsertAuthorizationCode(
  dependencies: OAuthProviderAdapterDependencies,
  credential: string,
  payload: AdapterPayload
): Promise<void> {
  assertOnlyFields("AuthorizationCode", payload, [
    "accountId",
    "acr",
    "amr",
    "authTime",
    "clientId",
    "codeChallenge",
    "codeChallengeMethod",
    "exp",
    "expiresWithSession",
    "grantId",
    "iat",
    "jti",
    "kind",
    "nonce",
    "redirectUri",
    "resource",
    "scope",
    "sessionUid"
  ]);
  assertTokenIdentity("AuthorizationCode", credential, payload);
  if (payload.codeChallengeMethod !== "S256") {
    throw new Error("OAuth AuthorizationCode must use S256 PKCE");
  }
  if (payload.expiresWithSession !== true) {
    throw new Error("OAuth AuthorizationCode must remain session-bound");
  }
  const accountId = requireUuid(payload.accountId, "OAuth AuthorizationCode account id");
  const clientId = requireString(payload.clientId, "OAuth AuthorizationCode client id");
  const sessionUid = requireString(payload.sessionUid, "OAuth AuthorizationCode session uid");
  const session = await findBoundSession(dependencies.pool, sessionUid, accountId);
  const grantId = requireUuid(payload.grantId, "OAuth AuthorizationCode grant id");
  const resources = stringList(payload.resource, "OAuth AuthorizationCode resource");
  if (resources.length !== 1 || resources[0] !== dependencies.resource) {
    throw new Error("OAuth AuthorizationCode targets an unsupported resource");
  }
  const scopes = splitScope(requireString(payload.scope, "OAuth AuthorizationCode scope"));
  const allowed = await dependencies.clients.listAllowedScopes(clientId);
  if (scopes.some((scope) => !allowed.has(scope))) {
    throw new Error("OAuth AuthorizationCode exceeds the client scope allowlist");
  }
  await dependencies.pool.query(
    `insert into oauth_authorization_codes
       (id, code_hash, account_id, client_id, session_id, grant_id,
        redirect_uri, code_challenge, code_challenge_method, resource,
        issued_scopes, oidc_nonce, created_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'S256', $9, $10, $11,
             to_timestamp($12), to_timestamp($13))`,
    [
      randomUUID(),
      hashBearerValue(credential),
      accountId,
      clientId,
      session.id,
      grantId,
      requireString(payload.redirectUri, "OAuth AuthorizationCode redirect URI"),
      requireString(payload.codeChallenge, "OAuth AuthorizationCode PKCE challenge"),
      dependencies.resource,
      scopes,
      optionalString(payload.nonce, "OAuth AuthorizationCode nonce"),
      requireEpoch(payload.iat, "OAuth AuthorizationCode iat"),
      requireEpoch(payload.exp, "OAuth AuthorizationCode exp")
    ]
  );
}

async function findAuthorizationCode(
  dependencies: OAuthProviderAdapterDependencies,
  credential: string
): Promise<AdapterPayload | undefined> {
  const result = await dependencies.pool.query<{
    account_id: string;
    acr: string;
    amr: string[];
    authenticated_at: Date;
    client_id: string;
    code_challenge: string;
    consumed_at: Date | null;
    created_at: Date;
    expires_at: Date;
    grant_id: string;
    issued_scopes: string[];
    oidc_nonce: string | null;
    provider_uid: string;
    redirect_uri: string;
    resource: string;
  }>(
    `select c.account_id, c.client_id, c.grant_id, c.redirect_uri,
            c.code_challenge, c.resource, c.issued_scopes, c.oidc_nonce,
            c.created_at, c.expires_at, c.consumed_at, s.provider_uid,
            s.authenticated_at, s.acr, s.amr
       from oauth_authorization_codes c
       join oauth_sessions s on s.id = c.session_id and s.account_id = c.account_id
       join identity_accounts a on a.id = c.account_id and a.status = 'active'
       join oauth_clients oc on oc.id = c.client_id and oc.status = 'active'
       join oauth_grants g on g.id = c.grant_id and g.revoked_at is null
      where c.code_hash = $1 and s.revoked_at is null and s.expires_at >= now()`,
    [hashBearerValue(credential)]
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    accountId: row.account_id,
    acr: row.acr,
    amr: row.amr,
    authTime: Math.floor(row.authenticated_at.getTime() / 1_000),
    clientId: row.client_id,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: "S256",
    consumed: row.consumed_at
      ? Math.floor(row.consumed_at.getTime() / 1_000)
      : undefined,
    exp: Math.floor(row.expires_at.getTime() / 1_000),
    expiresWithSession: true,
    grantId: row.grant_id,
    iat: Math.floor(row.created_at.getTime() / 1_000),
    jti: credential,
    kind: "AuthorizationCode",
    nonce: row.oidc_nonce ?? undefined,
    redirectUri: row.redirect_uri,
    resource: row.resource,
    scope: [...row.issued_scopes].sort().join(" "),
    sessionUid: row.provider_uid
  };
}

async function upsertRefreshToken(
  dependencies: OAuthProviderAdapterDependencies,
  credential: string,
  payload: AdapterPayload
): Promise<void> {
  assertOnlyFields("RefreshToken", payload, [
    "accountId",
    "acr",
    "amr",
    "authTime",
    "clientId",
    "exp",
    "expiresWithSession",
    "grantId",
    "gty",
    "iat",
    "iiat",
    "jti",
    "kind",
    "nonce",
    "resource",
    "rotations",
    "scope",
    "sessionUid"
  ]);
  assertTokenIdentity("RefreshToken", credential, payload);
  if (payload.expiresWithSession !== true) {
    throw new Error("OAuth RefreshToken must remain session-bound");
  }
  const accountId = requireUuid(payload.accountId, "OAuth RefreshToken account id");
  const clientId = requireString(payload.clientId, "OAuth RefreshToken client id");
  if (!(await dependencies.clients.isRefreshTokenEnabled(clientId))) {
    throw new Error("OAuth client is not allowed to receive refresh tokens");
  }
  const grantId = requireUuid(payload.grantId, "OAuth RefreshToken grant id");
  const sessionUid = requireString(payload.sessionUid, "OAuth RefreshToken session uid");
  const session = await findBoundSession(dependencies.pool, sessionUid, accountId);
  const resources = stringList(payload.resource, "OAuth RefreshToken resource");
  if (resources.length !== 1 || resources[0] !== dependencies.resource) {
    throw new Error("OAuth RefreshToken targets an unsupported resource");
  }
  const scopes = splitScope(requireString(payload.scope, "OAuth RefreshToken scope"));
  const allowed = await dependencies.clients.listAllowedScopes(clientId);
  if (scopes.some((scope) => !allowed.has(scope))) {
    throw new Error("OAuth RefreshToken exceeds the client scope allowlist");
  }
  const generation = payload.rotations;
  if (typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 0) {
    throw new Error("OAuth RefreshToken rotation generation is invalid");
  }
  const initialIat = requireEpoch(payload.iiat, "OAuth RefreshToken initial iat");
  const issuedAt = requireEpoch(payload.iat, "OAuth RefreshToken iat");
  const expiresAt = requireEpoch(payload.exp, "OAuth RefreshToken exp");
  const client = await dependencies.pool.connect();
  try {
    await client.query("begin");
    let family = await client.query<{ id: string }>(
      `select id from oauth_refresh_token_families
        where account_id = $1 and client_id = $2 and session_id = $3
          and grant_id = $4 and created_at = to_timestamp($5)
        for update`,
      [accountId, clientId, session.id, grantId, initialIat]
    );
    if (generation === 0 && family.rowCount === 0) {
      family = await client.query<{ id: string }>(
        `insert into oauth_refresh_token_families
           (id, account_id, client_id, session_id, grant_id, created_at, expires_at)
         values ($1, $2, $3, $4, $5, to_timestamp($6), to_timestamp($7))
         returning id`,
        [randomUUID(), accountId, clientId, session.id, grantId, initialIat, expiresAt]
      );
    }
    const familyId = family.rows[0]?.id;
    if (!familyId) throw new Error("OAuth RefreshToken family is unavailable");
    const extended = await client.query(
      `update oauth_refresh_token_families
          set expires_at = greatest(expires_at, to_timestamp($2))
        where id = $1 and revoked_at is null`,
      [familyId, expiresAt]
    );
    if (extended.rowCount !== 1) {
      throw new errors.InvalidGrant("OAuth RefreshToken family is revoked");
    }
    await client.query(
      `insert into oauth_refresh_tokens
         (id, family_id, generation, token_hash, account_id, client_id,
          session_id, grant_id, resource, issued_scopes, created_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               to_timestamp($11), to_timestamp($12))`,
      [
        randomUUID(),
        familyId,
        generation,
        hashBearerValue(credential),
        accountId,
        clientId,
        session.id,
        grantId,
        dependencies.resource,
        scopes,
        issuedAt,
        expiresAt
      ]
    );
    if (generation > 0) {
      const replaced = await client.query(
        `update oauth_refresh_tokens
            set replaced_by_generation = $3
          where family_id = $1 and generation = $2 and consumed_at is not null
            and replaced_by_generation is null`,
        [familyId, generation - 1, generation]
      );
      if (replaced.rowCount !== 1) {
        throw new Error("OAuth RefreshToken rotation predecessor is invalid");
      }
      await insertOAuthSecurityEvent(client, {
        eventType: "oauth_refresh_rotation",
        actorKind: "oauth_client",
        accountId,
        clientId,
        sessionId: session.id,
        correlationId: familyId
      });
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function findRefreshToken(
  dependencies: OAuthProviderAdapterDependencies,
  credential: string
): Promise<AdapterPayload | undefined> {
  const result = await dependencies.pool.query<{
    account_id: string;
    acr: string;
    amr: string[];
    authenticated_at: Date;
    client_id: string;
    consumed_at: Date | null;
    created_at: Date;
    expires_at: Date;
    family_created_at: Date;
    generation: number;
    grant_id: string;
    issued_scopes: string[];
    provider_uid: string;
    resource: string;
    revoked_at: Date | null;
  }>(
    `select t.account_id, t.client_id, t.grant_id, t.generation, t.resource,
            t.issued_scopes, t.created_at, t.expires_at, t.consumed_at,
            t.revoked_at, f.created_at as family_created_at, s.provider_uid,
            s.authenticated_at, s.acr, s.amr
       from oauth_refresh_tokens t
       join oauth_refresh_token_families f on f.id = t.family_id
       join oauth_sessions s on s.id = t.session_id and s.account_id = t.account_id
       join identity_accounts a on a.id = t.account_id and a.status = 'active'
       join oauth_clients c on c.id = t.client_id and c.status = 'active'
       join oauth_grants g on g.id = t.grant_id and g.revoked_at is null
      where t.token_hash = $1 and f.revoked_at is null
        and f.expires_at >= now() and s.revoked_at is null
        and s.expires_at >= now()`,
    [hashBearerValue(credential)]
  );
  const row = result.rows[0];
  if (!row || row.revoked_at) return undefined;
  return {
    accountId: row.account_id,
    acr: row.acr,
    amr: row.amr,
    authTime: Math.floor(row.authenticated_at.getTime() / 1_000),
    clientId: row.client_id,
    consumed: row.consumed_at
      ? Math.floor(row.consumed_at.getTime() / 1_000)
      : undefined,
    exp: Math.floor(row.expires_at.getTime() / 1_000),
    expiresWithSession: true,
    grantId: row.grant_id,
    gty: row.generation === 0
      ? "authorization_code"
      : "authorization_code refresh_token",
    iat: Math.floor(row.created_at.getTime() / 1_000),
    iiat: Math.floor(row.family_created_at.getTime() / 1_000),
    jti: credential,
    kind: "RefreshToken",
    resource: row.resource,
    rotations: row.generation,
    scope: [...row.issued_scopes].sort().join(" "),
    sessionUid: row.provider_uid
  };
}

async function revokeRefreshFamilyByToken(pool: Pool, credential: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const target = await client.query<{
      account_id: string;
      client_id: string;
      consumed_at: Date | null;
      family_id: string;
      session_id: string;
    }>(
      `select account_id, client_id, consumed_at, family_id, session_id
         from oauth_refresh_tokens
        where token_hash = $1
        for update`,
      [hashBearerValue(credential)]
    );
    const row = target.rows[0];
    if (row) {
      await client.query(
        `update oauth_refresh_token_families
            set revoked_at = coalesce(revoked_at, now()),
                reuse_detected_at = case
                  when $2::boolean then coalesce(reuse_detected_at, now())
                  else reuse_detected_at
                end
          where id = $1`,
        [row.family_id, row.consumed_at !== null]
      );
      await client.query(
        `update oauth_refresh_tokens
            set revoked_at = coalesce(revoked_at, now())
          where family_id = $1`,
        [row.family_id]
      );
      if (row.consumed_at) {
        await insertOAuthSecurityEvent(client, {
          eventType: "oauth_refresh_reuse_detected",
          actorKind: "oauth_client",
          accountId: row.account_id,
          clientId: row.client_id,
          sessionId: row.session_id,
          correlationId: row.family_id
        });
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function insertOAuthSecurityEvent(
  client: PoolClient,
  input: {
    readonly eventType:
      | "oauth_authorization"
      | "oauth_code_exchange"
      | "oauth_refresh_rotation"
      | "oauth_refresh_reuse_detected";
    readonly actorKind: "account" | "oauth_client";
    readonly actorAccountId?: string;
    readonly accountId: string;
    readonly clientId: string;
    readonly sessionId: string;
    readonly correlationId: string;
  }
): Promise<void> {
  await client.query(
    `insert into identity_security_events
       (id, event_type, outcome, actor_kind, actor_account_id, account_id,
        client_id, session_id, correlation_id)
     values ($1, $2, 'succeeded', $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      input.eventType,
      input.actorKind,
      input.actorAccountId ?? null,
      input.accountId,
      input.clientId,
      input.sessionId,
      input.correlationId
    ]
  );
}

async function findBoundSession(
  pool: Pool,
  providerUid: string,
  accountId: string
): Promise<{ id: string }> {
  const result = await pool.query<{ id: string }>(
    `select s.id from oauth_sessions s
       join identity_accounts a on a.id = s.account_id and a.status = 'active'
      where s.provider_uid = $1 and s.account_id = $2
        and s.provider_credential_hash is not null
        and s.revoked_at is null and s.expires_at >= now()`,
    [providerUid, accountId]
  );
  const row = result.rows[0];
  if (!row) throw new Error("OAuth token references an unknown provider session");
  return row;
}

function assertTokenIdentity(
  model: "AuthorizationCode" | "RefreshToken",
  credential: string,
  payload: AdapterPayload
): void {
  assertOpaqueIdentifier(credential, `OAuth ${model} credential`);
  if (payload.jti !== credential || payload.kind !== model) {
    throw new Error(`OAuth ${model} identity is inconsistent`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertRecordFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  label: string
): void {
  const allowed = new Set(fields);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${label} contains unsupported fields: ${unknown.sort().join(", ")}`);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is invalid`);
  return value;
}

function optionalString(value: unknown, label: string): string | null {
  return value === undefined ? null : requireString(value, label);
}

function requireEpoch(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requireUuid(value: unknown, label: string): string {
  const result = requireString(value, label);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new Error(`${label} must be a UUID`);
  }
  return result;
}

function assertOpaqueIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error(`${label} is invalid`);
}

function splitScope(value: string): string[] {
  const scopes = [...new Set(value.split(" ").filter(Boolean))];
  if (scopes.length === 0) throw new Error("OAuth scope set is empty");
  return scopes.sort();
}

function stringList(value: unknown, label: string): string[] {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0 || values.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${label} is invalid`);
  }
  return [...new Set(values as string[])].sort();
}
