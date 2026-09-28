import { decodeProtectedHeader } from "jose";

const keyIdPattern = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Rejects malformed or locally denied Identity JWT key identifiers.
 *
 * The protected header is untrusted until signature verification. This check
 * only rejects tokens; successful callers must still verify the full JWT.
 *
 * @param token - Compact Identity JWT to inspect.
 * @param deniedKids - Deployment-owned emergency deny policy.
 * @throws Error when the header has no valid kid or the kid is denied.
 */
export function assertAllowedIdentityTokenKid(
  token: string,
  deniedKids: ReadonlySet<string>
): void {
  const { kid } = decodeProtectedHeader(token);
  if (typeof kid !== "string" || !keyIdPattern.test(kid)) {
    throw new Error("Identity token key id is invalid");
  }
  if (deniedKids.has(kid)) {
    throw new Error("Identity token key id is denied");
  }
}
