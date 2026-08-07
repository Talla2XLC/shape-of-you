import { IdentityApiError } from "./identity-api";
import { BrowserPasskeyError } from "./webauthn";

/**
 * Maps browser and Identity failures to an allowlisted user-safe message.
 *
 * @param error - Unknown failure caught at the presentation boundary.
 * @returns A bounded English message that contains no backend or credential details.
 */
export function userMessage(error: unknown): string {
  if (error instanceof BrowserPasskeyError) {
    if (error.kind === "unsupported") {
      return "Passkeys are unavailable here. Use a current browser in a secure context.";
    }
    if (error.kind === "cancelled") {
      return "The passkey prompt was closed. Nothing was changed.";
    }
    return "The passkey ceremony could not be completed. Please try again.";
  }
  if (error instanceof IdentityApiError) {
    if (error.status === 401 || error.status === 403) {
      return "Your authorization is missing or has expired.";
    }
    if (error.code === "last_authentication_method") {
      return "Add another passkey before removing your last sign-in method.";
    }
    if (error.code === "passkey_label_conflict") {
      return "That passkey name is already in use.";
    }
    return "Identity could not accept this request. Check the link or try again.";
  }
  return "Something went wrong. No credential details were saved.";
}
