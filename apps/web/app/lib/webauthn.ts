import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration
} from "@simplewebauthn/browser";

import type { IdentityApi } from "./identity-api";

/**
 * Bounded browser passkey failure used by the presentation layer.
 *
 * @remarks Raw DOM and SimpleWebAuthn errors are deliberately collapsed so credential
 * and protocol details cannot reach rendered messages or telemetry.
 */
export class BrowserPasskeyError extends Error {
  /**
   * Creates a safe passkey failure category.
   *
   * @param kind - User-actionable category without browser protocol details.
   */
  public constructor(public readonly kind: "unsupported" | "cancelled" | "failed") {
    super("Passkey ceremony did not complete");
    this.name = "BrowserPasskeyError";
  }
}

function mapBrowserError(error: unknown): BrowserPasskeyError {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String(error.name)
      : "";
  if (name === "NotAllowedError") {
    return new BrowserPasskeyError("cancelled");
  }
  return new BrowserPasskeyError("failed");
}

function requirePasskeySupport(): void {
  if (!globalThis.isSecureContext || !browserSupportsWebAuthn()) {
    throw new BrowserPasskeyError("unsupported");
  }
}

/**
 * Completes passkey registration using enrollment bearer or active-session authority.
 *
 * @param api - Same-origin Identity client that owns challenge issuance and verification.
 * @param input - Explicit bearer or CSRF authority plus an optional user label.
 * @returns A promise that resolves only after Identity verifies the registration.
 * @throws {BrowserPasskeyError} When WebAuthn is unsupported, cancelled, or fails.
 * @throws {IdentityApiError} When Identity rejects challenge issuance or verification.
 */
export async function registerPasskey(
  api: IdentityApi,
  input: { readonly bearer?: string; readonly csrf?: string; readonly label?: string }
): Promise<void> {
  requirePasskeySupport();
  const ceremony = await api.registrationOptions(input);
  try {
    const response = await startRegistration({ optionsJSON: ceremony.options });
    await api.verifyRegistration({
      ...input,
      challengeId: ceremony.challengeId,
      response
    });
  } catch (error) {
    if (error instanceof Error && error.name === "IdentityApiError") throw error;
    throw mapBrowserError(error);
  }
}

/**
 * Completes discoverable-passkey authentication and establishes Identity cookies.
 *
 * @param api - Same-origin Identity client that owns challenge issuance and verification.
 * @returns A promise that resolves after Identity establishes the browser session.
 * @throws {BrowserPasskeyError} When WebAuthn is unsupported, cancelled, or fails.
 * @throws {IdentityApiError} When Identity rejects challenge issuance or verification.
 */
export async function authenticateWithPasskey(api: IdentityApi): Promise<void> {
  requirePasskeySupport();
  const ceremony = await api.authenticationOptions();
  try {
    const response = await startAuthentication({ optionsJSON: ceremony.options });
    await api.verifyAuthentication(ceremony.challengeId, response);
  } catch (error) {
    if (error instanceof Error && error.name === "IdentityApiError") throw error;
    throw mapBrowserError(error);
  }
}
