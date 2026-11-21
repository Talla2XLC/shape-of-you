import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { ActivityDetailsIssue, GarminIntervalsConnection, IntegrationConnection } from "@shape-of-you/contracts";

import type { DatabaseContext } from "../database/context.js";
import {
  integrationAuthorizationTransactions,
  integrationConnections,
  integrationCutovers,
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
  IntegrationInboxOutcome,
  IntegrationRecordAdmission,
  IntegrationImportPolicy
} from "../integrations/integration-store.js";
import { CONNECTED_RECOVERY_METRIC_KEYS } from "../integrations/integration-store.js";
import type { IntegrationFailureCode } from "../integrations/provider.js";
import { ConflictError } from "../domain/errors.js";
import { lockPersonEvidenceMutation, type DatabaseTransaction } from "./source-reference-repository.js";
import { integrationParentRecordAllowed, integrationRecordAllowed, readIntegrationImportPolicy } from "./integration-cutover-policy.js";

/** The two supported integration namespaces, never inferred from credential contents. */
export type IntegrationProviderKey = "intervals_icu" | "garmin_personal";

/** PostgreSQL implementation of the in-process provider integration boundary. */
export class IntegrationRepository<Status extends IntegrationConnection = GarminIntervalsConnection> implements IntegrationStore<Status> {
  public constructor(private readonly database: DatabaseContext, private readonly providerKey: IntegrationProviderKey = "intervals_icu") {}

  /** Current request scope is advisory; all writes also recheck it under the Person lock. */
  public importPolicy(id: string, consentId: string): Promise<IntegrationImportPolicy | null> {
    return this.database.db.transaction(async (transaction) => {
      const owner = await transaction.query.integrationConnections.findFirst({ where: and(eq(integrationConnections.id, id), eq(integrationConnections.providerKey, this.providerKey)) });
      if (!owner) return null;
      await lockPersonEvidenceMutation(transaction, owner.personId);
      return readIntegrationImportPolicy(transaction, id, consentId);
    });
  }

  /** Checks database wall time and current consent before each bounded provider request. */
  public assertReadAllowed(id: string, consentId: string): Promise<boolean> {
    return this.database.db.transaction(async (transaction) => {
      const owner = await transaction.query.integrationConnections.findFirst({ where: and(eq(integrationConnections.id, id), eq(integrationConnections.providerKey, this.providerKey)) });
      if (!owner) return false;
      await lockPersonEvidenceMutation(transaction, owner.personId);
      const row = await transaction.query.integrationConnections.findFirst({ where: and(eq(integrationConnections.id, id), eq(integrationConnections.consentId, consentId), eq(integrationConnections.importEnabled, true)) });
      if (!row) return false;
      return this.writable(transaction, id, consentId);
    });
  }

  public async createAuthorization(personId: string, stateHash: string, returnTo: string, expiresAt: Date): Promise<void> {
    await this.database.db.insert(integrationAuthorizationTransactions).values({
      personId, providerKey: this.providerKey, stateHash, returnTo, expiresAt
    });
  }

  public async consumeAuthorization(stateHash: string, now: Date): Promise<ConsumedAuthorizationTransaction | null> {
    const rows = await this.database.db.update(integrationAuthorizationTransactions)
      .set({ consumedAt: now })
      .where(and(
        eq(integrationAuthorizationTransactions.providerKey, this.providerKey),
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
      .where(and(eq(integrationConnections.personId, personId), eq(integrationConnections.providerKey, this.providerKey)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.recovery.erasureRequestedAt) throw new Error("Connection erasure must complete before reauthorization");
    return { id: row.integration.id, recoveryConnectionId: row.integration.recoveryConnectionId, consentId: row.integration.consentId };
  }

  public async activate(input: {
    readonly id: string; readonly recoveryConnectionId: string; readonly consentId: string;
    readonly personId: string; readonly externalUserId: string | null; readonly credential: { readonly keyId: string; readonly nonce: string; readonly ciphertext: string; readonly tag: string };
    readonly authorizationStartedAt: Date; readonly expectedConsentId?: string | null;
  }): Promise<void> {
    await this.database.db.transaction(async (transaction) => {
      await lockPersonEvidenceMutation(transaction, input.personId);
      const cutover = await transaction.query.integrationCutovers.findFirst({ where: and(eq(integrationCutovers.personId, input.personId), sql`(${integrationCutovers.state} IN ('scheduled','draining','active') OR ${integrationCutovers.restoreSuppressed} = true)`) });
      let cutoverRotation = false;
      if (cutover) {
        if (cutover.restoreSuppressed) throw new ConflictError("Restored cutover requires approved operational recovery");
        const reference = this.providerKey === "intervals_icu" ? cutover.sourceConnectionId : cutover.targetConnectionId;
        if (reference !== input.id) throw new ConflictError("Cutover bounds survive connection erasure; ordinary reconnect is unavailable");
        if (this.providerKey === "garmin_personal" && cutover.state === "scheduled") throw new ConflictError("Pending cutover access must be changed through cutover retry");
        if (this.providerKey === "intervals_icu") {
          const clock = await transaction.execute(sql<{ now: Date }>`select clock_timestamp() as now`);
          if (cutover.state === "active" || new Date(clock.rows[0]!.now as Date) >= cutover.sourceDrainsUntil) throw new ConflictError("Source import authority ended");
          const source = await transaction.query.integrationConnections.findFirst({ where: eq(integrationConnections.id, input.id) });
          if (source?.externalUserId !== input.externalUserId) throw new ConflictError("Intervals source account cannot change during cutover");
          if (cutover.state === "scheduled") {
            await transaction.update(integrationCutovers).set({ state: "failed", failureCode: "consent_changed", version: cutover.version + 1, updatedAt: sql`clock_timestamp()` }).where(eq(integrationCutovers.id, cutover.id));
            if (cutover.targetConnectionId) await transaction.update(integrationConnections).set({ importEnabled: false, lifecycle: "disconnected", disconnectedAt: sql`clock_timestamp()` }).where(eq(integrationConnections.id, cutover.targetConnectionId));
            if (cutover.targetConsentId) await transaction.update(recoveryConsents).set({ status: "revoked", revokedAt: sql`clock_timestamp()`, revocationReason: "Source generation changed before cutover" }).where(eq(recoveryConsents.id, cutover.targetConsentId));
            if (cutover.targetRecoveryConnectionId) await transaction.update(recoveryConnections).set({ status: "disconnected", disconnectedAt: sql`clock_timestamp()` }).where(eq(recoveryConnections.id, cutover.targetRecoveryConnectionId));
          }
        }
        cutoverRotation = true;
      }
      const overlap = await transaction.execute(sql`
        select 1 from integration_connections other
        where other.person_id = ${input.personId} and other.provider_key <> ${this.providerKey}
          and (other.import_enabled = true
            or exists (select 1 from recovery_observations o where o.connection_id = other.recovery_connection_id)
            or exists (select 1 from integration_activity_facts a where a.connection_id = other.id))
        limit 1
      `);
      if (overlap.rowCount && !cutoverRotation) throw new ConflictError("Another provider connection or retained imported data prevents automatic switching");
      if (this.providerKey === "intervals_icu" && !input.externalUserId) throw new ConflictError("Provider account identity is required");
      const providers = await transaction.insert(recoveryProviders)
        .values({ key: this.providerKey, name: this.providerKey === "intervals_icu" ? "Intervals.icu" : "Garmin" })
        .onConflictDoNothing().returning();
      const provider = providers[0] ?? await transaction.query.recoveryProviders.findFirst({ where: eq(recoveryProviders.key, this.providerKey) });
      if (!provider) throw new Error("Intervals.icu provider could not be resolved");

      const previous = await transaction.query.integrationConnections.findFirst({
        where: and(eq(integrationConnections.personId, input.personId), eq(integrationConnections.providerKey, this.providerKey))
      });
      if (input.expectedConsentId !== undefined && (previous?.consentId ?? null) !== input.expectedConsentId) throw new ConflictError("Concurrent authorization changed the connection generation");
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
          dedupeKey: `${this.providerKey}:${input.recoveryConnectionId}`
        });
      }
      await transaction.insert(recoveryConsents).values({
        id: input.consentId,
        personId: input.personId,
        connectionId: input.recoveryConnectionId,
        purpose: this.providerKey === "garmin_personal" ? "Import Recovery, Training, Physical State and Nutrition from Garmin Personal" : "Import Recovery and Training from Intervals.icu",
        integrationImportScopes: this.providerKey === "garmin_personal" ? ["recovery", "training", "physical_state", "nutrition"] : ["recovery", "training"],
        retentionMode: "indefinite"
      });
      await transaction.insert(recoveryConsentKinds).values([
        { consentId: input.consentId, kind: "sleep" },
        { consentId: input.consentId, kind: "metric" }
      ]);
      const values = {
        consentId: input.consentId, externalUserId: input.externalUserId ?? previous?.externalUserId ?? null,
        lifecycle: "active" as const, importEnabled: true,
        credentialKeyId: input.credential.keyId, credentialNonce: input.credential.nonce,
        credentialCiphertext: input.credential.ciphertext, credentialTag: input.credential.tag,
        failureCode: null, lastAttemptAt: null, lastSuccessfulSyncAt: null, lastDataAt: null,
        disconnectedAt: null, remoteDisconnectPending: false, remoteDisconnectAttempts: 0, remoteRevokeUnconfirmed: false, nextAttemptAt: new Date(), updatedAt: new Date()
      };
      if (previous) {
        await transaction.update(integrationConnections).set(values).where(eq(integrationConnections.id, previous.id));
        if (cutover && cutover.state !== "scheduled") await transaction.update(integrationCutovers).set({
          ...(this.providerKey === "intervals_icu" ? { sourceConsentId: input.consentId } : { targetConsentId: input.consentId }),
          version: cutover.version + 1, updatedAt: sql`clock_timestamp()`
        }).where(eq(integrationCutovers.id, cutover.id));
      } else {
        await transaction.insert(integrationConnections).values({
          id: input.id, personId: input.personId, recoveryConnectionId: input.recoveryConnectionId,
          providerKey: this.providerKey, ...values
        });
      }
    });
  }

  /** Binds the first documented account identity before writes and fences key rotation. */
  public async bindExternalIdentity(id: string, consentId: string, externalUserId: string): Promise<boolean> {
    return this.database.db.transaction(async (transaction) => {
      const owner = await transaction.query.integrationConnections.findFirst({ where: and(eq(integrationConnections.id, id), eq(integrationConnections.providerKey, this.providerKey)) });
      if (!owner) return false;
      await lockPersonEvidenceMutation(transaction, owner.personId);
      const policy = await readIntegrationImportPolicy(transaction, id, consentId);
      if (policy && !policy.requestAllowed) return false;
      const rows = await transaction.execute(sql`
        update integration_connections set external_user_id = ${externalUserId}
        where id = ${id} and provider_key = ${this.providerKey} and consent_id = ${consentId}
          and import_enabled = true and (external_user_id is null or external_user_id = ${externalUserId})
        returning id
      `);
      if (!rows.rowCount) {
        const current = await transaction.query.integrationConnections.findFirst({ where: eq(integrationConnections.id, id) });
        if (current?.consentId === consentId && current.importEnabled && current.externalUserId !== externalUserId) throw new ConflictError("Garmin account changed; imported accounts cannot be merged");
        return false;
      }
      return true;
    });
  }

  public async status(personId: string): Promise<Status | null> {
    const row = await this.database.db.query.integrationConnections.findFirst({
      where: and(eq(integrationConnections.personId, personId), eq(integrationConnections.providerKey, this.providerKey))
    });
    if (!row) {
      const pending = await this.database.db.query.integrationAuthorizationTransactions.findFirst({
        where: and(
          eq(integrationAuthorizationTransactions.personId, personId),
          eq(integrationAuthorizationTransactions.providerKey, this.providerKey),
          isNull(integrationAuthorizationTransactions.consumedAt),
          gte(integrationAuthorizationTransactions.expiresAt, new Date())
        )
      });
      return pending ? {
        provider: this.providerKey, displayName: this.providerKey === "intervals_icu" ? "Garmin via Intervals.icu" : "Garmin", recoveryConnectionId: null,
        lifecycle: "connecting", failureCode: null, lastAttemptAt: null, lastSuccessfulSyncAt: null,
        lastDataAt: null, connectedAt: null, disconnectedAt: null,
        historicalImport: emptyHistoricalImport()
      } as Status : null;
    }
    return {
      provider: this.providerKey,
      displayName: this.providerKey === "intervals_icu" ? "Garmin via Intervals.icu" : "Garmin",
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
        scopeFromDate: row.historicalScopeFromDate,
        processedThroughDate: row.historicalCursorBefore,
        requestedAt: row.historicalRequestedAt?.toISOString() ?? null,
        lastAttemptAt: row.historicalLastAttemptAt?.toISOString() ?? null,
        completedAt: row.historicalCompletedAt?.toISOString() ?? null,
        failureCode: row.historicalFailureCode
      }
    } as Status;
  }

  /** Reads only safe sync and target-date delivery metadata for Recovery composition. */
  /** Returns existing daily fact keys so complete authoritative endpoints can withdraw removed children. */
  public async recoveryFactKeys(id: string, identity: string): Promise<readonly string[]> {
    const rows=await this.database.db.query.integrationRecoveryFacts.findMany({where:and(eq(integrationRecoveryFacts.connectionId,id),eq(integrationRecoveryFacts.providerIdentity,identity))});
    return rows.map(row=>row.factKey);
  }

  public async connectedRecoveryDelivery(
    personId: string,
    localDate: string
  ): Promise<ConnectedRecoveryDeliveryEvidence | null> {
    const connection = await this.database.db.query.integrationConnections.findFirst({
      where: and(
        eq(integrationConnections.personId, personId),
        eq(integrationConnections.providerKey, this.providerKey)
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
      if ((this.providerKey === "garmin_personal" && !["sleep", "hrv_rmssd", "sleep_score", "resting_heart_rate", "night_heart_rate", "oxygen_saturation", "respiration_rate", "body_battery", "body_battery_min", "body_battery_max", "steps"].includes(metric)) ||
          (this.providerKey === "intervals_icu" && metric === "body_battery")) {
        return { metric, state: "unknown" as const, observationId: null };
      }
      const point = metric === "body_battery" ? pointers.get("body_battery_instant") : undefined;
      const pointer = point && point.normalizedChecksum !== "removed" ? point : pointers.get(metric);
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
      where: and(eq(integrationConnections.providerKey, this.providerKey), eq(integrationConnections.personId, personId), eq(integrationConnections.importEnabled, true))
    });
    if (!row?.credentialKeyId || !row.credentialNonce || !row.credentialCiphertext || !row.credentialTag) return null;
    return {
      id: row.id, personId: row.personId, recoveryConnectionId: row.recoveryConnectionId, consentId: row.consentId,
      credential: { keyId: row.credentialKeyId, nonce: row.credentialNonce, ciphertext: row.credentialCiphertext, tag: row.credentialTag },
      historicalImportStatus: row.historicalImportStatus,
      historicalCursorBefore: row.historicalCursorBefore,
      historicalScopeFromDate: row.historicalScopeFromDate,
      historicalNextAttemptAt: row.historicalNextAttemptAt
    };
  }

  public async personTimezone(personId: string): Promise<string | null> {
    const row = await this.database.db.query.persons.findFirst({ where: eq(persons.id, personId) });
    return row?.timezone ?? null;
  }

  public async findForErasure(personId: string, recoveryConnectionId: string): Promise<ActiveIntegrationConnection | null> {
    const row = await this.database.db.query.integrationConnections.findFirst({
      where: and(eq(integrationConnections.providerKey, this.providerKey), eq(integrationConnections.personId, personId), eq(integrationConnections.recoveryConnectionId, recoveryConnectionId))
    });
    if (!row?.credentialKeyId || !row.credentialNonce || !row.credentialCiphertext || !row.credentialTag) return null;
    return {
      id: row.id, personId: row.personId, recoveryConnectionId: row.recoveryConnectionId, consentId: row.consentId,
      credential: { keyId: row.credentialKeyId, nonce: row.credentialNonce, ciphertext: row.credentialCiphertext, tag: row.credentialTag },
      historicalImportStatus: row.historicalImportStatus,
      historicalCursorBefore: row.historicalCursorBefore,
      historicalScopeFromDate: row.historicalScopeFromDate,
      historicalNextAttemptAt: row.historicalNextAttemptAt
    };
  }

  public async claimDue(workerId: string, leaseMs: number): Promise<ActiveIntegrationConnection | null> {
    return this.database.db.transaction(async (transaction) => {
      const now = new Date();
      const candidates = await transaction.select().from(integrationConnections)
        .where(and(
          eq(integrationConnections.providerKey, this.providerKey),
          eq(integrationConnections.importEnabled, true),
          importRequestPredicate(),
          lte(integrationConnections.nextAttemptAt, now),
          or(isNull(integrationConnections.leaseUntil), lte(integrationConnections.leaseUntil, now))
        )).orderBy(integrationConnections.nextAttemptAt).limit(1);
      const row = candidates[0];
      if (row && !await this.writable(transaction, row.id, row.consentId)) return null;
      const freshLease = row ? await transaction.query.integrationConnections.findFirst({ columns: { leaseUntil: true }, where: eq(integrationConnections.id, row.id) }) : null;
      if (freshLease?.leaseUntil && freshLease.leaseUntil > now) return null;
      if (!row?.credentialKeyId || !row.credentialNonce || !row.credentialCiphertext || !row.credentialTag) return null;
      await transaction.update(integrationConnections).set({ leaseOwner: workerId, leaseUntil: new Date(now.valueOf() + leaseMs) }).where(eq(integrationConnections.id, row.id));
      return {
        id: row.id, personId: row.personId, recoveryConnectionId: row.recoveryConnectionId, consentId: row.consentId,
        credential: { keyId: row.credentialKeyId, nonce: row.credentialNonce, ciphertext: row.credentialCiphertext, tag: row.credentialTag },
        historicalImportStatus: row.historicalImportStatus,
        historicalCursorBefore: row.historicalCursorBefore,
      historicalScopeFromDate: row.historicalScopeFromDate,
        historicalNextAttemptAt: row.historicalNextAttemptAt
      };
    });
  }

  public async claimRemoteDisconnectDue(workerId: string, leaseMs: number): Promise<ActiveIntegrationConnection | null> {
    return this.database.db.transaction(async (transaction) => {
      const now = new Date();
      const candidates = await transaction.select().from(integrationConnections).where(and(
        eq(integrationConnections.providerKey, this.providerKey),
        eq(integrationConnections.remoteDisconnectPending, true), lte(integrationConnections.nextAttemptAt, now),
        sql`not exists(select 1 from integration_cutovers k where k.source_connection_id=${integrationConnections.id} and k.state in ('active','draining') and (${integrationConnections.remoteDisconnectAttempts} >= 5 or ${integrationConnections.disconnectedAt} <= clock_timestamp() - interval '1 hour'))`,
        or(isNull(integrationConnections.leaseUntil), lte(integrationConnections.leaseUntil, now))
      )).orderBy(integrationConnections.nextAttemptAt).limit(1);
      const row = candidates[0];
      if (row) await lockPersonEvidenceMutation(transaction, row.personId);
      const fresh = row ? await transaction.query.integrationConnections.findFirst({ where: and(eq(integrationConnections.id, row.id), eq(integrationConnections.consentId, row.consentId), eq(integrationConnections.remoteDisconnectPending, true), eq(integrationConnections.importEnabled, false), or(isNull(integrationConnections.leaseUntil), lte(integrationConnections.leaseUntil, now))) }) : null;
      if (!fresh) return null;
      if (!row?.credentialKeyId || !row.credentialNonce || !row.credentialCiphertext || !row.credentialTag) return null;
      await transaction.update(integrationConnections).set({ leaseOwner: workerId, leaseUntil: new Date(now.valueOf() + leaseMs) }).where(eq(integrationConnections.id, row.id));
      return { id: row.id, personId: row.personId, recoveryConnectionId: row.recoveryConnectionId, consentId: row.consentId,
        credential: { keyId: row.credentialKeyId, nonce: row.credentialNonce, ciphertext: row.credentialCiphertext, tag: row.credentialTag },
        historicalImportStatus: row.historicalImportStatus,
        historicalCursorBefore: row.historicalCursorBefore,
      historicalScopeFromDate: row.historicalScopeFromDate,
        historicalNextAttemptAt: row.historicalNextAttemptAt };
    });
  }

  public async releaseClaim(id: string, expectedConsentId?: string): Promise<void> {
    await this.database.db.update(integrationConnections).set({ leaseOwner: null, leaseUntil: null }).where(and(eq(integrationConnections.id, id), eq(integrationConnections.providerKey, this.providerKey), expectedConsentId ? eq(integrationConnections.consentId, expectedConsentId) : undefined));
  }

  public async beginDisconnect(personId: string, reason: string): Promise<ActiveIntegrationConnection | null> {
    return this.database.db.transaction(async (transaction) => {
      await lockPersonEvidenceMutation(transaction, personId);
      const row = await transaction.query.integrationConnections.findFirst({
        where: and(eq(integrationConnections.personId, personId), eq(integrationConnections.providerKey, this.providerKey))
      });
      if (!row) return null;
      const active = row.credentialKeyId && row.credentialNonce && row.credentialCiphertext && row.credentialTag ? {
        id: row.id, personId: row.personId, recoveryConnectionId: row.recoveryConnectionId, consentId: row.consentId,
        credential: { keyId: row.credentialKeyId, nonce: row.credentialNonce, ciphertext: row.credentialCiphertext, tag: row.credentialTag },
        historicalImportStatus: row.historicalImportStatus,
        historicalCursorBefore: row.historicalCursorBefore,
      historicalScopeFromDate: row.historicalScopeFromDate,
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
        remoteDisconnectPending: this.providerKey === "intervals_icu" && Boolean(active),
        ...(this.providerKey === "garmin_personal" ? { credentialKeyId: null, credentialNonce: null, credentialCiphertext: null, credentialTag: null } : {}),
        ...historicalReset, updatedAt: now
      }).where(eq(integrationConnections.id, row.id));
      await transaction.update(recoveryConnections).set({ status: "disconnected", disconnectedAt: now })
        .where(eq(recoveryConnections.id, row.recoveryConnectionId));
      await transaction.update(recoveryConsents).set({ status: "revoked", revokedAt: now, revocationReason: reason })
        .where(and(eq(recoveryConsents.id, row.consentId), eq(recoveryConsents.status, "active")));
      return active;
    });
  }

  public async startHistoricalImport(personId: string): Promise<boolean> {
    return this.database.db.transaction(async (transaction) => {
      await lockPersonEvidenceMutation(transaction, personId);
    const now = new Date();
    const current = await transaction.query.integrationConnections.findFirst({
      where: and(
        eq(integrationConnections.personId, personId),
        eq(integrationConnections.providerKey, this.providerKey),
        eq(integrationConnections.importEnabled, true)
      )
    });
    if (!current || !await this.writable(transaction, current.id, current.consentId)) return false;
    const policy = await readIntegrationImportPolicy(transaction, current.id, current.consentId);
    const scopeFromDate = policy?.historyScopeFromDate ?? "2000-01-01";
    if (current.historicalImportStatus === "running") {
      const active = await transaction.update(integrationConnections).set({
        nextAttemptAt: now,
        updatedAt: now
      }).where(and(eq(integrationConnections.id, current.id), eq(integrationConnections.importEnabled, true)))
        .returning({ id: integrationConnections.id });
      return active.length > 0;
    }
    const restartCompleted = current.historicalImportStatus === "completed";
    const active = await transaction.update(integrationConnections).set({
      historicalImportStatus: "running",
      historicalScopeFromDate: scopeFromDate,
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
    });
  }

  public async claimHistoricalWindow(
    id: string,
    expectedConsentId: string,
    expectedCursorBefore: string | null,
    claimToken: string,
    leaseMs: number
  ): Promise<HistoricalImportClaim | null> {
    return this.database.db.transaction(async (transaction) => {
      if (!await this.writable(transaction, id, expectedConsentId)) return null;
    const now = new Date();
    const rows = await transaction.update(integrationConnections).set({
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
    });
  }

  public async markHistoricalWindowSucceeded(
    id: string,
    claimToken: string,
    processedThroughDate: string,
    completed: boolean
  ): Promise<boolean> {
    return this.database.db.transaction(async (transaction) => {
      if (!await this.writable(transaction, id)) return false;
      const job = await transaction.query.integrationConnections.findFirst({ where: eq(integrationConnections.id, id) });
      if (!job || processedThroughDate < job.historicalScopeFromDate || (completed && processedThroughDate !== job.historicalScopeFromDate)) return false;
    const now = new Date();
    const rows = await transaction.update(integrationConnections).set({
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
    });
  }

  public async deferHistoricalWindow(id: string, claimToken: string): Promise<boolean> {
    return this.database.db.transaction(async (transaction) => {
      if (!await this.writable(transaction, id)) return false;
    const now = new Date();
    const rows = await transaction.update(integrationConnections).set({
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
    });
  }

  public async markHistoricalImportFailed(
    id: string,
    claimToken: string,
    failureCode: IntegrationFailureCode,
    retryable: boolean
  ): Promise<boolean> {
    return this.database.db.transaction(async (transaction) => {
      if (!await this.writable(transaction, id)) return false;
    const now = new Date();
    const rows = await transaction.update(integrationConnections).set({
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
    });
  }

  public async completeRemoteDisconnect(id: string, expectedConsentId?: string): Promise<void> {
    await this.database.db.update(integrationConnections).set({
      remoteDisconnectPending: false, credentialKeyId: null, credentialNonce: null,
      credentialCiphertext: null, credentialTag: null, failureCode: null, leaseOwner: null, leaseUntil: null, updatedAt: new Date()
    }).where(and(eq(integrationConnections.id, id), eq(integrationConnections.providerKey, this.providerKey), eq(integrationConnections.importEnabled, false), expectedConsentId ? eq(integrationConnections.consentId, expectedConsentId) : undefined));
  }
  public async failRemoteDisconnect(id: string, failureCode: IntegrationFailureCode, expectedConsentId?: string): Promise<void> {
    await this.database.db.update(integrationConnections).set({ failureCode, remoteDisconnectAttempts: sql`${integrationConnections.remoteDisconnectAttempts} + 1`, nextAttemptAt: new Date(Date.now() + 60_000), leaseOwner: null, leaseUntil: null, updatedAt: new Date() }).where(and(eq(integrationConnections.id, id), eq(integrationConnections.providerKey, this.providerKey), eq(integrationConnections.importEnabled, false), expectedConsentId ? eq(integrationConnections.consentId, expectedConsentId) : undefined));
  }
  public async markSyncSucceeded(id: string, consentId: string, hasData: boolean): Promise<void> {
    return this.database.db.transaction(async (transaction) => {
      if (!await this.writable(transaction, id, consentId)) return;
    const now = new Date();
    await transaction.update(integrationConnections).set({ lifecycle: "active", failureCode: null, lastAttemptAt: now, lastSuccessfulSyncAt: now, ...(hasData ? { lastDataAt: now } : {}), nextAttemptAt: new Date(now.valueOf() + 300_000), updatedAt: now }).where(and(eq(integrationConnections.id, id), eq(integrationConnections.consentId, consentId), eq(integrationConnections.importEnabled, true)));
    });
  }
  public async markSyncPartial(id: string, consentId: string): Promise<void> {
    return this.database.db.transaction(async (transaction) => {
      if (!await this.writable(transaction, id, consentId)) return;
    const now = new Date();
    await transaction.update(integrationConnections).set({
      lastAttemptAt: now,
      nextAttemptAt: new Date(now.valueOf() + 300_000),
      updatedAt: now
    }).where(and(
      eq(integrationConnections.id, id), eq(integrationConnections.consentId, consentId),
      eq(integrationConnections.importEnabled, true)
    ));
    });
  }
  public async markSyncFailed(id: string, consentId: string, failureCode: IntegrationFailureCode): Promise<void> {
    return this.database.db.transaction(async (transaction) => {
      if (!await this.writable(transaction, id, consentId)) return;
    const now = new Date();
    await transaction.update(integrationConnections).set({ lifecycle: "degraded", failureCode, lastAttemptAt: now, nextAttemptAt: new Date(now.valueOf() + 60_000), updatedAt: now }).where(and(eq(integrationConnections.id, id), eq(integrationConnections.consentId, consentId), eq(integrationConnections.importEnabled, true)));
    });
  }

  public async recordInbox(id: string, consentId: string, kind: "wellness" | "activity", identity: string, checksum: string, admission?: IntegrationRecordAdmission): Promise<IntegrationInboxOutcome> {
    return this.database.db.transaction(async (transaction) => {
      const owner = await transaction.query.integrationConnections.findFirst({ where: and(eq(integrationConnections.id, id), eq(integrationConnections.providerKey, this.providerKey)) });
      if (!owner) return { state: "stale_generation" };
      await lockPersonEvidenceMutation(transaction, owner.personId);
      const policy = await readIntegrationImportPolicy(transaction, id, consentId);
      if (!integrationRecordAllowed(policy, kind, admission)) return { state: "stale_generation" };
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
  /** {@inheritDoc IntegrationStore.setActivityDetailsIssue} */
  public async setActivityDetailsIssue(id: string, consentId: string, receiptId: string, issue: ActivityDetailsIssue | null): Promise<boolean> {
    return this.database.db.transaction(async (transaction) => {
      if (!await this.writable(transaction, id, consentId) || !await this.receiptAllowed(transaction, id, consentId, receiptId)) return false;
    const rows = await transaction.update(integrationInbox).set({ activityDetailsIssue: issue, activityDetailsAttemptedAt: sql`clock_timestamp()` }).where(and(
      eq(integrationInbox.id, receiptId), eq(integrationInbox.connectionId, id), eq(integrationInbox.consentId, consentId), eq(integrationInbox.kind, "activity"),
      sql`exists (select 1 from integration_connections c where c.id = ${id} and c.consent_id = ${consentId} and c.import_enabled = true)`
    )).returning({ id: integrationInbox.id });
    return rows.length > 0;
    });
  }

  public async completeInbox(id: string, consentId: string, receiptId: string): Promise<boolean> {
    return this.database.db.transaction(async (transaction) => {
      if (!await this.writable(transaction, id, consentId) || !await this.receiptAllowed(transaction, id, consentId, receiptId)) return false;
    const rows = await transaction.update(integrationInbox).set({ status: "normalized", normalizedAt: new Date(), failureCode: null }).where(and(eq(integrationInbox.id, receiptId), eq(integrationInbox.connectionId, id), eq(integrationInbox.consentId, consentId), sql`exists (select 1 from integration_connections c where c.id = ${id} and c.consent_id = ${consentId} and c.import_enabled = true)`)).returning({ id: integrationInbox.id });
    return rows.length > 0;
    });
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
      const owner = await transaction.query.integrationConnections.findFirst({ where: and(eq(integrationConnections.id, id), eq(integrationConnections.providerKey, this.providerKey)) });
      if (!owner) return false;
      await lockPersonEvidenceMutation(transaction, owner.personId);
      if (!await this.receiptAllowed(transaction, id, consentId, receiptId)) return false;
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

  private async receiptAllowed(transaction: DatabaseTransaction, id: string, consentId: string, receiptId: string): Promise<boolean> {
    const policy = await readIntegrationImportPolicy(transaction, id, consentId);
    if (!policy) return true;
    const receipt = await transaction.query.integrationInbox.findFirst({ where: and(eq(integrationInbox.id, receiptId), eq(integrationInbox.connectionId, id), eq(integrationInbox.consentId, consentId)) });
    if (!receipt) return false;
    return receipt.kind === "activity"
      ? integrationParentRecordAllowed(transaction, id, consentId, receipt.providerIdentity)
      : integrationRecordAllowed(policy, "wellness", { localDate: receipt.providerIdentity });
  }

  private async writable(transaction: DatabaseTransaction, id: string, consentId?: string): Promise<boolean> {
    const owner = await transaction.query.integrationConnections.findFirst({ where: and(eq(integrationConnections.id, id), eq(integrationConnections.providerKey, this.providerKey)) });
    if (!owner) return false;
    await lockPersonEvidenceMutation(transaction, owner.personId);
    const current = await transaction.query.integrationConnections.findFirst({ where: and(eq(integrationConnections.id, id), eq(integrationConnections.importEnabled, true), consentId ? eq(integrationConnections.consentId, consentId) : undefined) });
    if (!current) return false;
    const consent = await transaction.query.recoveryConsents.findFirst({ where: and(eq(recoveryConsents.id, current.consentId), eq(recoveryConsents.personId, current.personId), eq(recoveryConsents.connectionId, current.recoveryConnectionId), eq(recoveryConsents.status, "active")) });
    const recovery = await transaction.query.recoveryConnections.findFirst({ where: and(eq(recoveryConnections.id, current.recoveryConnectionId), eq(recoveryConnections.personId, current.personId), eq(recoveryConnections.status, "active"), isNull(recoveryConnections.erasureRequestedAt)) });
    if (!consent || !recovery) return false;
    const policy = await readIntegrationImportPolicy(transaction, id, current.consentId);
    return policy === null || policy.requestAllowed;
  }
}

function emptyHistoricalImport(): GarminIntervalsConnection["historicalImport"] {
  return {
    status: "not_requested",
    scopeFromDate: "2000-01-01",
    processedThroughDate: null,
    requestedAt: null,
    lastAttemptAt: null,
    completedAt: null,
    failureCode: null
  };
}

/** SQL prefilter avoids expired source jobs starving unrelated Persons; writes recheck after their lock. */
function importRequestPredicate() {
  return sql`not exists (select 1 from integration_cutovers cutover
    where cutover.person_id = ${integrationConnections.personId} and (cutover.state in ('scheduled','draining','active') or cutover.restore_suppressed=true) and (cutover.restore_suppressed=true or
      (${integrationConnections.providerKey} = cutover.source_provider and (
        ${integrationConnections.id} is distinct from cutover.source_connection_id or ${integrationConnections.consentId} is distinct from cutover.source_consent_id
        or cutover.state = 'active' or clock_timestamp() >= cutover.source_drains_until))
      or (${integrationConnections.providerKey} = cutover.target_provider and (
        ${integrationConnections.id} is distinct from cutover.target_connection_id or ${integrationConnections.consentId} is distinct from cutover.target_consent_id
        or cutover.state = 'scheduled' or clock_timestamp() < cutover.starts_at))))`;
}
