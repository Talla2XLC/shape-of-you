import { and, desc, eq, sql } from "drizzle-orm";

import type { DatabaseTransaction } from "./source-reference-repository.js";
import { integrationActivityFacts, integrationConnections, integrationCutovers } from "../database/schema.js";
import type { IntegrationImportPolicy, IntegrationRecordAdmission } from "../integrations/integration-store.js";

/** Reads current authority using the database wall clock after the caller's Person evidence lock. */
export async function readIntegrationImportPolicy(transaction: DatabaseTransaction, connectionId: string, expectedConsentId?: string): Promise<IntegrationImportPolicy | null> {
  const connection = await transaction.query.integrationConnections.findFirst({ where: eq(integrationConnections.id, connectionId) });
  if (!connection) return null;
  const cutover = await transaction.query.integrationCutovers.findFirst({
    where: and(eq(integrationCutovers.personId, connection.personId), sql`(${integrationCutovers.state} IN ('scheduled','draining','active') OR ${integrationCutovers.restoreSuppressed} = true)`),
    orderBy: [desc(integrationCutovers.createdAt), desc(integrationCutovers.id)]
  });
  if (!cutover) return null;
  const clock = await transaction.execute(sql<{ instant: Date }>`select clock_timestamp() as instant`);
  const now = new Date(clock.rows[0]!.instant as Date);
  const role = connection.providerKey === cutover.sourceProvider ? "source" : "target";
  const correctProvider = role === "source" ? connection.providerKey === cutover.sourceProvider : connection.providerKey === cutover.targetProvider;
  const correctConnection = connection.id === (role === "source" ? cutover.sourceConnectionId : cutover.targetConnectionId);
  const correctGeneration = connection.consentId === (role === "source" ? cutover.sourceConsentId : cutover.targetConsentId)
    && (expectedConsentId === undefined || connection.consentId === expectedConsentId);
  const requestAllowed = !cutover.restoreSuppressed && correctProvider && correctConnection && correctGeneration && (role === "source"
    ? cutover.state !== "active" && now < cutover.sourceDrainsUntil
    : cutover.state !== "scheduled" && now >= cutover.startsAt);
  return { role, state: cutover.state, startsOn: cutover.startsOn, timezone: cutover.timezone, startsAt: cutover.startsAt,
    sourceDrainsUntil: cutover.sourceDrainsUntil, version: cutover.version, requestAllowed,
    historyScopeFromDate: role === "target" ? cutover.startsOn : "2000-01-01" };
}

/** Applies date labels for wellness and parent UTC start for activity; null policy preserves ordinary imports. */
export function integrationRecordAllowed(policy: IntegrationImportPolicy | null, kind: "wellness" | "activity", admission: IntegrationRecordAdmission | undefined): boolean {
  if (!policy) return true;
  if (!policy.requestAllowed || !admission) return false;
  if (kind === "wellness") return policy.role === "source" ? admission.localDate < policy.startsOn : admission.localDate >= policy.startsOn;
  if (!admission.occurredAt) return false;
  const instant = new Date(admission.occurredAt).valueOf();
  if (!Number.isFinite(instant)) return false;
  return policy.role === "source" ? instant < policy.startsAt.valueOf() : instant >= policy.startsAt.valueOf();
}

/** Last-mile activity guard. Parent ownership governs its FIT/details and derived Recovery, regardless of finish time. */
export async function integrationParentRecordAllowed(transaction: DatabaseTransaction, connectionId: string, consentId: string, providerIdentity: string): Promise<boolean> {
  const policy = await readIntegrationImportPolicy(transaction, connectionId, consentId);
  if (!policy) return true;
  const parent = await transaction.query.integrationActivityFacts.findFirst({
    where: and(eq(integrationActivityFacts.connectionId, connectionId), eq(integrationActivityFacts.providerIdentity, providerIdentity)),
    orderBy: [desc(integrationActivityFacts.createdAt), desc(integrationActivityFacts.id)]
  });
  return parent !== undefined && integrationRecordAllowed(policy, "activity", { localDate: parent.localDate, occurredAt: parent.occurredAt.toISOString() });
}

/** Guards an account-derived Recovery write; the caller already holds the Person evidence lock. */
export async function integrationRecoveryRecordAllowed(transaction: DatabaseTransaction, personId: string, recoveryConnectionId: string, consentId: string, source: { readonly localDate: string | null; readonly observedAt?: string | null; readonly externalRecordId: string | null; readonly externalSystem: string | null }): Promise<boolean> {
  const connection = await transaction.query.integrationConnections.findFirst({ where: and(eq(integrationConnections.personId, personId), eq(integrationConnections.recoveryConnectionId, recoveryConnectionId)) });
  if (!connection) return true;
  const policy = await readIntegrationImportPolicy(transaction, connection.id, consentId);
  if (!policy) return true;
  if (source.externalSystem?.includes("activity_fit")) {
    const match = source.externalRecordId?.match(/^(.*):140\.9:[0-9a-f]{64}$/);
    if (!match?.[1]) return false;
    return integrationParentRecordAllowed(transaction, connection.id, consentId, match[1]);
  }
  const localDate = source.observedAt && policy ? new Intl.DateTimeFormat("en-CA", { timeZone: policy.timezone, year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(source.observedAt)) : source.localDate;
  return localDate !== null && integrationRecordAllowed(policy, "wellness", { localDate });
}

/** Quarantines pending activation and clears only connection audit references, preserving effective bounds after erasure. */
export async function quarantineCutoverForErasure(transaction: DatabaseTransaction, personId: string, recoveryConnectionId: string): Promise<void> {
  const rows = await transaction.query.integrationCutovers.findMany({ where: and(eq(integrationCutovers.personId, personId), sql`(${integrationCutovers.sourceRecoveryConnectionId} = ${recoveryConnectionId} OR ${integrationCutovers.targetRecoveryConnectionId} = ${recoveryConnectionId})`) });
  for (const row of rows) {
    const source = row.sourceRecoveryConnectionId === recoveryConnectionId;
    const target = row.targetRecoveryConnectionId === recoveryConnectionId;
    if (!row.activatedAt && ["scheduled", "failed"].includes(row.state)) {
      if (row.targetConnectionId) await transaction.execute(sql`update integration_connections set import_enabled=false,lifecycle='disconnected',disconnected_at=clock_timestamp(),credential_key_id=null,credential_nonce=null,credential_ciphertext=null,credential_tag=null,remote_disconnect_pending=false,lease_owner=null,lease_until=null,updated_at=clock_timestamp() where id=${row.targetConnectionId} and person_id=${personId}`);
      if (row.targetConsentId) await transaction.execute(sql`update recovery_consents set status='revoked',revoked_at=clock_timestamp(),revocation_reason='Cutover connection erasure requested' where id=${row.targetConsentId} and person_id=${personId}`);
      if (row.targetRecoveryConnectionId) await transaction.execute(sql`update recovery_connections set status='disconnected',disconnected_at=clock_timestamp() where id=${row.targetRecoveryConnectionId} and person_id=${personId}`);
    }
    await transaction.update(integrationCutovers).set({
      ...(source ? { sourceConnectionId: null, sourceRecoveryConnectionId: null, sourceConsentId: null } : {}),
      ...(target ? { targetConnectionId: null, targetRecoveryConnectionId: null, targetConsentId: null } : {}),
      ...(!row.activatedAt && ["scheduled", "failed"].includes(row.state) ? { state: "cancelled" as const, cancelledAt: sql`clock_timestamp()`, failureCode: "erasure_pending" } : {}),
      actorPersonId: null, version: row.version + 1, updatedAt: sql`clock_timestamp()`
    }).where(eq(integrationCutovers.id, row.id));
  }
}
