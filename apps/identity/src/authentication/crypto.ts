import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Creates a URL-safe opaque bearer value with 256 bits of entropy. */
export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Creates the fixed-width SHA-256 digest persisted for bearer values. */
export function hashBearerValue(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Compares a presented bearer value with a persisted digest in constant time. */
export function bearerValueMatches(value: string, expectedHash: Buffer): boolean {
  const actualHash = hashBearerValue(value);
  return actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash);
}
