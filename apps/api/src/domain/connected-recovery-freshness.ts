import type {
  ConnectedRecoverySyncState,
  ConnectedRecoveryTargetDateDelivery
} from "@shape-of-you/contracts";

import type { ConnectedRecoveryDeliveryEvidence } from "../integrations/integration-store.js";

export const CONNECTED_RECOVERY_FRESHNESS_POLICY_VERSION =
  "connected-recovery-freshness-v2" as const;
export const CONNECTED_RECOVERY_FRESHNESS_MAX_AGE_MS = 15 * 60_000;
const maximumFutureSkewMs = 5 * 60_000;

/** Deterministically classifies connected Recovery delivery without interpreting health values. */
export function evaluateConnectedRecoveryFreshness(
  evidence: ConnectedRecoveryDeliveryEvidence | null,
  now: Date,
  integrationAvailable = true
): {
  readonly syncState: ConnectedRecoverySyncState;
  readonly targetDateDelivery: ConnectedRecoveryTargetDateDelivery;
  readonly checkedAt: string | null;
} {
  if (!integrationAvailable) {
    return { syncState: "unavailable", targetDateDelivery: "unknown", checkedAt: null };
  }
  if (!evidence || !evidence.importEnabled || evidence.lifecycle === "disconnected") {
    return { syncState: "not_connected", targetDateDelivery: "unknown", checkedAt: evidence?.lastAttemptAt?.toISOString() ?? null };
  }
  let syncState: ConnectedRecoverySyncState;
  if (evidence.lastAttemptAt === null) {
    syncState = "never_checked";
  } else if (evidence.failureCode !== null || evidence.lifecycle === "degraded") {
    syncState = "failed";
  } else if (evidence.lastSuccessfulSyncAt === null) {
    syncState = "never_checked";
  } else {
    const age = now.valueOf() - evidence.lastSuccessfulSyncAt.valueOf();
    syncState = age >= -maximumFutureSkewMs && age <= CONNECTED_RECOVERY_FRESHNESS_MAX_AGE_MS
      ? "fresh_success"
      : "stale_success";
  }
  const targetDateDelivery = evidence.targetDateSupportedFactsPresent
    ? "supported_facts_present"
    : evidence.targetDateRecordReceived
      ? "record_without_supported_facts"
      : "unknown";
  return {
    syncState,
    targetDateDelivery,
    checkedAt: evidence.lastAttemptAt?.toISOString() ?? null
  };
}
