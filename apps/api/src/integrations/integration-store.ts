import type {
  ConnectedRecoveryMetricDeliveryState,
  ConnectedRecoveryMetricKey,
  GarminIntervalsConnection
} from "@shape-of-you/contracts";

import type { EncryptedCredential } from "./credential-cipher.js";
import type { IntegrationFailureCode } from "./provider.js";

/** Consumed one-use OAuth transaction bound to an authorized Person. */
export interface ConsumedAuthorizationTransaction {
  readonly personId: string;
  readonly returnTo: string;
  readonly createdAt: Date;
}

/** Internal active connection material; never returned through HTTP. */
export interface ActiveIntegrationConnection {
  readonly id: string;
  readonly personId: string;
  readonly recoveryConnectionId: string;
  readonly consentId: string;
  readonly credential: EncryptedCredential;
  readonly historicalImportStatus: "not_requested" | "running" | "completed" | "failed";
  readonly historicalCursorBefore: string | null;
  readonly historicalNextAttemptAt: Date | null;
}

/** Persisted current pointer for an imported Recovery fact. */
export interface RecoveryFactPointer {
  readonly checksum: string;
  readonly observationId: string;
  readonly confirmedConsentId: string | null;
  readonly confirmedDeliveryId: string | null;
}

export const CONNECTED_RECOVERY_METRIC_KEYS = [
  "sleep",
  "sleep_score",
  "resting_heart_rate",
  "night_heart_rate",
  "hrv_rmssd",
  "oxygen_saturation",
  "respiration_rate",
  "body_battery_min",
  "body_battery_max",
  "steps"
] as const satisfies readonly ConnectedRecoveryMetricKey[];

export type IntegrationInboxOutcome =
  | { readonly state: "process"; readonly receiptId: string }
  | { readonly state: "unchanged" }
  | { readonly state: "stale_generation" };

/** Safe delivery metadata used by provider-neutral Recovery composition. */
export interface ConnectedRecoveryDeliveryEvidence {
  readonly recoveryConnectionId: string;
  readonly lifecycle: "connecting" | "active" | "degraded" | "disconnected";
  readonly importEnabled: boolean;
  readonly failureCode: IntegrationFailureCode | null;
  readonly lastAttemptAt: Date | null;
  readonly lastSuccessfulSyncAt: Date | null;
  readonly targetDateRecordReceived: boolean;
  readonly targetDateSupportedFactsPresent: boolean;
  readonly metricDelivery: readonly {
    readonly metric: ConnectedRecoveryMetricKey;
    readonly state: ConnectedRecoveryMetricDeliveryState;
    readonly observationId: string | null;
  }[];
}

/** Stable ids reused on reauthorization so imported fact history is preserved. */
export interface IntegrationConnectionIdentity {
  readonly id: string;
  readonly recoveryConnectionId: string;
}

/** Fenced right to issue one historical provider request for the current cursor. */
export interface HistoricalImportClaim {
  readonly claimToken: string;
  readonly cursorBefore: string | null;
}

/** Durable provider integration persistence boundary. */
export interface IntegrationStore {
  createAuthorization(personId: string, stateHash: string, returnTo: string, expiresAt: Date): Promise<void>;
  consumeAuthorization(stateHash: string, now: Date): Promise<ConsumedAuthorizationTransaction | null>;
  authorizationIdentity(personId: string): Promise<IntegrationConnectionIdentity | null>;
  activate(input: {
    readonly id: string;
    readonly recoveryConnectionId: string;
    readonly consentId: string;
    readonly personId: string;
    readonly externalUserId: string;
    readonly credential: EncryptedCredential;
    readonly authorizationStartedAt: Date;
  }): Promise<void>;
  status(personId: string): Promise<GarminIntervalsConnection | null>;
  connectedRecoveryDelivery(personId: string, localDate: string): Promise<ConnectedRecoveryDeliveryEvidence | null>;
  findActive(personId: string): Promise<ActiveIntegrationConnection | null>;
  findForErasure(personId: string, recoveryConnectionId: string): Promise<ActiveIntegrationConnection | null>;
  claimDue(workerId: string, leaseMs: number): Promise<ActiveIntegrationConnection | null>;
  claimRemoteDisconnectDue(workerId: string, leaseMs: number): Promise<ActiveIntegrationConnection | null>;
  releaseClaim(id: string): Promise<void>;
  beginDisconnect(personId: string, reason: string): Promise<ActiveIntegrationConnection | null>;
  startHistoricalImport(personId: string): Promise<boolean>;
  claimHistoricalWindow(id: string, expectedConsentId: string, expectedCursorBefore: string | null, claimToken: string, leaseMs: number): Promise<HistoricalImportClaim | null>;
  markHistoricalWindowSucceeded(id: string, claimToken: string, processedThroughDate: string, completed: boolean): Promise<boolean>;
  markHistoricalImportFailed(id: string, claimToken: string, failureCode: IntegrationFailureCode, retryable: boolean): Promise<boolean>;
  completeRemoteDisconnect(id: string): Promise<void>;
  failRemoteDisconnect(id: string, failureCode: IntegrationFailureCode): Promise<void>;
  markSyncSucceeded(id: string, consentId: string, hasData: boolean): Promise<void>;
  markSyncFailed(id: string, consentId: string, failureCode: IntegrationFailureCode): Promise<void>;
  recordInbox(id: string, consentId: string, kind: "wellness" | "activity", identity: string, checksum: string): Promise<IntegrationInboxOutcome>;
  completeInbox(id: string, consentId: string, receiptId: string): Promise<boolean>;
  recoveryFact(id: string, identity: string, factKey: string): Promise<RecoveryFactPointer | null>;
  linkRecoveryFact(id: string, consentId: string, identity: string, receiptId: string, factKey: string, checksum: string, observationId: string): Promise<boolean>;
}
