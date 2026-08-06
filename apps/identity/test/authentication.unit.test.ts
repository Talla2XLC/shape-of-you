import { describe, expect, it } from "vitest";

import {
  bearerValueMatches,
  createOpaqueToken,
  hashBearerValue
} from "../src/authentication/crypto.js";
import {
  SimpleWebAuthnAdapter,
  toDatabaseWebAuthnTransport,
  toExternalWebAuthnTransport
} from "../src/authentication/webauthn-adapter.js";
import {
  createTotpCode,
  decryptTotpSecret,
  encryptTotpSecret,
  parseTotpKeyRing,
  verifyTotpCode
} from "../src/authentication/totp.js";

describe("Identity bearer hashing", () => {
  it("creates opaque tokens and compares only their fixed-width hashes", () => {
    const token = createOpaqueToken();
    const hash = hashBearerValue(token);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toHaveLength(32);
    expect(hash.toString("utf8")).not.toContain(token);
    expect(bearerValueMatches(token, hash)).toBe(true);
    expect(bearerValueMatches(createOpaqueToken(), hash)).toBe(false);
  });
});

describe("Identity WebAuthn transport mapping", () => {
  it("maps every transport bidirectionally without leaking enum spelling", () => {
    const external = [
      "ble",
      "cable",
      "hybrid",
      "internal",
      "nfc",
      "smart-card",
      "usb"
    ] as const;

    expect(external.map(toDatabaseWebAuthnTransport)).toEqual([
      "ble",
      "cable",
      "hybrid",
      "internal",
      "nfc",
      "smart_card",
      "usb"
    ]);
    expect(
      external
        .map(toDatabaseWebAuthnTransport)
        .map(toExternalWebAuthnTransport)
    ).toEqual(external);
  });

  it("configures discoverable credentials and mandatory user verification", async () => {
    const adapter = new SimpleWebAuthnAdapter();
    const registration = await adapter.createRegistrationOptions({
      rpId: "identity.example.test",
      rpName: "Shape of You",
      userHandle: Buffer.alloc(32, 1),
      userName: "subject",
      displayName: "Operator",
      excludedCredentialIds: []
    });
    const authentication = await adapter.createAuthenticationOptions({
      rpId: "identity.example.test"
    });

    expect(registration.attestation).toBe("none");
    expect(registration.authenticatorSelection).toMatchObject({
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required"
    });
    expect(authentication.userVerification).toBe("required");
    expect(authentication.allowCredentials).toBeUndefined();
  });
});

describe("Identity TOTP recovery primitives", () => {
  const encodedKey = Buffer.alloc(32, 7).toString("base64url");
  const keyRing = parseTotpKeyRing("v1", JSON.stringify({ v1: encodedKey }));

  it("encrypts seeds with authenticated versioned keys", () => {
    const secret = Buffer.from("12345678901234567890");
    const encrypted = encryptTotpSecret(secret, keyRing);

    expect(encrypted.keyId).toBe("v1");
    expect(encrypted.nonce).toHaveLength(12);
    expect(encrypted.tag).toHaveLength(16);
    expect(encrypted.ciphertext).not.toEqual(secret);
    expect(decryptTotpSecret(encrypted, keyRing)).toEqual(secret);
    expect(() =>
      decryptTotpSecret(
        encrypted,
        parseTotpKeyRing("v2", JSON.stringify({ v2: Buffer.alloc(32, 8).toString("base64url") }))
      )
    ).toThrow();
  });

  it("matches RFC 6238 codes within one step and rejects replay", () => {
    const secret = Buffer.from("12345678901234567890");
    expect(createTotpCode(secret, 1)).toBe("287082");

    const acceptedStep = verifyTotpCode(secret, "287082", new Date(59_000), null);
    expect(acceptedStep).toBe(1);
    expect(verifyTotpCode(secret, "287082", new Date(59_000), acceptedStep)).toBeNull();
    expect(verifyTotpCode(secret, "287082", new Date(120_000), null)).toBeNull();
  });

  it("rejects malformed key rings and missing active keys", () => {
    expect(() => parseTotpKeyRing("v1", "not-json")).toThrow();
    expect(() =>
      parseTotpKeyRing("v1", JSON.stringify({
        v1: Buffer.alloc(31).toString("base64url")
      }))
    ).toThrow();
    expect(() =>
      parseTotpKeyRing("v2", JSON.stringify({ v1: encodedKey }))
    ).toThrow();
  });
});
