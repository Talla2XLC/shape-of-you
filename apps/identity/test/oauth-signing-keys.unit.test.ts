import { generateKeyPairSync, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  parseOAuthCookieKeys,
  parseOAuthSigningKeyRing
} from "../src/oauth/signing-keys.js";

function createPrivateKeyValue(curve: "P-256" | "P-384" = "P-256"): string {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: curve });
  return privateKey
    .export({ format: "der", type: "pkcs8" })
    .toString("base64url");
}

describe("parseOAuthSigningKeyRing", () => {
  it("validates ES256 keys and orders the active key first", () => {
    const first = createPrivateKeyValue();
    const active = createPrivateKeyValue();

    const result = parseOAuthSigningKeyRing(
      "v2",
      JSON.stringify({ v1: first, v2: active })
    );

    expect(result.activeKeyId).toBe("v2");
    expect(result.jwks.map((key) => key.kid)).toEqual(["v2", "v1"]);
    expect(result.jwks[0]).toMatchObject({
      alg: "ES256",
      crv: "P-256",
      kty: "EC",
      use: "sig"
    });
    expect(result.publicSpkiByKeyId.get("v2")?.length).toBeGreaterThan(0);
  });

  it("rejects an active key missing from the ring", () => {
    expect(() =>
      parseOAuthSigningKeyRing(
        "v2",
        JSON.stringify({ v1: createPrivateKeyValue() })
      )
    ).toThrow("missing from the key ring");
  });

  it("rejects a non-P-256 private key", () => {
    expect(() =>
      parseOAuthSigningKeyRing(
        "v1",
        JSON.stringify({ v1: createPrivateKeyValue("P-384") })
      )
    ).toThrow("must be P-256");
  });
});

describe("parseOAuthCookieKeys", () => {
  it("accepts rotating 32-byte secrets", () => {
    const keys = [randomBytes(32), randomBytes(32)].map((key) =>
      key.toString("base64url")
    );
    expect(parseOAuthCookieKeys(JSON.stringify(keys))).toEqual(keys);
  });

  it("rejects duplicate secrets", () => {
    const key = randomBytes(32).toString("base64url");
    expect(() => parseOAuthCookieKeys(JSON.stringify([key, key]))).toThrow(
      "must be unique"
    );
  });
});
