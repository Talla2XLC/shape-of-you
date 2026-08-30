import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey
} from "jose";

import type { AuthorizedPerson } from "../storage/identity-subject-mapping-repository.js";

export const MCP_READ_SCOPE = "person:read";
export const MCP_WEIGHT_WRITE_SCOPE = "weight:write";
export const MCP_BODY_MEASUREMENT_WRITE_SCOPE = "body-measurement:write";
export const MCP_MEAL_WRITE_SCOPE = "meal:write";
export const MCP_WORKOUT_WRITE_SCOPE = "workout:write";
export const MCP_RECOVERY_WRITE_SCOPE = "recovery:write";
export const MCP_DAILY_CONTEXT_NOTE_WRITE_SCOPE = "daily-context-note:write";

export type McpOAuthErrorCode = "invalid_token" | "insufficient_scope";

export class McpAuthorizationError extends Error {
  public constructor(
    message: string,
    public readonly oauthError: McpOAuthErrorCode
  ) {
    super(message);
  }
}

/** Minimal API-owned lookup used after cryptographic token verification. */
export interface IdentitySubjectResolver {
  resolveAuthorizedPersons(
    issuer: string,
    subject: string
  ): Promise<readonly AuthorizedPerson[]>;
}

/** Authorization contract consumed by the MCP transport adapter. */
export interface McpAuthorizationBoundary {
  authorize(
    authorizationHeader: string | undefined,
    requiredScope: string,
    write: boolean
  ): Promise<AuthorizedPerson>;
}

/** OAuth verifier and API-local Person authorization boundary for MCP calls. */
export class McpAuthorizer implements McpAuthorizationBoundary {
  private readonly jwks: JWTVerifyGetKey;

  public constructor(
    private readonly issuer: string,
    jwksUri: string,
    private readonly resource: string,
    private readonly mappings: IdentitySubjectResolver,
    keyResolver: JWTVerifyGetKey = createRemoteJWKSet(
      new URL(jwksUri)
    )
  ) {
    this.jwks = keyResolver;
  }

  /** Verifies one bearer token and resolves exactly one authorized Person. */
  public async authorize(
    authorizationHeader: string | undefined,
    requiredScope: string,
    write: boolean
  ): Promise<AuthorizedPerson> {
    const token = parseBearerToken(authorizationHeader);
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.resource,
        algorithms: ["ES256"]
      }));
    } catch {
      throw new McpAuthorizationError(
        "The OAuth access token is invalid",
        "invalid_token"
      );
    }

    if (!payload.sub) {
      throw new McpAuthorizationError(
        "The OAuth access token has no subject",
        "invalid_token"
      );
    }
    const scopes = readScopes(payload);
    if (!scopes.has(requiredScope)) {
      throw new McpAuthorizationError(
        "The OAuth access token lacks the required scope",
        "insufficient_scope"
      );
    }

    const persons = await this.mappings.resolveAuthorizedPersons(
      this.issuer,
      payload.sub
    );
    if (persons.length !== 1) {
      throw new McpAuthorizationError(
        "The Identity subject must resolve to exactly one active Person",
        "invalid_token"
      );
    }
    const person = persons[0]!;
    if (write && !person.roles.some((role) => role === "owner" || role === "editor")) {
      throw new McpAuthorizationError(
        "The active Person grant is read-only",
        "insufficient_scope"
      );
    }
    return person;
  }
}

function parseBearerToken(header: string | undefined): string {
  const match = /^Bearer ([^\s]+)$/i.exec(header ?? "");
  if (!match) {
    throw new McpAuthorizationError(
      "A bearer access token is required",
      "invalid_token"
    );
  }
  return match[1]!;
}

function readScopes(payload: JWTPayload): Set<string> {
  if (typeof payload.scope === "string") {
    return new Set(payload.scope.split(/\s+/u).filter(Boolean));
  }
  const scp = payload.scp;
  if (Array.isArray(scp) && scp.every((value) => typeof value === "string")) {
    return new Set(scp);
  }
  return new Set();
}
