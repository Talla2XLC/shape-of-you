import { randomUUID } from "node:crypto";

import type { AdapterPayload } from "oidc-provider";
import type { Pool, PoolClient } from "pg";

/** Administrator-owned metadata for one predefined public OAuth client. */
export interface OAuthPublicClientInput {
  readonly clientId: string;
  readonly displayName: string;
  readonly redirectUris: readonly string[];
  readonly allowedScopes: readonly string[];
  readonly refreshTokensEnabled: boolean;
}

/**
 * Loads and provisions predefined public OAuth clients in typed Identity tables.
 *
 * This store never accepts client secrets or dynamic registration metadata.
 * Disabled clients and incomplete relational records fail closed.
 */
export class OAuthClientStore {
  public constructor(private readonly pool: Pool) {}

  /** Returns provider metadata for an active predefined client. */
  public async findProviderClient(clientId: string): Promise<AdapterPayload | undefined> {
    const result = await this.pool.query<{
      display_name: string;
      refresh_tokens_enabled: boolean;
      redirect_uris: string[];
      allowed_scopes: string[];
    }>(
      `select c.display_name,
              c.refresh_tokens_enabled,
              coalesce(array_agg(distinct r.redirect_uri) filter (where r.redirect_uri is not null), array[]::text[]) as redirect_uris,
              coalesce(array_agg(distinct s.scope) filter (where s.scope is not null), array[]::text[]) as allowed_scopes
         from oauth_clients c
         left join oauth_client_redirect_uris r on r.client_id = c.id
         left join oauth_client_allowed_scopes s on s.client_id = c.id
        where c.id = $1 and c.status = 'active'
        group by c.id`,
      [clientId]
    );
    const row = result.rows[0];
    if (!row || row.redirect_uris.length === 0 || row.allowed_scopes.length === 0) {
      return undefined;
    }
    return {
      client_id: clientId,
      client_name: row.display_name,
      redirect_uris: [...row.redirect_uris].sort(),
      response_types: ["code"],
      grant_types: row.refresh_tokens_enabled
        ? ["authorization_code", "refresh_token"]
        : ["authorization_code"],
      application_type: "web",
      id_token_signed_response_alg: "ES256",
      token_endpoint_auth_method: "none"
    };
  }

  /** Returns the exact scope allowlist for an active client. */
  public async listAllowedScopes(clientId: string): Promise<ReadonlySet<string>> {
    const result = await this.pool.query<{ scope: string }>(
      `select s.scope
         from oauth_client_allowed_scopes s
         join oauth_clients c on c.id = s.client_id
        where s.client_id = $1 and c.status = 'active'
        order by s.scope`,
      [clientId]
    );
    return new Set(result.rows.map((row) => row.scope));
  }

  /** Returns whether the active client may receive rotating refresh tokens. */
  public async isRefreshTokenEnabled(clientId: string): Promise<boolean> {
    const result = await this.pool.query<{ refresh_tokens_enabled: boolean }>(
      `select refresh_tokens_enabled
         from oauth_clients
        where id = $1 and status = 'active'`,
      [clientId]
    );
    return result.rows[0]?.refresh_tokens_enabled === true;
  }

  /**
   * Creates or updates one predefined public client as a single transaction.
   *
   * Redirect URI and scope rows are reconciled exactly; omitted values are
   * removed. Existing grants are not mutated.
   */
  public async provisionPublicClient(input: OAuthPublicClientInput): Promise<void> {
    validatePublicClient(input);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into oauth_clients (
           id, display_name, status, refresh_tokens_enabled, created_at, updated_at, disabled_at
         ) values ($1, $2, 'active', $3, now(), now(), null)
         on conflict (id) do update
           set display_name = excluded.display_name,
               status = 'active',
               refresh_tokens_enabled = excluded.refresh_tokens_enabled,
               updated_at = now(),
               disabled_at = null`,
        [input.clientId, input.displayName, input.refreshTokensEnabled]
      );
      await reconcileRedirectUris(client, input);
      await reconcileScopes(client, input);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

function validatePublicClient(input: OAuthPublicClientInput): void {
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(input.clientId)) {
    throw new Error("OAuth client id is invalid");
  }
  if (!input.displayName.trim() || input.displayName.length > 200) {
    throw new Error("OAuth client display name is invalid");
  }
  if (input.redirectUris.length === 0 || new Set(input.redirectUris).size !== input.redirectUris.length) {
    throw new Error("OAuth client redirect URIs must be non-empty and unique");
  }
  for (const value of input.redirectUris) {
    const uri = new URL(value);
    if (uri.hash || uri.username || uri.password || uri.protocol !== "https:") {
      throw new Error("OAuth client redirect URIs must be credential-free HTTPS URLs without fragments");
    }
  }
  if (input.allowedScopes.length === 0 || new Set(input.allowedScopes).size !== input.allowedScopes.length) {
    throw new Error("OAuth client scopes must be non-empty and unique");
  }
  if (input.allowedScopes.some((scope) => !/^[A-Za-z0-9:._-]{1,200}$/.test(scope))) {
    throw new Error("OAuth client scope is invalid");
  }
}

async function reconcileRedirectUris(
  client: PoolClient,
  input: OAuthPublicClientInput
): Promise<void> {
  await client.query(
    "delete from oauth_client_redirect_uris where client_id = $1 and not (redirect_uri = any($2::text[]))",
    [input.clientId, input.redirectUris]
  );
  for (const redirectUri of input.redirectUris) {
    await client.query(
      `insert into oauth_client_redirect_uris (id, client_id, redirect_uri)
       values ($1, $2, $3)
       on conflict (client_id, redirect_uri) do nothing`,
      [randomUUID(), input.clientId, redirectUri]
    );
  }
}

async function reconcileScopes(
  client: PoolClient,
  input: OAuthPublicClientInput
): Promise<void> {
  await client.query(
    "delete from oauth_client_allowed_scopes where client_id = $1 and not (scope = any($2::text[]))",
    [input.clientId, input.allowedScopes]
  );
  for (const scope of input.allowedScopes) {
    await client.query(
      `insert into oauth_client_allowed_scopes (client_id, scope)
       values ($1, $2)
       on conflict (client_id, scope) do nothing`,
      [input.clientId, scope]
    );
  }
}
