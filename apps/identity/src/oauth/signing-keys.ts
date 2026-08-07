import { createPrivateKey, createPublicKey, type JsonWebKey } from "node:crypto";

const keyIdPattern = /^[A-Za-z0-9._-]{1,64}$/;

/** Parsed ES256 signing material supplied to the OAuth provider. */
export interface OAuthSigningKeyRing {
  /** Key identifier used for newly issued tokens. */
  readonly activeKeyId: string;
  /** Private JWKs ordered with the active signing key first. */
  readonly jwks: readonly JsonWebKey[];
  /** Public SPKI DER bytes keyed by `kid` for lifecycle reconciliation. */
  readonly publicSpkiByKeyId: ReadonlyMap<string, Buffer>;
}

/**
 * Parses a versioned ES256 private-key ring without retaining serialized input.
 *
 * Values are base64url-encoded PKCS#8 DER private keys. Every entry must be a
 * P-256 EC key and the configured active key must exist. Private material is
 * returned only as the JWK set required by `oidc-provider`; public SPKI bytes
 * are derived separately for persistence and comparison.
 *
 * @param activeKeyId - Key identifier used to sign new tokens.
 * @param serializedKeys - JSON object mapping key identifiers to PKCS#8 values.
 * @returns Validated signing material with the active key first.
 * @throws Error when JSON, key identifiers, encoding, or key type is invalid.
 */
export function parseOAuthSigningKeyRing(
  activeKeyId: string,
  serializedKeys: string
): OAuthSigningKeyRing {
  if (!keyIdPattern.test(activeKeyId)) {
    throw new Error("Active OAuth signing key id is invalid");
  }

  let input: unknown;
  try {
    input = JSON.parse(serializedKeys) as unknown;
  } catch {
    throw new Error("OAuth signing keys must be a JSON object");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("OAuth signing keys must be a JSON object");
  }

  const entries = Object.entries(input);
  if (entries.length === 0) {
    throw new Error("OAuth signing key ring must not be empty");
  }

  const parsed = new Map<
    string,
    { readonly privateJwk: JsonWebKey; readonly publicSpki: Buffer }
  >();
  for (const [keyId, value] of entries) {
    if (!keyIdPattern.test(keyId) || typeof value !== "string") {
      throw new Error("OAuth signing key entry is invalid");
    }
    const der = Buffer.from(value, "base64url");
    if (der.length === 0 || der.toString("base64url") !== value) {
      throw new Error("OAuth signing keys must be canonical base64url PKCS#8 values");
    }

    let privateKey;
    try {
      privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    } catch {
      throw new Error("OAuth signing key is not valid PKCS#8 private key material");
    }
    const details = privateKey.asymmetricKeyDetails;
    if (
      privateKey.asymmetricKeyType !== "ec" ||
      details?.namedCurve !== "prime256v1"
    ) {
      throw new Error("OAuth signing keys must be P-256 EC private keys");
    }

    const privateJwk = privateKey.export({ format: "jwk" });
    parsed.set(keyId, {
      privateJwk: { ...privateJwk, alg: "ES256", kid: keyId, use: "sig" },
      publicSpki: createPublicKey(privateKey).export({
        format: "der",
        type: "spki"
      })
    });
  }

  if (!parsed.has(activeKeyId)) {
    throw new Error("Active OAuth signing key id is missing from the key ring");
  }

  const orderedKeyIds = [
    activeKeyId,
    ...[...parsed.keys()].filter((keyId) => keyId !== activeKeyId).sort()
  ];
  return {
    activeKeyId,
    jwks: orderedKeyIds.map((keyId) => parsed.get(keyId)!.privateJwk),
    publicSpkiByKeyId: new Map(
      orderedKeyIds.map((keyId) => [keyId, parsed.get(keyId)!.publicSpki])
    )
  };
}

/**
 * Parses rotating OAuth cookie-signing secrets in newest-first order.
 *
 * @param serializedKeys - JSON array of canonical 32-byte base64url secrets.
 * @returns Decoded secrets suitable for `oidc-provider` cookie configuration.
 * @throws Error when the collection or any secret is invalid.
 */
export function parseOAuthCookieKeys(serializedKeys: string): readonly string[] {
  let input: unknown;
  try {
    input = JSON.parse(serializedKeys) as unknown;
  } catch {
    throw new Error("OAuth cookie keys must be a JSON array");
  }
  if (!Array.isArray(input) || input.length === 0 || input.length > 3) {
    throw new Error("OAuth cookie keys must contain between one and three values");
  }
  const unique = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string") {
      throw new Error("OAuth cookie key entry is invalid");
    }
    const decoded = Buffer.from(value, "base64url");
    if (decoded.length !== 32 || decoded.toString("base64url") !== value) {
      throw new Error("OAuth cookie keys must be 32-byte base64url values");
    }
    if (unique.has(value)) {
      throw new Error("OAuth cookie keys must be unique");
    }
    unique.add(value);
  }
  return [...unique];
}
