import type { OAuthClientReconcileStatus } from "../oauth/client-store.js";

/** Formats a credential-free reconciliation result for deployment logs. */
export function formatOAuthClientReconcileResult(
  clientId: string,
  status: OAuthClientReconcileStatus
): string {
  return `OAuth client ${clientId}: ${status}.`;
}
