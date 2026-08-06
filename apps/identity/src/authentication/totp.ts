import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

const periodSeconds = 30;
const digits = 6;

/** Versioned encryption keys used for TOTP seed envelope encryption. */
export interface TotpKeyRing {
  readonly activeKeyId: string;
  readonly keys: ReadonlyMap<string, Buffer>;
}

/** Persistable encrypted TOTP seed material. */
export interface EncryptedTotpSecret {
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly tag: Buffer;
  readonly keyId: string;
}

/** Parses and validates the external TOTP encryption key ring. */
export function parseTotpKeyRing(activeKeyId: string, serializedKeys: string): TotpKeyRing {
  let input: unknown;
  try {
    input = JSON.parse(serializedKeys) as unknown;
  } catch {
    throw new Error("TOTP encryption keys must be a JSON object");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("TOTP encryption keys must be a JSON object");
  }
  const keys = new Map<string, Buffer>();
  for (const [keyId, value] of Object.entries(input)) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId) || typeof value !== "string") {
      throw new Error("TOTP encryption key entry is invalid");
    }
    const decoded = Buffer.from(value, "base64url");
    if (decoded.length !== 32 || decoded.toString("base64url") !== value) {
      throw new Error("TOTP encryption keys must be 32-byte base64url values");
    }
    keys.set(keyId, decoded);
  }
  if (!keys.has(activeKeyId)) {
    throw new Error("Active TOTP encryption key id is missing from the key ring");
  }
  return { activeKeyId, keys };
}

/** Encrypts a TOTP seed with the active AES-256-GCM key. */
export function encryptTotpSecret(secret: Buffer, keyRing: TotpKeyRing): EncryptedTotpSecret {
  const key = keyRing.keys.get(keyRing.activeKeyId);
  if (!key) throw new Error("Active TOTP encryption key is unavailable");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return { ciphertext, nonce, tag: cipher.getAuthTag(), keyId: keyRing.activeKeyId };
}

/** Decrypts a persisted TOTP seed or fails closed for an unknown/wrong key. */
export function decryptTotpSecret(
  encrypted: EncryptedTotpSecret,
  keyRing: TotpKeyRing
): Buffer {
  const key = keyRing.keys.get(encrypted.keyId);
  if (!key) throw new Error("TOTP encryption key is unavailable");
  const decipher = createDecipheriv("aes-256-gcm", key, encrypted.nonce);
  decipher.setAuthTag(encrypted.tag);
  return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
}

/** Encodes secret bytes for an RFC-compatible authenticator setup URI. */
export function encodeBase32(value: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let buffer = 0;
  let result = "";
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += alphabet[(buffer << (5 - bits)) & 31];
  return result;
}

/** Generates a six-digit TOTP value for a time step. */
export function createTotpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Verifies an RFC 6238 code and returns its accepted step for replay storage. */
export function verifyTotpCode(
  secret: Buffer,
  code: string,
  now: Date,
  lastAcceptedStep: number | null
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const currentStep = Math.floor(now.getTime() / 1_000 / periodSeconds);
  const candidate = Buffer.from(code, "ascii");
  for (const step of [currentStep, currentStep - 1, currentStep + 1]) {
    const expected = Buffer.from(createTotpCode(secret, step), "ascii");
    if (timingSafeEqual(candidate, expected) && (lastAcceptedStep === null || step > lastAcceptedStep)) {
      return step;
    }
  }
  return null;
}
