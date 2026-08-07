/** Matches the exact 256-bit base64url value accepted as enrollment or CSRF authority. */
export const enrollmentTokenPattern = /^[A-Za-z0-9_-]{43}$/;

/** Names the readable, host-only CSRF cookie owned by the Identity service. */
export const identityCsrfCookieName = "__Host-shape_of_you_csrf";

/**
 * Removes an enrollment fragment before returning its validated bearer value.
 *
 * @param input - Current browser URL parts and the history replacement callback.
 * @returns The valid bearer, or `null` when the fragment is absent or malformed.
 * @remarks The replacement callback is always invoked before the bearer is returned,
 * so callers cannot start an Identity request while the credential remains visible.
 */
export function consumeEnrollmentFragment(input: {
  readonly hash: string;
  readonly pathname: string;
  readonly search: string;
  readonly replaceUrl: (url: string) => void;
}): string | null {
  const value = input.hash.startsWith("#") ? input.hash.slice(1) : input.hash;
  input.replaceUrl(`${input.pathname}${input.search}`);
  return enrollmentTokenPattern.test(value) ? value : null;
}

/**
 * Reads one exact cookie value without decoding or returning unrelated cookies.
 *
 * @param cookieHeader - The browser-visible `document.cookie` string.
 * @param name - Exact cookie name to select.
 * @returns The non-empty raw value, or `null` when the cookie is absent or empty.
 */
export function readCookie(cookieHeader: string, name: string): string | null {
  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

/**
 * Returns the current session-bound Identity CSRF credential.
 *
 * @param cookieHeader - The browser-visible `document.cookie` string.
 * @returns A format-valid CSRF credential, or `null` when none is usable.
 * @remarks This helper never attempts to access the HttpOnly Identity session cookie.
 */
export function readIdentityCsrfCookie(cookieHeader: string): string | null {
  const value = readCookie(cookieHeader, identityCsrfCookieName);
  return value && enrollmentTokenPattern.test(value) ? value : null;
}

/**
 * Resolves an Identity-owned browser route on the configured exact origin.
 *
 * @param identityOrigin - Canonical Identity origin from public runtime config.
 * @param path - Identity-owned absolute path to resolve.
 * @returns An absolute URL on `identityOrigin`.
 * @throws {Error} When URL resolution would escape the configured Identity origin.
 */
export function identityRoute(identityOrigin: string, path: string): string {
  const target = new URL(path, identityOrigin);
  const origin = new URL(identityOrigin);
  if (target.origin !== origin.origin) {
    throw new Error("Identity route must stay on the configured origin");
  }
  return target.toString();
}

/**
 * Selects a hard-navigation target when an Identity page is opened on another origin.
 *
 * @param identityOrigin - Canonical Identity origin from public runtime config.
 * @param currentHref - Complete current browser URL, including any enrollment fragment.
 * @returns The same path, search, and fragment on Identity, or `null` when already there.
 * @remarks Preserving the fragment is required only for the immediate enrollment
 * navigation; fragments are never sent in the HTTP request.
 */
export function identityRedirectTarget(
  identityOrigin: string,
  currentHref: string
): string | null {
  const current = new URL(currentHref);
  const expected = new URL(identityOrigin);
  if (current.origin === expected.origin) return null;
  return new URL(`${current.pathname}${current.search}${current.hash}`, expected).toString();
}
