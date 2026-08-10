import type { IdentityAccountSubject } from "../authentication/account-subject-store.js";

/**
 * Formats the credential-free output of the account subject lookup command.
 *
 * @param result Public Identity account reference returned by the store.
 * @returns Stable output containing only the account id, subject, and status.
 */
export function formatIdentityAccountSubject(result: IdentityAccountSubject): string {
  return `Identity account subject resolved.\nAccount: ${result.accountId}\nSubject: ${result.subject}\n`;
}
