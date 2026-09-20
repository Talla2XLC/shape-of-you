import { describe, expect, it } from "vitest";

import {
  CONNECTED_RECOVERY_FRESHNESS_MAX_AGE_MS,
  evaluateConnectedRecoveryFreshness
} from "../src/domain/connected-recovery-freshness.js";
import type { ConnectedRecoveryDeliveryEvidence } from "../src/integrations/integration-store.js";

const now = new Date("2026-09-18T08:30:00.000Z");

function evidence(
  patch: Partial<ConnectedRecoveryDeliveryEvidence> = {}
): ConnectedRecoveryDeliveryEvidence {
  return {
    recoveryConnectionId: "00000000-0000-4000-8000-000000000019",
    lifecycle: "active",
    importEnabled: true,
    failureCode: null,
    lastAttemptAt: new Date("2026-09-18T08:29:00.000Z"),
    lastSuccessfulSyncAt: new Date("2026-09-18T08:29:00.000Z"),
    targetDateRecordReceived: true,
    targetDateSupportedFactsPresent: false,
    metricDelivery: [],
    ...patch
  };
}

describe("connected Recovery freshness", () => {
  it("distinguishes unavailable, disconnected and never-checked integrations", () => {
    expect(evaluateConnectedRecoveryFreshness(null, now, false)).toEqual({
      syncState: "unavailable",
      targetDateDelivery: "unknown",
      checkedAt: null
    });
    expect(evaluateConnectedRecoveryFreshness(null, now)).toEqual({
      syncState: "not_connected",
      targetDateDelivery: "unknown",
      checkedAt: null
    });
    expect(evaluateConnectedRecoveryFreshness(evidence({ lastAttemptAt: null, lastSuccessfulSyncAt: null }), now))
      .toMatchObject({ syncState: "never_checked" });
  });

  it("classifies the exact freshness boundary and excessive future skew", () => {
    expect(evaluateConnectedRecoveryFreshness(evidence({
      lastSuccessfulSyncAt: new Date(now.valueOf() - CONNECTED_RECOVERY_FRESHNESS_MAX_AGE_MS)
    }), now).syncState).toBe("fresh_success");
    expect(evaluateConnectedRecoveryFreshness(evidence({
      lastSuccessfulSyncAt: new Date(now.valueOf() - CONNECTED_RECOVERY_FRESHNESS_MAX_AGE_MS - 1)
    }), now).syncState).toBe("stale_success");
    expect(evaluateConnectedRecoveryFreshness(evidence({
      lastSuccessfulSyncAt: new Date(now.valueOf() + 5 * 60_000)
    }), now).syncState).toBe("fresh_success");
    expect(evaluateConnectedRecoveryFreshness(evidence({
      lastSuccessfulSyncAt: new Date(now.valueOf() + 5 * 60_000 + 1)
    }), now).syncState).toBe("stale_success");
  });

  it("keeps failure and target-date delivery as independent axes", () => {
    expect(evaluateConnectedRecoveryFreshness(evidence({
      lifecycle: "degraded",
      failureCode: "provider_timeout",
      targetDateRecordReceived: false
    }), now)).toMatchObject({ syncState: "failed", targetDateDelivery: "unknown" });
    expect(evaluateConnectedRecoveryFreshness(evidence({
      targetDateSupportedFactsPresent: true
    }), now)).toMatchObject({
      syncState: "fresh_success",
      targetDateDelivery: "supported_facts_present"
    });
    expect(evaluateConnectedRecoveryFreshness(evidence(), now)).toMatchObject({
      syncState: "fresh_success",
      targetDateDelivery: "record_without_supported_facts"
    });
    expect(evaluateConnectedRecoveryFreshness(evidence({
      targetDateRecordReceived: false
    }), now)).toMatchObject({
      syncState: "fresh_success",
      targetDateDelivery: "unknown"
    });
  });
});
