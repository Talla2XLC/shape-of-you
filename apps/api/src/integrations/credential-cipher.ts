import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Authenticated encrypted token envelope persisted for one Person connection. */
export interface EncryptedCredential {
  readonly keyId: string;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly tag: string;
}

/** Runtime-only key ring for authenticated per-connection token encryption. */
export class ConnectionCredentialCipher {
  public constructor(
    private readonly activeKeyId: string,
    private readonly keys: ReadonlyMap<string, Buffer>
  ) {
    const key = keys.get(activeKeyId);
    if (!key || key.length !== 32) throw new Error("Active integration encryption key must contain 32 bytes");
  }

  /** Encrypts a token while binding it to provider, Person and connection. */
  public encrypt(token: string, associatedData: string): EncryptedCredential {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.keys.get(this.activeKeyId)!, nonce);
    cipher.setAAD(Buffer.from(associatedData, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return {
      keyId: this.activeKeyId,
      nonce: nonce.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url")
    };
  }

  /** Decrypts only when the persisted envelope and connection binding authenticate. */
  public decrypt(envelope: EncryptedCredential, associatedData: string): string {
    const key = this.keys.get(envelope.keyId);
    if (!key) throw new Error("Integration encryption key is unavailable");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64url"));
    decipher.setAAD(Buffer.from(associatedData, "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final()
    ]).toString("utf8");
  }
}

/** Parses a comma-separated key-id/base64 key ring without exposing key material. */
export function parseIntegrationKeyRing(value: string): ReadonlyMap<string, Buffer> {
  const result = new Map<string, Buffer>();
  for (const item of value.split(",")) {
    const separator = item.indexOf(":");
    if (separator <= 0) throw new Error("Integration encryption key ring is invalid");
    const keyId = item.slice(0, separator).trim();
    const key = Buffer.from(item.slice(separator + 1).trim(), "base64");
    if (!keyId || key.length !== 32 || result.has(keyId)) throw new Error("Integration encryption key ring is invalid");
    result.set(keyId, key);
  }
  return result;
}
