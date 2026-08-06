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
