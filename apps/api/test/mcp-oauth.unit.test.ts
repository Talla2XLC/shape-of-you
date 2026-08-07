import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey
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
let localJwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  privateKey = pair.privateKey;
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

async function token(scope: string, audience = resource): Promise<string> {
  return new SignJWT({ scope })
    .setProtectedHeader({ alg: "ES256", kid: "test-v1" })
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
