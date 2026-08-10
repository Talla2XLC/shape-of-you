import type { IdentityAccessProvisioningResult } from "../storage/identity-access-provisioning-repository.js";

/**
 * Formats the credential-free output of the Identity access provisioning command.
 *
 * @param result API-owned identifiers and creation status from provisioning.
 * @returns Stable output containing only status, User id, Person id, and role.
 */
export function formatIdentityAccessProvisioning(
  result: IdentityAccessProvisioningResult
): string {
  return `Identity access ${result.status}.\nUser: ${result.userId}\nPerson: ${result.personId}\nRole: owner\n`;
}
