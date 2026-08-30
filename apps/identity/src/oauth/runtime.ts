import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import Provider, {
  errors,
  type Interaction,
  type InteractionResults,
  type JWK
} from "oidc-provider";
import type { Pool } from "pg";

import { OAuthClientStore } from "./client-store.js";
import { createOAuthProviderAdapterFactory } from "./provider-adapter.js";
import { OAuthRequestContext } from "./request-context.js";
import type { OAuthSigningKeyRing } from "./signing-keys.js";

/** OIDC protocol scopes supported by the initial external-client profile. */
export const initialOAuthProtocolScopes = ["openid", "offline_access"] as const;

/** Resource permissions exposed by the initial Shape of You MCP server. */
export const initialOAuthResourceScopes = [
  "body-measurement:write",
  "daily-context-note:write",
  "meal:write",
  "person:read",
  "recovery:write",
  "weight:write",
  "workout:write"
] as const;

const initialOAuthProtocolScopeSet = new Set<string>(initialOAuthProtocolScopes);
const initialOAuthResourceScopeSet = new Set<string>(initialOAuthResourceScopes);

/** Inputs required to create the Identity-owned OAuth protocol runtime. */
export interface OAuthRuntimeDependencies {
  readonly pool: Pool;
  readonly issuer: string;
  readonly resource: string;
  readonly signingKeys: OAuthSigningKeyRing;
  readonly cookieKeys: readonly string[];
}

/** Narrow wrapper around `oidc-provider` used by the native Identity server. */
export class OAuthRuntime {
  private readonly provider: Provider;
  private readonly callback: ReturnType<Provider["callback"]>;
  private readonly requestContext = new OAuthRequestContext();
  private readonly clients: OAuthClientStore;

  public constructor(private readonly dependencies: OAuthRuntimeDependencies) {
    this.clients = new OAuthClientStore(dependencies.pool);
    const secureCookies = new URL(dependencies.issuer).protocol === "https:";
    this.provider = new Provider(dependencies.issuer, {
      adapter: createOAuthProviderAdapterFactory({
        pool: dependencies.pool,
        clients: this.clients,
        requestContext: this.requestContext,
        issuer: dependencies.issuer,
        resource: dependencies.resource
      }),
      clientAuthMethods: ["none"],
      cookies: {
        keys: dependencies.cookieKeys,
        long: { httpOnly: true, sameSite: "lax", secure: secureCookies },
        names: {
          interaction: "shape_of_you_oidc_interaction",
          resume: "shape_of_you_oidc_resume",
          session: "shape_of_you_oidc_session"
        },
        short: { httpOnly: true, sameSite: "lax", secure: secureCookies }
      },
      enabledJWA: { idTokenSigningAlgValues: ["ES256"] },
      expiresWithSession: async () => true,
      features: {
        devInteractions: { enabled: false },
        introspection: { enabled: false },
        registration: { enabled: false },
        resourceIndicators: {
          enabled: true,
          getResourceServerInfo: async (_context, resource) => {
            if (resource !== dependencies.resource) {
              throw new errors.InvalidTarget("Unsupported OAuth resource indicator");
            }
            return {
              accessTokenFormat: "jwt",
              accessTokenTTL: 600,
              audience: dependencies.resource,
              jwt: { sign: { alg: "ES256", kid: dependencies.signingKeys.activeKeyId } },
              scope: initialOAuthResourceScopes.join(" ")
            };
          }
        },
        revocation: { enabled: true },
        rpInitiatedLogout: { enabled: false },
        userinfo: { enabled: false }
      },
      findAccount: async (_context, accountId) => {
        const result = await dependencies.pool.query<{ subject: string }>(
          "select subject from identity_accounts where id = $1 and status = 'active'",
          [accountId]
        );
        const row = result.rows[0];
        if (!row) return undefined;
        return {
          accountId,
          claims: async () => ({ sub: accountId })
        };
      },
      formats: {
        customizers: {
          jwt: async (_context, token, structured) => {
            if (!("accountId" in token) || !token.accountId) {
              throw new Error("OAuth access token has no account");
            }
            const result = await dependencies.pool.query<{ id: string }>(
              "select id from identity_accounts where id = $1 and status = 'active'",
              [token.accountId]
            );
            const row = result.rows[0];
            if (!row) throw new Error("OAuth access-token account is unavailable");
            structured.payload.sub = row.id;
            return structured;
          }
        }
      },
      interactions: {
        url: async (_context, interaction) =>
          `/oauth/interaction/${interaction.uid}`
      },
      issueRefreshToken: async (_context, client) =>
        this.clients.isRefreshTokenEnabled(client.clientId),
      jwks: { keys: dependencies.signingKeys.jwks as readonly JWK[] },
      pkce: { required: () => true },
      renderError: async (context, out) => {
        context.set("cache-control", "no-store");
        context.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
        context.set("referrer-policy", "no-referrer");
        context.set("x-content-type-options", "nosniff");
        context.set("x-frame-options", "DENY");
        context.type = "html";
        const description = typeof out.error_description === "string"
          ? out.error_description
          : "The authorization request could not be completed.";
        context.body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorization failed · Shape of You</title></head><body><main><h1>Authorization failed</h1><p>${escapeHtml(description)}</p></main></body></html>`;
      },
      responseTypes: ["code"],
      rotateRefreshToken: true,
      routes: {
        authorization: "/oauth/authorize",
        jwks: "/oauth/jwks",
        revocation: "/oauth/revoke",
        token: "/oauth/token"
      },
      scopes: [...initialOAuthProtocolScopes, ...initialOAuthResourceScopes],
      subjectTypes: ["public"],
      ttl: {
        AccessToken: 600,
        AuthorizationCode: 600,
        Grant: 365 * 24 * 60 * 60,
        Interaction: 10 * 60,
        RefreshToken: 30 * 24 * 60 * 60,
        Session: 30 * 24 * 60 * 60
      }
    });
    this.provider.proxy = true;
    this.provider.on("server_error", (_context, error) => {
      process.stderr.write(
        `${JSON.stringify({
          level: "error",
          message: "OAuth provider request failed",
          error: error.message
        })}\n`
      );
    });
    this.callback = this.provider.callback();
  }

  /** Returns true for protocol routes owned directly by `oidc-provider`. */
  public ownsProviderPath(pathname: string): boolean {
    return (
      pathname === "/.well-known/openid-configuration" ||
      pathname === "/.well-known/oauth-authorization-server" ||
      pathname === "/oauth/authorize" ||
      pathname.startsWith("/oauth/authorize/") ||
      pathname === "/oauth/jwks" ||
      pathname === "/oauth/revoke" ||
      pathname === "/oauth/token"
    );
  }

  /** Delegates one known protocol request and preserves resume binding context. */
  public handleProviderRequest(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string
  ): void {
    if (pathname === "/oauth/authorize") {
      ensureOfflineAccessConsentPrompt(request, this.dependencies.issuer);
    }
    const resume = pathname.match(/^\/oauth\/authorize\/([A-Za-z0-9_-]{43})$/);
    if (resume) {
      this.requestContext.run(resume[1]!, () => this.delegate(request, response));
      return;
    }
    this.delegate(request, response);
  }

  /** Reads the provider-validated details for the current interaction cookie. */
  public async interactionDetails(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<Interaction> {
    return this.provider.interactionDetails(request, response);
  }

  /** Persists an interaction result and redirects to the provider resume route. */
  public async finishInteraction(
    request: IncomingMessage,
    response: ServerResponse,
    result: InteractionResults
  ): Promise<void> {
    await this.provider.interactionFinished(request, response, result, {
      mergeWithLastSubmission: false
    });
  }

  /** Creates, reuses, or extends one consent grant with disjoint protocol and resource scopes. */
  public async grantConsentScopes(input: {
    readonly accountId: string;
    readonly clientId: string;
    readonly existingGrantId?: string | undefined;
    readonly scopes: readonly string[];
  }): Promise<string> {
    const uniqueScopes = [...new Set(input.scopes)];
    const allowedScopes = await this.clients.listAllowedScopes(input.clientId);
    if (uniqueScopes.some((scope) => !allowedScopes.has(scope))) {
      throw new errors.InvalidScope(
        "OAuth consent exceeds the client scope allowlist",
        uniqueScopes.join(" ")
      );
    }
    if (
      uniqueScopes.includes("offline_access") &&
      !(await this.clients.isRefreshTokenEnabled(input.clientId))
    ) {
      throw new errors.InvalidScope(
        "OAuth client cannot receive offline access",
        "offline_access"
      );
    }
    const oidcScopes = uniqueScopes.filter((scope) =>
      initialOAuthProtocolScopeSet.has(scope)
    );
    const resourceScopes = uniqueScopes.filter((scope) =>
      initialOAuthResourceScopeSet.has(scope)
    );
    if (oidcScopes.length + resourceScopes.length !== uniqueScopes.length) {
      throw new errors.InvalidScope(
        "OAuth consent contains an unsupported scope",
        uniqueScopes.join(" ")
      );
    }

    for (const retry of [false, true]) {
      const persistedGrant = input.existingGrantId
        ? { id: input.existingGrantId }
        : (await this.dependencies.pool.query<{ id: string }>(
            `select id from oauth_grants
              where account_id = $1 and client_id = $2 and revoked_at is null`,
            [input.accountId, input.clientId]
          )).rows[0];
      let grant = persistedGrant
        ? await this.provider.Grant.find(persistedGrant.id)
        : undefined;
      if (!grant && input.existingGrantId) {
        throw new Error("OAuth grant is unavailable");
      }
      if (!grant) {
        grant = new this.provider.Grant({
          accountId: input.accountId,
          clientId: input.clientId
        });
        grant.jti = persistedGrant?.id ?? randomUUID();
      }
      if (!grant.jti) grant.jti = randomUUID();
      grant.addOIDCScope(oidcScopes);
      if (resourceScopes.length > 0) {
        grant.rejectOIDCScope(resourceScopes);
        grant.addResourceScope(this.dependencies.resource, resourceScopes);
      }
      try {
        await grant.save();
        return grant.jti;
      } catch (error) {
        if (
          retry ||
          input.existingGrantId !== undefined ||
          persistedGrant !== undefined ||
          !isActiveGrantConflict(error)
        ) {
          throw error;
        }
      }
    }
    throw new Error("OAuth grant retry is exhausted");
  }

  private delegate(request: IncomingMessage, response: ServerResponse): void {
    void this.callback(request, response).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "server_error" }));
      } else {
        response.destroy();
      }
    });
  }
}

/** Forces explicit consent when a client requests OIDC offline access without a prompt. */
function ensureOfflineAccessConsentPrompt(
  request: IncomingMessage,
  issuer: string
): void {
  if (request.method !== "GET" || !request.url) return;
  const authorization = new URL(request.url, issuer);
  const scopes = new Set(
    authorization.searchParams.get("scope")?.split(" ").filter(Boolean) ?? []
  );
  if (!scopes.has("offline_access") || authorization.searchParams.has("prompt")) {
    return;
  }
  authorization.searchParams.set("prompt", "consent");
  request.url = `${authorization.pathname}${authorization.search}`;
}

/** Identifies the exact one-active-grant race that is safe to retry once. */
function isActiveGrantConflict(error: unknown): boolean {
  const databaseError = error as { code?: unknown; constraint?: unknown };
  return (
    databaseError.code === "23505" &&
    databaseError.constraint === "oauth_grants_active_account_client_uq"
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]!);
}
