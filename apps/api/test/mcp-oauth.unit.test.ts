import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWTVerifyGetKey
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import {
  MCP_READ_SCOPE,
  MCP_WEIGHT_WRITE_SCOPE,
  McpAuthorizationError,
  McpAuthorizer,
  type IdentitySubjectResolver
} from "../src/mcp/oauth.js";
import type { AuthorizedPerson } from "../src/storage/identity-subject-mapping-repository.js";

const issuer = "https://identity.example.test";
const resource = "https://api.example.test/mcp";
let privateKey: CryptoKey;
let publicKey: CryptoKey;
let localJwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
  const jwk = await exportJWK(pair.publicKey);
  localJwks = createLocalJWKSet({ keys: [{ ...jwk, kid: "test-v1", use: "sig" }] });
});

function resolver(
  persons: readonly AuthorizedPerson[] = [
    { personId: "00000000-0000-4000-8000-000000000001", roles: ["owner"] }
  ]
): IdentitySubjectResolver {
  return { resolveAuthorizedPersons: async () => persons };
}

async function token(
  scope: string,
  audience = resource,
  kid: string | null = "test-v1"
): Promise<string> {
  return new SignJWT({ scope })
    .setProtectedHeader({ alg: "ES256", ...(kid ? { kid } : {}) })
    .setIssuer(issuer)
    .setSubject("identity-account-1")
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

describe("MCP OAuth authorization", () => {
  it("accepts a valid scoped token and exact active Person mapping", async () => {
    const authorizer = new McpAuthorizer(issuer, "https://unused.test/jwks", resource, resolver(), localJwks);

    await expect(
      authorizer.authorize(`Bearer ${await token(MCP_READ_SCOPE)}`, MCP_READ_SCOPE, false)
    ).resolves.toMatchObject({ roles: ["owner"] });
  });

  it("rejects a token issued for another resource", async () => {
    const authorizer = new McpAuthorizer(issuer, "https://unused.test/jwks", resource, resolver(), localJwks);

    await expect(
      authorizer.authorize(
        `Bearer ${await token(MCP_READ_SCOPE, "https://other.example.test")}`,
        MCP_READ_SCOPE,
        false
      )
    ).rejects.toBeInstanceOf(McpAuthorizationError);
  });

  it("denies a compromised kid even when the signing key remains cached", async () => {
    const authorizer = new McpAuthorizer(
      issuer,
      "https://unused.test/jwks",
      resource,
      resolver(),
      localJwks,
      new Set(["test-v1"])
    );
    await expect(
      authorizer.authorize(`Bearer ${await token(MCP_READ_SCOPE)}`, MCP_READ_SCOPE, false)
    ).rejects.toMatchObject({ oauthError: "invalid_token" });
  });

  it("accepts new JWTs from cold and refreshed warm JWKS clients after publication", async () => {
    const replacement = await generateKeyPair("ES256");
    const currentJwk = await exportJWK(publicKey);
    const replacementJwk = await exportJWK(replacement.publicKey);
    const beforePublication = createLocalJWKSet({ keys: [
      { ...currentJwk, kid: "test-v1", use: "sig" }
    ] });
    const afterPublication = createLocalJWKSet({ keys: [
      { ...currentJwk, kid: "test-v1", use: "sig" },
      { ...replacementJwk, kid: "test-v2", use: "sig" }
    ] });
    let cached = beforePublication;
    const warmResolver: JWTVerifyGetKey = (header, tokenValue) => cached(header, tokenValue);
    const warm = new McpAuthorizer(issuer, "https://unused.test/jwks", resource, resolver(), warmResolver);
    const cold = new McpAuthorizer(issuer, "https://unused.test/jwks", resource, resolver(), afterPublication);
    const newToken = await new SignJWT({ scope: MCP_READ_SCOPE })
      .setProtectedHeader({ alg: "ES256", kid: "test-v2" })
      .setIssuer(issuer)
      .setSubject("identity-account-1")
      .setAudience(resource)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(replacement.privateKey);

    await expect(warm.authorize(`Bearer ${await token(MCP_READ_SCOPE)}`, MCP_READ_SCOPE, false))
      .resolves.toMatchObject({ roles: ["owner"] });
    await expect(warm.authorize(`Bearer ${newToken}`, MCP_READ_SCOPE, false))
      .rejects.toMatchObject({ oauthError: "invalid_token" });
    await expect(cold.authorize(`Bearer ${newToken}`, MCP_READ_SCOPE, false))
      .resolves.toMatchObject({ roles: ["owner"] });
    cached = afterPublication;
    await expect(warm.authorize(`Bearer ${newToken}`, MCP_READ_SCOPE, false))
      .resolves.toMatchObject({ roles: ["owner"] });
  });

  it("rejects a signed token with no kid instead of selecting a cached key", async () => {
    const authorizer = new McpAuthorizer(
      issuer,
      "https://unused.test/jwks",
      resource,
      resolver(),
      localJwks
    );
    await expect(
      authorizer.authorize(
        `Bearer ${await token(MCP_READ_SCOPE, resource, null)}`,
        MCP_READ_SCOPE,
        false
      )
    ).rejects.toMatchObject({ oauthError: "invalid_token" });
  });

  it("rejects writes for a viewer even with the write scope", async () => {
    const authorizer = new McpAuthorizer(
      issuer,
      "https://unused.test/jwks",
      resource,
      resolver([{ personId: "00000000-0000-4000-8000-000000000001", roles: ["viewer"] }]),
      localJwks
    );

    await expect(
      authorizer.authorize(
        `Bearer ${await token(MCP_WEIGHT_WRITE_SCOPE)}`,
        MCP_WEIGHT_WRITE_SCOPE,
        true
      )
    ).rejects.toThrow("read-only");
  });

  it("fails closed when one subject resolves to multiple Persons", async () => {
    const authorizer = new McpAuthorizer(
      issuer,
      "https://unused.test/jwks",
      resource,
      resolver([
        { personId: "00000000-0000-4000-8000-000000000001", roles: ["owner"] },
        { personId: "00000000-0000-4000-8000-000000000002", roles: ["owner"] }
      ]),
      localJwks
    );

    await expect(
      authorizer.authorize(`Bearer ${await token(MCP_READ_SCOPE)}`, MCP_READ_SCOPE, false)
    ).rejects.toThrow("exactly one active Person");
  });
});
