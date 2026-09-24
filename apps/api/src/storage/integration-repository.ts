import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { GarminIntervalsConnection } from "@shape-of-you/contracts";

import type { DatabaseContext } from "../database/context.js";
import {
  integrationAuthorizationTransactions,
  integrationConnections,
  integrationInbox,
  integrationRecoveryFacts,
  persons,
  recoveryConnections,
  recoveryConsentKinds,
  recoveryConsents,
  recoveryErasureRequests,
  recoveryProviders
} from "../database/schema.js";
import type {
  ActiveIntegrationConnection,
  ConsumedAuthorizationTransaction,
  HistoricalImportClaim,
  IntegrationConnectionIdentity,
  IntegrationStore,
  RecoveryFactPointer,
  ConnectedRecoveryDeliveryEvidence,
  IntegrationInboxOutcome
} from "../integrations/integration-store.js";
import { CONNECTED_RECOVERY_METRIC_KEYS } from "../integrations/integration-store.js";
import type { IntegrationFailureCode } from "../integrations/provider.js";
import { ConflictError } from "../domain/errors.js";
import { lockPersonEvidenceMutation } from "./source-reference-repository.js";

const providerKey = "intervals_icu";

/** PostgreSQL implementation of the in-process provider integration boundary. */
export class IntegrationRepository implements IntegrationStore {
  public constructor(private readonly database: DatabaseContext) {}

  public async createAuthorization(personId: string, stateHash: string, returnTo: string, expiresAt: Date): Promise<void> {
    await this.database.db.insert(integrationAuthorizationTransactions).values({
      personId, providerKey, stateHash, returnTo, expiresAt
    });
  }

  public async consumeAuthorization(stateHash: string, now: Date): Promise<ConsumedAuthorizationTransaction | null> {
    const rows = await this.database.db.update(integrationAuthorizationTransactions)
      .set({ consumedAt: now })
      .where(and(
        eq(integrationAuthorizationTransactions.providerKey, providerKey),
        eq(integrationAuthorizationTransactions.stateHash, stateHash),
        isNull(integrationAuthorizationTransactions.consumedAt),
        gte(integrationAuthorizationTransactions.expiresAt, now)
      ))
      .returning();
    return rows[0] ? { personId: rows[0].personId, returnTo: rows[0].returnTo, createdAt: rows[0].createdAt } : null;
  }

  public async authorizationIdentity(personId: string): Promise<IntegrationConnectionIdentity | null> {
    const rows = await this.database.db.select({ integration: integrationConnections, recovery: recoveryConnections })
      .from(integrationConnections)
      .innerJoin(recoveryConnections, eq(integrationConnections.recoveryConnectionId, recoveryConnections.id))
      .where(and(eq(integrationConnections.personId, personId), eq(integrationConnections.providerKey, providerKey)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.recovery.erasureRequestedAt) throw new Error("Connection erasure must complete before reauthorization");
    return { id: row.integration.id, recoveryConnectionId: row.integration.recoveryConnectionId };
  }

  public async activate(input: {
    readonly id: string; readonly recoveryConnectionId: string; readonly consentId: string;
    readonly personId: string; readonly externalUserId: string; readonly credential: { readonly keyId: string; readonly nonce: string; readonly ciphertext: string; readonly tag: string };
    readonly authorizationStartedAt: Date;
  }): Promise<void> {
    await this.database.db.transaction(async (transaction) => {
      await lockPersonEvidenceMutation(transaction, input.personId);
      const providers = await transaction.insert(recoveryProviders)
        .values({ key: providerKey, name: "Intervals.icu" })
        .onConflictDoNothing().returning();
      const provider = providers[0] ?? await transaction.query.recoveryProviders.findFirst({ where: eq(recoveryProviders.key, providerKey) });
      if (!provider) throw new Error("Intervals.icu provider could not be resolved");

      const previous = await transaction.query.integrationConnections.findFirst({
        where: and(eq(integrationConnections.personId, input.personId), eq(integrationConnections.providerKey, providerKey))
      });
      if (previous && previous.id !== input.id) throw new ConflictError("Concurrent authorization changed the connection identity");
      if (previous) {
        const recovery = await transaction.query.recoveryConnections.findFirst({ where: and(eq(recoveryConnections.id, previous.recoveryConnectionId), eq(recoveryConnections.personId, input.personId)) });
        const erasure = await transaction.query.recoveryErasureRequests.findFirst({ where: and(eq(recoveryErasureRequests.connectionId, previous.recoveryConnectionId), eq(recoveryErasureRequests.personId, input.personId)) });
        if (!recovery || recovery.erasureRequestedAt || erasure) throw new ConflictError("Connection erasure must complete before reauthorization");
        if (previous.disconnectedAt && previous.disconnectedAt >= input.authorizationStartedAt) throw new ConflictError("Authorization was superseded by disconnect");
      }
      if (previous) {
        if (previous.consentId !== input.consentId) {
          await transaction.update(recoveryConsents).set({
            status: "revoked",
            revokedAt: new Date(),
            revocationReason: "OAuth consent replaced"
          }).where(and(
            eq(recoveryConsents.id, previous.consentId),
            eq(recoveryConsents.status, "active")
          ));
        }
        await transaction.update(recoveryConnections).set({
          status: "active", disconnectedAt: null
        }).where(eq(recoveryConnections.id, previous.recoveryConnectionId));
      } else {
        await transaction.insert(recoveryConnections).values({
          id: input.recoveryConnectionId,
          personId: input.personId,
          providerId: provider.id,
          dedupeKey: `${providerKey}:${input.externalUserId}`
        });
      }
      await transaction.insert(recoveryConsents).values({
        id: input.consentId,
        personId: input.personId,
        connectionId: input.recoveryConnectionId,
        purpose: "Import Recovery wellness from Intervals.icu",
        retentionMode: "indefinite"
      });
      await transaction.insert(recoveryConsentKinds).values([
        { consentId: input.consentId, kind: "sleep" },
        { consentId: input.consentId, kind: "metric" }
      ]);
      const values = {
        consentId: input.consentId, externalUserId: input.externalUserId,
        lifecycle: "active" as const, importEnabled: true,
        credentialKeyId: input.credential.keyId, credentialNonce: input.credential.nonce,
        credentialCiphertext: input.credential.ciphertext, credentialTag: input.credential.tag,
        failureCode: null, lastAttemptAt: null, lastSuccessfulSyncAt: null, lastDataAt: null,
        disconnectedAt: null, remoteDisconnectPending: false, nextAttemptAt: new Date(), updatedAt: new Date()
      };
      if (previous) {
        await transaction.update(integrationConnections).set(values).where(eq(integrationConnections.id, previous.id));
      } else {
        await transaction.insert(integrationConnections).values({
          id: input.id, personId: input.personId, recoveryConnectionId: input.recoveryConnectionId,
          providerKey, ...values
        });
      }
    });
  }

  public async status(personId: string): Promise<GarminIntervalsConnection | null> {
    const row = await this.database.db.query.integrationConnections.findFirst({
      where: and(eq(integrationConnections.personId, personId), eq(integrationConnections.providerKey, providerKey))
    });
    if (!row) {
      const pending = await this.database.db.query.integrationAuthorizationTransactions.findFirst({
        where: and(
          eq(integrationAuthorizationTransactions.personId, personId),
          eq(integrationAuthorizationTransactions.providerKey, providerKey),
          isNull(integrationAuthorizationTransactions.consumedAt),
          gte(integrationAuthorizationTransactions.expiresAt, new Date())
        )
      });
      return pending ? {
        provider: "intervals_icu", displayName: "Garmin via Intervals.icu", recoveryConnectionId: null,
        lifecycle: "connecting", failureCode: null, lastAttemptAt: null, lastSuccessfulSyncAt: null,
        lastDataAt: null, connectedAt: null, disconnectedAt: null,
        historicalImport: emptyHistoricalImport()
      } : null;
    }
    return {
      provider: "intervals_icu",
      displayName: "Garmin via Intervals.icu",
      recoveryConnectionId: row.recoveryConnectionId,
      lifecycle: row.lifecycle,
      failureCode: row.failureCode,
      lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
      lastSuccessfulSyncAt: row.lastSuccessfulSyncAt?.toISOString() ?? null,
      lastDataAt: row.lastDataAt?.toISOString() ?? null,
      connectedAt: row.connectedAt.toISOString(),
      disconnectedAt: row.disconnectedAt?.toISOString() ?? null,
      historicalImport: {
        status: row.historicalImportStatus,
        processedThroughDate: row.historicalCursorBefore,
        requestedAt: row.historicalRequestedAt?.toISOString() ?? null,
        lastAttemptAt: row.historicalLastAttemptAt?.toISOString() ?? null,
        completedAt: row.historicalCompletedAt?.toISOString() ?? null,
        failureCode: row.historicalFailureCode
      }
    };
  }

  /** Reads only safe sync and target-date delivery metadata for Recovery composition. */
  public async connectedRecoveryDelivery(
    personId: string,
    localDate: string
  ): Promise<ConnectedRecoveryDeliveryEvidence | null> {
    const connection = await this.database.db.query.integrationConnections.findFirst({
      where: and(
        eq(integrationConnections.personId, personId),
        eq(integrationConnections.providerKey, providerKey)
      )
    });
    if (!connection) return null;
    const [records, facts] = await Promise.all([
      this.database.db.query.integrationInbox.findMany({
        where: and(
          eq(integrationInbox.connectionId, connection.id),
          eq(integrationInbox.consentId, connection.consentId),
          eq(integrationInbox.kind, "wellness"),
          eq(integrationInbox.providerIdentity, localDate),
          eq(integrationInbox.status, "normalized")
        )
      }),
      this.database.db.query.integrationRecoveryFacts.findMany({
        where: and(
          eq(integrationRecoveryFacts.connectionId, connection.id),
          eq(integrationRecoveryFacts.providerIdentity, localDate)
        )
      })
    ]);
    const normalizedDeliveryIds = new Set(records.map((record) => record.id));
    const pointers = new Map(facts.map((fact) => [fact.factKey, fact]));
    const metricDelivery = CONNECTED_RECOVERY_METRIC_KEYS.map((metric) => {
      const pointer = pointers.get(metric);
      if (
        pointer?.confirmedConsentId === connection.consentId
        && pointer.confirmedDeliveryId !== null
        && normalizedDeliveryIds.has(pointer.confirmedDeliveryId)
      ) {
        return {
          metric,
          state: pointer.normalizedChecksum === "removed"
            ? "confirmed_absent" as const
            : "confirmed_present" as const,
          observationId: pointer.normalizedChecksum === "removed" ? null : pointer.observationId
        };
      }
      if (pointer && pointer.normalizedChecksum !== "removed") {
        return { metric, state: "retained_unconfirmed" as const, observationId: pointer.observationId };
      }
      if (pointer) {
        return { metric, state: "unknown" as const, observationId: null };
      }
      return {
        metric,
        state: records.length > 0 ? "confirmed_absent" as const : "unknown" as const,
        observationId: null
      };
    });
    return {
      recoveryConnectionId: connection.recoveryConnectionId,
      lifecycle: connection.lifecycle,
      importEnabled: connection.importEnabled,
      failureCode: connection.failureCode,
      lastAttemptAt: connection.lastAttemptAt,
      lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
      targetDateRecordReceived: records.length > 0,
      targetDateSupportedFactsPresent: metricDelivery.some((item) => item.state === "confirmed_present"),
      metricDelivery
    };
  }

  public async findActive(personId: string): Promise<ActiveIntegrationConnection | null> {
    const row = await this.database.db.query.integrationConnections.findFirst({
      where: and(eq(integrationConnections.personId, personId), eq(integrationConnections.importEnabled, true))
    });
    if (!row?.credentialKeyId || !row.credentialNonce || !row.credentialCiphertext || !row.credentialTag) return null;
    return {
      id: row.id, personId: row.personId, recoveryConnectionId: row.recoveryConnectionId, consentId: row.consentId,
      credential: { keyId: row.credentialKeyId, nonce: row.credentialNonce, ciphertext: row.credentialCiphertext, tag: row.credentialTag },
      historicalImportStatus: row.historicalImportStatus,
      historicalCursorBefore: row.historicalCursorBefore,
      historicalNextAttemptAt: row.historicalNextAttemptAt
    };
  }

  public async personTimezone(personId: string): Promise<string | null> {
    const row = await this.database.db.query.persons.findFirst({ where: eq(persons.id, personId) });
    return row?.timezone ?? null;
  }

  public async findForErasure(personId: string, recoveryConnectionId: string): Promise<ActiveIntegrationConnection | null> {
    const row = await this.database.db.query.integrationConnections.findFirst({
      where: and(eq(integrationConnections.personId, personId), eq(integrationConnections.recoveryConnectionId, recoveryConnectionId))
    });
    if (!row?.credentialKeyId || !row.credentialNonce || !row.credentialCiphertext || !row.credentialTag) return null;
    return {
      id: row.id, personId: row.personId, recoveryConnectionId: row.recoveryConnectionId, consentId: row.consentId,
      credential: { keyId: row.credentialKeyId, nonce: row.credentialNonce, ciphertext: row.credentialCiphertext, tag: row.credentialTag },
      historicalImportStatus: row.historicalImportStatus,
      historicalCursorBefore: row.historicalCursorBefore,
      historicalNextAttemptAt: row.historicalNextAttemptAt
    };
  }

  public async claimDue(workerId: string, leaseMs: number): Promise<ActiveIntegrationConnection | null> {
    return this.database.db.transaction(async (transaction) => {
      const now = new Date();
      const candidates = await transaction.select().from(integrationConnections)
        .where(and(
          eq(integrationConnections.importEnabled, true),
          lte(integrationConnections.nextAttemptAt, now),
          or(isNull(integrationConnections.leaseUntil), lte(integrationConnections.leaseUntil, now))
        )).orderBy(integrationConnections.nextAttemptAt).limit(1).for("update", { skipLocked: true });
      const row = candidates[0];
      if (!row?.credentialKeyId || !row.credentialNonce || !row.credentialCiphertext || !row.credentialTag) return null;
      await transaction.update(integrationConnections).set({ leaseOwner: workerId, leaseUntil: new Date(now.valueOf() + leaseMs) }).where(eq(integrationConnections.id, row.id));
      return {
        id: row.id, personId: row.personId, recoveryConnectionId: row.recoveryConnectionId, consentId: row.consentId,
        credential: { keyId: row.credentialKeyId, nonce: row.credentialNonce, ciphertext: row.credentialCiphertext, tag: row.credentialTag },
        historicalImportStatus: row.historicalImportStatus,
        historicalCursorBefore: row.historicalCursorBefore,
        historicalNextAttemptAt: row.historicalNextAttemptAt
      };
    });
  }

  public async claimRemoteDisconnectDue(workerId: string, leaseMs: number): Promise<ActiveIntegrationConnection | null> {
    return this.database.db.transaction(async (transaction) => {
      const now = new Date();
      const candidates = await transaction.select().from(integrationConnections).where(and(
        eq(integrationConnections.remoteDisconnectPending, true), lte(integrationConnections.nextAttemptAt, now),
        or(isNull(integrationConnections.leaseUntil), lte(integrationConnections.leaseUntil, now))
      )).orderBy(integrationConnections.nextAttemptAt).limit(1).for("update", { skipLocked: true });
      const row = candidates[0];
      if (!row?.credentialKeyId || !row.credentialNonce || !row.credentialCiphertext || !row.credentialTag) return null;
      await transaction.update(integrationConnections).set({ leaseOwner: workerId, leaseUntil: new Date(now.valueOf() + leaseMs) }).where(eq(integrationConnections.id, row.id));
      return { id: row.id, personId: row.personId, recoveryConnectionId: row.recoveryConnectionId, consentId: row.consentId,
        credential: { keyId: row.credentialKeyId, nonce: row.credentialNonce, ciphertext: row.credentialCiphertext, tag: row.credentialTag },
        historicalImportStatus: row.historicalImportStatus,
        historicalCursorBefore: row.historicalCursorBefore,
        historicalNextAttemptAt: row.historicalNextAttemptAt };
    });
  }

  public async releaseClaim(id: string): Promise<void> {
    await this.database.db.update(integrationConnections).set({ leaseOwner: null, leaseUntil: null }).where(eq(integrationConnections.id, id));
  }

  public async beginDisconnect(personId: string, reason: string): Promise<ActiveIntegrationConnection | null> {
    return this.database.db.transaction(async (transaction) => {
      await lockPersonEvidenceMutation(transaction, personId);
      const row = await transaction.query.integrationConnections.findFirst({
        where: and(eq(integrationConnections.personId, personId), eq(integrationConnections.providerKey, providerKey))
      });
      if (!row) return null;
      const active = row.credentialKeyId && row.credentialNonce && row.credentialCiphertext && row.credentialTag ? {
        id: row.id, personId: row.personId, recoveryConnectionId: row.recoveryConnectionId, consentId: row.consentId,
        credential: { keyId: row.credentialKeyId, nonce: row.credentialNonce, ciphertext: row.credentialCiphertext, tag: row.credentialTag },
        historicalImportStatus: row.historicalImportStatus,
        historicalCursorBefore: row.historicalCursorBefore,
        historicalNextAttemptAt: row.historicalNextAttemptAt
      } : null;
      const now = new Date();
      const historicalReset = row.historicalImportStatus === "completed"
        ? { historicalClaimToken: null, historicalClaimUntil: null }
        : {
            historicalImportStatus: "not_requested" as const,
            historicalCursorBefore: null,
            historicalRequestedAt: null,
            historicalLastAttemptAt: null,
            historicalCompletedAt: null,
            historicalNextAttemptAt: null,
            historicalFailureCode: null,
            historicalClaimToken: null,
            historicalClaimUntil: null
          };
      await transaction.update(integrationConnections).set({
        lifecycle: "disconnected", importEnabled: false, disconnectedAt: now,
        remoteDisconnectPending: Boolean(active), ...historicalReset, updatedAt: now
      }).where(eq(integrationConnections.id, row.id));
      await transaction.update(recoveryConnections).set({ status: "disconnected", disconnectedAt: now })
        .where(eq(recoveryConnections.id, row.recoveryConnectionId));
      await transaction.update(recoveryConsents).set({ status: "revoked", revokedAt: now, revocationReason: reason })
        .where(and(eq(recoveryConsents.id, row.consentId), eq(recoveryConsents.status, "active")));
      return active;
    });
  }

  public async startHistoricalImport(personId: string): Promise<boolean> {
    const now = new Date();
    const current = await this.database.db.query.integrationConnections.findFirst({
      where: and(
        eq(integrationConnections.personId, personId),
        eq(integrationConnections.providerKey, providerKey),
        eq(integrationConnections.importEnabled, true)
      )
    });
    if (!current) return false;
    if (current.historicalImportStatus === "running") {
      const active = await this.database.db.update(integrationConnections).set({
        nextAttemptAt: now,
        updatedAt: now
      }).where(and(eq(integrationConnections.id, current.id), eq(integrationConnections.importEnabled, true)))
        .returning({ id: integrationConnections.id });
      return active.length > 0;
    }
    const restartCompleted = current.historicalImportStatus === "completed";
    const active = await this.database.db.update(integrationConnections).set({
      historicalImportStatus: "running",
      historicalCursorBefore: restartCompleted ? null : current.historicalCursorBefore,
      historicalRequestedAt: now,
      historicalLastAttemptAt: null,
      historicalCompletedAt: null,
      historicalNextAttemptAt: now,
      historicalFailureCode: null,
      historicalClaimToken: null,
      historicalClaimUntil: null,
      nextAttemptAt: now,
      updatedAt: now
    }).where(and(eq(integrationConnections.id, current.id), eq(integrationConnections.importEnabled, true)))
      .returning({ id: integrationConnections.id });
    return active.length > 0;
  }

  public async claimHistoricalWindow(
    id: string,
    expectedConsentId: string,
    expectedCursorBefore: string | null,
    claimToken: string,
    leaseMs: number
  ): Promise<HistoricalImportClaim | null> {
    const now = new Date();
    const rows = await this.database.db.update(integrationConnections).set({
      historicalClaimToken: claimToken,
      historicalClaimUntil: new Date(now.valueOf() + leaseMs),
      historicalLastAttemptAt: now,
      updatedAt: now
    }).where(and(
      eq(integrationConnections.id, id),
      eq(integrationConnections.consentId, expectedConsentId),
      eq(integrationConnections.importEnabled, true),
      eq(integrationConnections.historicalImportStatus, "running"),
      lte(integrationConnections.historicalNextAttemptAt, now),
      or(isNull(integrationConnections.historicalClaimUntil), lte(integrationConnections.historicalClaimUntil, now)),
      sql`${integrationConnections.historicalCursorBefore} IS NOT DISTINCT FROM ${expectedCursorBefore}`
    )).returning({ cursorBefore: integrationConnections.historicalCursorBefore });
    return rows[0] ? { claimToken, cursorBefore: rows[0].cursorBefore } : null;
  }

  public async markHistoricalWindowSucceeded(
    id: string,
    claimToken: string,
    processedThroughDate: string,
    completed: boolean
  ): Promise<boolean> {
    const now = new Date();
    const rows = await this.database.db.update(integrationConnections).set({
      historicalImportStatus: completed ? "completed" : "running",
      historicalCursorBefore: processedThroughDate,
      historicalCompletedAt: completed ? now : null,
      historicalNextAttemptAt: completed ? null : new Date(now.valueOf() + 15 * 60_000),
      historicalFailureCode: null,
      historicalClaimToken: null,
      historicalClaimUntil: null,
      updatedAt: now
    }).where(and(
      eq(integrationConnections.id, id),
      eq(integrationConnections.importEnabled, true),
      eq(integrationConnections.historicalImportStatus, "running"),
      eq(integrationConnections.historicalClaimToken, claimToken)
    )).returning({ id: integrationConnections.id });
    return rows.length > 0;
  }

  public async deferHistoricalWindow(id: string, claimToken: string): Promise<boolean> {
    const now = new Date();
    const rows = await this.database.db.update(integrationConnections).set({
      historicalNextAttemptAt: new Date(now.valueOf() + 15 * 60_000),
      historicalClaimToken: null,
      historicalClaimUntil: null,
      updatedAt: now
    }).where(and(
      eq(integrationConnections.id, id),
      eq(integrationConnections.importEnabled, true),
      eq(integrationConnections.historicalImportStatus, "running"),
      eq(integrationConnections.historicalClaimToken, claimToken)
    )).returning({ id: integrationConnections.id });
    return rows.length > 0;
  }

  public async markHistoricalImportFailed(
    id: string,
    claimToken: string,
    failureCode: IntegrationFailureCode,
    retryable: boolean
  ): Promise<boolean> {
    const now = new Date();
    const rows = await this.database.db.update(integrationConnections).set({
      historicalImportStatus: retryable ? "running" : "failed",
      historicalNextAttemptAt: retryable ? new Date(now.valueOf() + 15 * 60_000) : null,
      historicalFailureCode: failureCode,
      historicalClaimToken: null,
      historicalClaimUntil: null,
      updatedAt: now
    }).where(and(
      eq(integrationConnections.id, id),
      eq(integrationConnections.importEnabled, true),
      eq(integrationConnections.historicalImportStatus, "running"),
      eq(integrationConnections.historicalClaimToken, claimToken)
    )).returning({ id: integrationConnections.id });
    return rows.length > 0;
  }

  public async completeRemoteDisconnect(id: string): Promise<void> {
    await this.database.db.update(integrationConnections).set({
      remoteDisconnectPending: false, credentialKeyId: null, credentialNonce: null,
      credentialCiphertext: null, credentialTag: null, failureCode: null, leaseOwner: null, leaseUntil: null, updatedAt: new Date()
    }).where(eq(integrationConnections.id, id));
  }
  public async failRemoteDisconnect(id: string, failureCode: IntegrationFailureCode): Promise<void> {
    await this.database.db.update(integrationConnections).set({ failureCode, nextAttemptAt: new Date(Date.now() + 60_000), leaseOwner: null, leaseUntil: null, updatedAt: new Date() }).where(eq(integrationConnections.id, id));
  }
  public async markSyncSucceeded(id: string, consentId: string, hasData: boolean): Promise<void> {
    const now = new Date();
    await this.database.db.update(integrationConnections).set({ lifecycle: "active", failureCode: null, lastAttemptAt: now, lastSuccessfulSyncAt: now, ...(hasData ? { lastDataAt: now } : {}), nextAttemptAt: new Date(now.valueOf() + 300_000), updatedAt: now }).where(and(eq(integrationConnections.id, id), eq(integrationConnections.consentId, consentId), eq(integrationConnections.importEnabled, true)));
  }
  public async markSyncPartial(id: string, consentId: string): Promise<void> {
    const now = new Date();
    await this.database.db.update(integrationConnections).set({
      lastAttemptAt: now,
      nextAttemptAt: new Date(now.valueOf() + 300_000),
      updatedAt: now
    }).where(and(
      eq(integrationConnections.id, id), eq(integrationConnections.consentId, consentId),
      eq(integrationConnections.importEnabled, true)
    ));
  }
  public async markSyncFailed(id: string, consentId: string, failureCode: IntegrationFailureCode): Promise<void> {
    const now = new Date();
    await this.database.db.update(integrationConnections).set({ lifecycle: "degraded", failureCode, lastAttemptAt: now, nextAttemptAt: new Date(now.valueOf() + 60_000), updatedAt: now }).where(and(eq(integrationConnections.id, id), eq(integrationConnections.consentId, consentId), eq(integrationConnections.importEnabled, true)));
  }

  public async recordInbox(id: string, consentId: string, kind: "wellness" | "activity", identity: string, checksum: string): Promise<IntegrationInboxOutcome> {
    return this.database.db.transaction(async (transaction) => {
      const current = await transaction.execute(sql`
        select 1 from integration_connections
        where id = ${id} and consent_id = ${consentId} and import_enabled = true
        for update
      `);
      if (current.rowCount === 0) return { state: "stale_generation" };
      const latest = await transaction.query.integrationInbox.findFirst({
        where: and(eq(integrationInbox.connectionId, id), eq(integrationInbox.consentId, consentId), eq(integrationInbox.kind, kind), eq(integrationInbox.providerIdentity, identity)),
        orderBy: [desc(integrationInbox.receivedAt), desc(integrationInbox.id)]
      });
      if (latest?.checksum === checksum) {
        return latest.status === "normalized"
          ? { state: "unchanged" }
          : { state: "process", receiptId: latest.id };
      }
      const inserted = await transaction.insert(integrationInbox).values({
        connectionId: id,
        consentId,
        kind,
        providerIdentity: identity,
        checksum
      }).returning({ id: integrationInbox.id });
      if (!inserted[0]) throw new Error("Integration inbox receipt was not created");
      return { state: "process", receiptId: inserted[0].id };
    });
  }
  public async completeInbox(id: string, consentId: string, receiptId: string): Promise<boolean> {
    const rows = await this.database.db.update(integrationInbox).set({ status: "normalized", normalizedAt: new Date(), failureCode: null }).where(and(eq(integrationInbox.id, receiptId), eq(integrationInbox.connectionId, id), eq(integrationInbox.consentId, consentId), sql`exists (select 1 from integration_connections c where c.id = ${id} and c.consent_id = ${consentId} and c.import_enabled = true)`)).returning({ id: integrationInbox.id });
    return rows.length > 0;
  }
  public async recoveryFact(id: string, identity: string, factKey: string): Promise<RecoveryFactPointer | null> {
    const row = await this.database.db.query.integrationRecoveryFacts.findFirst({ where: and(eq(integrationRecoveryFacts.connectionId, id), eq(integrationRecoveryFacts.providerIdentity, identity), eq(integrationRecoveryFacts.factKey, factKey)) });
    return row ? {
      checksum: row.normalizedChecksum,
      observationId: row.observationId,
      confirmedConsentId: row.confirmedConsentId,
      confirmedDeliveryId: row.confirmedDeliveryId
    } : null;
  }
  public async linkRecoveryFact(id: string, consentId: string, identity: string, receiptId: string, factKey: string, checksum: string, observationId: string): Promise<boolean> {
    return this.database.db.transaction(async (transaction) => {
      const current = await transaction.execute(sql`
        select 1 from integration_connections
        where id = ${id} and consent_id = ${consentId} and import_enabled = true
        for update
      `);
      if (current.rowCount === 0) return false;
      const receipt = await transaction.query.integrationInbox.findFirst({
        where: and(
          eq(integrationInbox.id, receiptId),
          eq(integrationInbox.connectionId, id),
          eq(integrationInbox.consentId, consentId),
          sql`${integrationInbox.kind} IN ('wellness', 'activity')`,
          eq(integrationInbox.providerIdentity, identity)
        )
      });
      if (!receipt) return false;
      await transaction.insert(integrationRecoveryFacts).values({ connectionId: id, providerIdentity: identity, factKey, normalizedChecksum: checksum, observationId, confirmedConsentId: consentId, confirmedDeliveryId: receiptId }).onConflictDoUpdate({ target: [integrationRecoveryFacts.connectionId, integrationRecoveryFacts.providerIdentity, integrationRecoveryFacts.factKey], set: { normalizedChecksum: checksum, observationId, confirmedConsentId: consentId, confirmedDeliveryId: receiptId, updatedAt: new Date() } });
      return true;
    });
  }

}

function emptyHistoricalImport(): GarminIntervalsConnection["historicalImport"] {
  return {
    status: "not_requested",
    processedThroughDate: null,
    requestedAt: null,
    lastAttemptAt: null,
    completedAt: null,
    failureCode: null
  };
}
