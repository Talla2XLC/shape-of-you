import type { GarminIntervalsConnection } from "@shape-of-you/contracts";

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
}

/** Persisted current pointer for an imported Recovery fact. */
export interface RecoveryFactPointer {
  readonly checksum: string;
  readonly observationId: string;
}

/** Stable ids reused on reauthorization so imported fact history is preserved. */
export interface IntegrationConnectionIdentity {
  readonly id: string;
  readonly recoveryConnectionId: string;
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
  findActive(personId: string): Promise<ActiveIntegrationConnection | null>;
  findForErasure(personId: string, recoveryConnectionId: string): Promise<ActiveIntegrationConnection | null>;
  claimDue(workerId: string, leaseMs: number): Promise<ActiveIntegrationConnection | null>;
  claimRemoteDisconnectDue(workerId: string, leaseMs: number): Promise<ActiveIntegrationConnection | null>;
  releaseClaim(id: string): Promise<void>;
  beginDisconnect(personId: string, reason: string): Promise<ActiveIntegrationConnection | null>;
  completeRemoteDisconnect(id: string): Promise<void>;
  failRemoteDisconnect(id: string, failureCode: IntegrationFailureCode): Promise<void>;
  markSyncSucceeded(id: string, hasData: boolean): Promise<void>;
  markSyncFailed(id: string, failureCode: IntegrationFailureCode): Promise<void>;
  recordInbox(id: string, kind: "wellness" | "activity", identity: string, checksum: string): Promise<boolean>;
  completeInbox(id: string, kind: "wellness" | "activity", identity: string, checksum: string): Promise<void>;
  recoveryFact(id: string, identity: string, factKey: string): Promise<RecoveryFactPointer | null>;
  linkRecoveryFact(id: string, identity: string, factKey: string, checksum: string, observationId: string): Promise<void>;
}
