import { immutableCutoverPolicyHash } from "../recovery/integration-cutover-restore-policy.js";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { DatabaseContext } from "../database/context.js";
import type { DatabaseTransaction } from "./source-reference-repository.js";
import { integrationConnections, integrationCutovers, persons, recoveryConnections, recoveryConsentKinds, recoveryConsents, recoveryProviders } from "../database/schema.js";
import type { ActiveIntegrationConnection } from "../integrations/integration-store.js";
import type { EncryptedCredential } from "../integrations/credential-cipher.js";
import { ConflictError, DomainValidationError, NotFoundError } from "../domain/errors.js";
import { lockPersonEvidenceMutation } from "./source-reference-repository.js";

/** Internal persisted cutover authority; external IDs and credentials are deliberately absent. */
export type CutoverRecord = typeof integrationCutovers.$inferSelect;
/** Read-only preflight context; the HTTP adapter must project only safe public fields. */
export interface CutoverPreviewContext {
  readonly source: typeof integrationConnections.$inferSelect;
  readonly sourceExternalUserId: string;
  readonly timezone: string;
  readonly startsOn: string;
  readonly startsAt: Date;
  readonly sourceDrainsUntil: Date;
  readonly expectedRevision: string;
  readonly usedCapabilities: readonly string[];
}
/** A fully verified candidate key is encrypted before entering this atomic persistence boundary. */
export interface ScheduleCutoverInput {
  readonly targetConnectionId: string;
  readonly targetRecoveryConnectionId: string;
  readonly targetConsentId: string;
  readonly expectedVersion?: number;
  readonly startsOn: string;
  readonly expectedRevision: string;
  readonly dedupeKey: string;
  readonly credential: EncryptedCredential;
  readonly externalUserId: string | null;
  readonly capabilityVersion: string;
  readonly acceptedCoverageGaps: readonly string[];
}

/** Missing durable policy acknowledgement leaves the pre-activation source authoritative. */
export class CutoverJournalProofRequiredError extends ConflictError {
  public constructor() { super("Cutover policy has no durable journal proof"); this.name = "CutoverJournalProofRequiredError"; }
}

/** Atomic pending-key lifecycle and future-only authority inside the existing API database. */
export class IntegrationCutoverRepository {
  public constructor(private readonly database: DatabaseContext) {}

  /** Computes the earliest non-overlapping local date using PostgreSQL timezone/calendar rules. */
  public preview(personId: string, startsOn?: string): Promise<CutoverPreviewContext> {
    return this.database.db.transaction(async (transaction) => {
      await lockPersonEvidenceMutation(transaction, personId);
      return this.previewInTransaction(transaction, personId, startsOn);
    });
  }

  /** Reads the newest local transition without touching credentials or the remote provider. */
  public async find(personId: string): Promise<CutoverRecord | null> {
    return await this.database.db.query.integrationCutovers.findFirst({ where: eq(integrationCutovers.personId, personId), orderBy: [desc(integrationCutovers.createdAt), desc(integrationCutovers.id)] }) ?? null;
  }

  /** Returns an encrypted pending key only to the cutover coordinator, never to a diagnostic/public projection. */
  public async pendingTarget(personId: string): Promise<ActiveIntegrationConnection | null> {
    const cutover = await this.find(personId);
    if (!cutover?.targetConnectionId || !["scheduled", "failed"].includes(cutover.state)) return null;
    const row = await this.database.db.query.integrationConnections.findFirst({ where: and(eq(integrationConnections.id, cutover.targetConnectionId), eq(integrationConnections.personId, personId), eq(integrationConnections.providerKey, "garmin_personal")) });
    if (!row?.credentialKeyId || !row.credentialNonce || !row.credentialCiphertext || !row.credentialTag) return null;
    return { id: row.id, personId, recoveryConnectionId: row.recoveryConnectionId, consentId: row.consentId,
      credential: { keyId: row.credentialKeyId, nonce: row.credentialNonce, ciphertext: row.credentialCiphertext, tag: row.credentialTag },
      historicalImportStatus: row.historicalImportStatus, historicalCursorBefore: row.historicalCursorBefore,
      historicalScopeFromDate: row.historicalScopeFromDate, historicalNextAttemptAt: row.historicalNextAttemptAt };
  }

  /** Persists one preflight-verified pending target; stale structural revisions and active policies are rejected. */
  public schedule(personId: string, input: ScheduleCutoverInput): Promise<CutoverRecord> {
    return this.writeSchedule(personId, input, false);
  }

  /** Reschedules only a never-activated failed policy after new preview/CAS validation. */
  public retry(personId: string, input: ScheduleCutoverInput): Promise<CutoverRecord> {
    return this.writeSchedule(personId, input, true);
  }

  private writeSchedule(personId: string, input: ScheduleCutoverInput, retry: boolean): Promise<CutoverRecord> {
    return this.database.db.transaction(async (transaction) => {
      await lockPersonEvidenceMutation(transaction, personId);
      const current = await this.latest(transaction, personId);
      if (current?.dedupeKey === input.dedupeKey && current.state === "scheduled") {
        if (current.startsOn !== input.startsOn || current.capabilityVersion !== input.capabilityVersion || [...current.acceptedCoverageGaps].sort().join() !== [...input.acceptedCoverageGaps].sort().join()) throw new ConflictError("Cutover request identity changed");
        return current;
      }
      if (current?.restoreSuppressed) throw new ConflictError("Restored cutover requires approved operational recovery");
      if (current && (current.activatedAt || ["scheduled", "draining", "active"].includes(current.state))) throw new ConflictError("A forward-only cutover already exists");
      if (!retry && current?.state === "failed") throw new ConflictError("Failed cutover requires explicit retry");
      if (retry && current?.version !== input.expectedVersion) throw new ConflictError("Cutover version changed");
      if (retry && current?.state !== "failed") throw new ConflictError("Only a failed cutover can be retried");
      const preview = await this.previewInTransaction(transaction, personId, input.startsOn);
      if (preview.expectedRevision !== input.expectedRevision) throw new ConflictError("Cutover preview is stale");
      const previousTarget = await transaction.query.integrationConnections.findFirst({ where: and(eq(integrationConnections.personId, personId), eq(integrationConnections.providerKey, "garmin_personal")) });
      if (previousTarget) {
        const facts = await transaction.execute(sql`select 1 where exists (select 1 from recovery_observations where connection_id = ${previousTarget.recoveryConnectionId}) or exists (select 1 from integration_activity_facts where connection_id = ${previousTarget.id})`);
        if (facts.rowCount || previousTarget.importEnabled) throw new ConflictError("Target already contains imported evidence");
        const erased = await transaction.query.recoveryConnections.findFirst({ where: eq(recoveryConnections.id, previousTarget.recoveryConnectionId) });
        if (!erased || erased.erasureRequestedAt) throw new ConflictError("Target erasure is pending");
      }
      if (previousTarget && (previousTarget.id !== input.targetConnectionId || previousTarget.recoveryConnectionId !== input.targetRecoveryConnectionId)) throw new ConflictError("Target connection identity changed");
      const targetId = input.targetConnectionId;
      const targetRecoveryId = input.targetRecoveryConnectionId;
      const consentId = input.targetConsentId;
      const providerRows = await transaction.insert(recoveryProviders).values({ key: "garmin_personal", name: "Garmin" }).onConflictDoNothing().returning();
      const provider = providerRows[0] ?? await transaction.query.recoveryProviders.findFirst({ where: eq(recoveryProviders.key, "garmin_personal") });
      if (!provider) throw new ConflictError("Garmin provider is unavailable");
      if (!previousTarget) await transaction.insert(recoveryConnections).values({ id: targetRecoveryId, personId, providerId: provider.id, dedupeKey: `garmin_personal:${targetRecoveryId}` });
      else {
        await transaction.update(recoveryConnections).set({ status: "active", disconnectedAt: null }).where(eq(recoveryConnections.id, targetRecoveryId));
        await transaction.update(recoveryConsents).set({ status: "revoked", revokedAt: sql`clock_timestamp()`, revocationReason: "Pending cutover authorization replaced" }).where(and(eq(recoveryConsents.id, previousTarget.consentId), eq(recoveryConsents.status, "active")));
      }
      await transaction.insert(recoveryConsents).values({ id: consentId, personId, connectionId: targetRecoveryId, purpose: "Import Recovery, Training, Physical State and Nutrition from Garmin Personal after forward-only transition", integrationImportScopes: ["recovery", "training", "physical_state", "nutrition"], retentionMode: "indefinite" });
      await transaction.insert(recoveryConsentKinds).values([{ consentId, kind: "sleep" }, { consentId, kind: "metric" }]);
      if (previousTarget?.externalUserId && input.externalUserId && previousTarget.externalUserId !== input.externalUserId) throw new ConflictError("Garmin account identity changed");
      const values = { consentId, externalUserId: input.externalUserId ?? previousTarget?.externalUserId ?? null, lifecycle: "active" as const, importEnabled: false,
        credentialKeyId: input.credential.keyId, credentialNonce: input.credential.nonce, credentialCiphertext: input.credential.ciphertext, credentialTag: input.credential.tag,
        failureCode: null, disconnectedAt: null, remoteDisconnectPending: false, leaseOwner: null, leaseUntil: null,
        historicalScopeFromDate: preview.startsOn, historicalImportStatus: "not_requested" as const,
        historicalCursorBefore: null, historicalRequestedAt: null, historicalLastAttemptAt: null, historicalCompletedAt: null,
        historicalNextAttemptAt: null, historicalFailureCode: null, historicalClaimToken: null, historicalClaimUntil: null, updatedAt: sql`clock_timestamp()` };
      if (previousTarget) await transaction.update(integrationConnections).set(values).where(eq(integrationConnections.id, targetId));
      else await transaction.insert(integrationConnections).values({ id: targetId, personId, recoveryConnectionId: targetRecoveryId, providerKey: "garmin_personal", ...values });
      const policy = { sourceConnectionId: preview.source.id, sourceRecoveryConnectionId: preview.source.recoveryConnectionId, sourceConsentId: preview.source.consentId,
        targetConnectionId: targetId, targetRecoveryConnectionId: targetRecoveryId, targetConsentId: consentId,
        startsOn: preview.startsOn, timezone: preview.timezone, startsAt: preview.startsAt, sourceDrainsUntil: preview.sourceDrainsUntil,
        capabilityVersion: input.capabilityVersion, acceptedCoverageGaps: [...input.acceptedCoverageGaps], dedupeKey: input.dedupeKey,
        policyJournalHash: null, policyJournalAt: null, state: "scheduled" as const, actorPersonId: personId, failureCode: null, cancelledAt: null, updatedAt: sql`clock_timestamp()` };
      const rows = retry && current
        ? await transaction.update(integrationCutovers).set({ ...policy, version: current.version + 1 }).where(eq(integrationCutovers.id, current.id)).returning()
        : await transaction.insert(integrationCutovers).values({ personId, ...policy }).returning();
      if (!rows[0]) throw new ConflictError("Cutover schedule was not stored");
      return rows[0];
    });
  }

  /** Clears pending credentials and consent; an activated transition can never be cancelled. */
  public cancel(personId: string, expectedVersion: number, reason: string): Promise<CutoverRecord> {
    return this.database.db.transaction(async (transaction) => {
      await lockPersonEvidenceMutation(transaction, personId);
      const row = await this.latest(transaction, personId);
      if (!row) throw new NotFoundError("Cutover was not found");
      if (row.restoreSuppressed) throw new ConflictError("Restored cutover requires approved operational recovery");
      if (row.state === "cancelled") return row;
      if (row.version !== expectedVersion || !["scheduled", "failed"].includes(row.state)) throw new ConflictError("Cutover has already taken effect or changed");
      await this.disableTarget(transaction, row, true, reason);
      const rows = await transaction.update(integrationCutovers).set({ state: "cancelled", cancelledAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()`, version: row.version + 1, failureCode: null }).where(eq(integrationCutovers.id, row.id)).returning();
      return rows[0]!;
    });
  }

  /** Selects one due transition; activation uses CAS, so duplicate coordinator probes cannot activate twice. */
  public async nextDue(): Promise<CutoverRecord | null> {
    return await this.database.db.query.integrationCutovers.findFirst({
      where: sql`${integrationCutovers.restoreSuppressed} = false AND ((${integrationCutovers.state} = 'scheduled' AND ${integrationCutovers.startsAt} <= clock_timestamp()) OR (${integrationCutovers.state} = 'draining' AND ${integrationCutovers.sourceDrainsUntil} <= clock_timestamp()))`,
      orderBy: [integrationCutovers.startsAt, integrationCutovers.id]
    }) ?? null;
  }

  /** Commits disjoint authority after key preflight, checking DB time, ownership, timezone and generations under lock. */
  public activate(id: string, version: number): Promise<CutoverRecord> {
    return this.database.db.transaction(async (transaction) => {
      const row = await this.ownedLocked(transaction, id, version);
      if (row.restoreSuppressed) throw new ConflictError("Restored cutover requires approved operational recovery");
      if (row.state !== "scheduled") throw new ConflictError("Cutover is not scheduled");
      if (!row.policyJournalAt || row.policyJournalHash !== immutableCutoverPolicyHash(row)) throw new CutoverJournalProofRequiredError();
      const clock = await transaction.execute(sql<{ now: Date }>`select clock_timestamp() as now`);
      const now = new Date(clock.rows[0]!.now as Date);
      if (now < row.startsAt) throw new ConflictError("Cutover date has not arrived");
      const person = await transaction.query.persons.findFirst({ where: eq(persons.id, row.personId) });
      if (person?.timezone !== row.timezone) throw new ConflictError("Person timezone changed before activation");
      for (const [connectionId, consentId, recoveryId, providerKey] of [[row.sourceConnectionId, row.sourceConsentId, row.sourceRecoveryConnectionId, "intervals_icu"], [row.targetConnectionId, row.targetConsentId, row.targetRecoveryConnectionId, "garmin_personal"]] as const) {
        if (!connectionId || !consentId || !recoveryId) throw new ConflictError("Cutover connection was erased");
        const connection = await transaction.query.integrationConnections.findFirst({ where: and(eq(integrationConnections.id, connectionId), eq(integrationConnections.personId, row.personId), eq(integrationConnections.providerKey, providerKey), eq(integrationConnections.consentId, consentId), eq(integrationConnections.recoveryConnectionId, recoveryId)) });
        const recovery = await transaction.query.recoveryConnections.findFirst({ where: and(eq(recoveryConnections.id, recoveryId), eq(recoveryConnections.personId, row.personId)) });
        const consent = await transaction.query.recoveryConsents.findFirst({ where: and(eq(recoveryConsents.id, consentId), eq(recoveryConsents.personId, row.personId), eq(recoveryConsents.status, "active")) });
        if (!connection || !connection.credentialCiphertext || !recovery || recovery.erasureRequestedAt || recovery.status !== "active" || !consent || (providerKey === "intervals_icu" && !connection.importEnabled)) throw new ConflictError("Cutover connection is no longer authorized");
      }
      await transaction.update(integrationConnections).set({ importEnabled: true, lifecycle: "active", nextAttemptAt: now, historicalScopeFromDate: row.startsOn,
        historicalImportStatus: "running", historicalCursorBefore: null, historicalRequestedAt: now, historicalNextAttemptAt: now,
        historicalLastAttemptAt: null, historicalCompletedAt: null, historicalFailureCode: null, historicalClaimToken: null, historicalClaimUntil: null,
        updatedAt: now }).where(eq(integrationConnections.id, row.targetConnectionId!));
      const active = now >= row.sourceDrainsUntil;
      if (active) await this.stopSource(transaction, row);
      const rows = await transaction.update(integrationCutovers).set({ state: active ? "active" : "draining", activatedAt: now, lastAttemptAt: now, updatedAt: now, version: row.version + 1 }).where(eq(integrationCutovers.id, id)).returning();
      return rows[0]!;
    });
  }

  /** Releases provisional fences only after atomically proving that target never wrote facts. */
  public failBeforeActivation(id: string, version: number, failureCode: string): Promise<CutoverRecord> {
    return this.database.db.transaction(async (transaction) => {
      const row = await this.ownedLocked(transaction, id, version);
      if (row.restoreSuppressed) throw new ConflictError("Restored cutover requires approved operational recovery");
      if (row.state !== "scheduled") throw new ConflictError("Activated cutover cannot roll back");
      await this.disableTarget(transaction, row, false, "Cutover activation failed");
      const rows = await transaction.update(integrationCutovers).set({ state: "failed", lastAttemptAt: sql`clock_timestamp()`, failureCode: failureCode.slice(0, 64), updatedAt: sql`clock_timestamp()`, version: row.version + 1 }).where(eq(integrationCutovers.id, id)).returning();
      return rows[0]!;
    });
  }

  /** Stops and revokes the source at its immutable deadline before any bounded remote cleanup. */
  public finishDrain(id: string, version: number): Promise<CutoverRecord> {
    return this.database.db.transaction(async (transaction) => {
      const row = await this.ownedLocked(transaction, id, version);
      if (row.state !== "draining") throw new ConflictError("Cutover is not draining");
      const clock = await transaction.execute(sql<{ now: Date }>`select clock_timestamp() as now`);
      if (new Date(clock.rows[0]!.now as Date) < row.sourceDrainsUntil) throw new ConflictError("Source drain has not ended");
      await this.stopSource(transaction, row);
      const rows = await transaction.update(integrationCutovers).set({ state: "active", lastAttemptAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()`, version: row.version + 1 }).where(eq(integrationCutovers.id, id)).returning();
      return rows[0]!;
    });
  }

  /** Drops cutover-source secrets after five attempts or one hour, even when its transport is unconfigured. */
  public async cleanupExpiredRevocations(): Promise<number> {
    const candidates = await this.database.db.select({ id: integrationCutovers.id, personId: integrationCutovers.personId }).from(integrationCutovers)
      .innerJoin(integrationConnections, eq(integrationCutovers.sourceConnectionId, integrationConnections.id))
      .where(and(inArray(integrationCutovers.state, ["active", "draining"]), eq(integrationConnections.remoteDisconnectPending, true),
        sql`(${integrationConnections.remoteDisconnectAttempts} >= 5 OR ${integrationConnections.disconnectedAt} <= clock_timestamp() - interval '1 hour')`)).limit(100);
    let count = 0;
    for (const candidate of candidates) await this.database.db.transaction(async (transaction) => {
      await lockPersonEvidenceMutation(transaction, candidate.personId);
      const row = await transaction.query.integrationCutovers.findFirst({ where: eq(integrationCutovers.id, candidate.id) });
      if (!row?.sourceConnectionId || !row.sourceConsentId) return;
      const stopped = await transaction.execute(sql`update integration_connections set remote_disconnect_pending=false, remote_revoke_unconfirmed=true,
        credential_key_id=null,credential_nonce=null,credential_ciphertext=null,credential_tag=null,lease_owner=null,lease_until=null,updated_at=clock_timestamp()
        where id=${row.sourceConnectionId} and person_id=${row.personId} and consent_id=${row.sourceConsentId} and import_enabled=false and remote_disconnect_pending=true
        and (remote_disconnect_attempts >= 5 or disconnected_at <= clock_timestamp() - interval '1 hour') returning id`);
      if (!stopped.rowCount) return;
      await transaction.update(integrationCutovers).set({ sourceRevocationUnconfirmed: true, lastAttemptAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()`, version: row.version + 1 }).where(eq(integrationCutovers.id, row.id));
      count++;
    });
    return count;
  }

  private async stopSource(transaction: DatabaseTransaction, row: CutoverRecord): Promise<void> {
    if (!row.sourceConnectionId || !row.sourceConsentId) return;
    await transaction.execute(sql`update integration_connections set import_enabled=false, lifecycle='disconnected', disconnected_at=clock_timestamp(), remote_disconnect_pending=(credential_ciphertext is not null), remote_disconnect_attempts=0, remote_revoke_unconfirmed=false, next_attempt_at=clock_timestamp(), lease_owner=null, lease_until=null,
      historical_import_status=case when historical_import_status='running' then 'failed'::integration_historical_import_status else historical_import_status end,
      historical_failure_code=case when historical_import_status='running' then 'cutover_source_stopped'::integration_sync_failure else historical_failure_code end,
      historical_next_attempt_at=case when historical_import_status='running' then null else historical_next_attempt_at end,
      historical_claim_token=null,historical_claim_until=null,updated_at=clock_timestamp()
      where id=${row.sourceConnectionId} and person_id=${row.personId} and consent_id=${row.sourceConsentId}`);
    if (row.sourceRecoveryConnectionId) await transaction.update(recoveryConnections).set({ status: "disconnected", disconnectedAt: sql`clock_timestamp()` }).where(and(eq(recoveryConnections.id, row.sourceRecoveryConnectionId), eq(recoveryConnections.personId, row.personId)));
    await transaction.update(recoveryConsents).set({ status: "revoked", revokedAt: sql`clock_timestamp()`, revocationReason: "Cutover source drain ended" }).where(and(eq(recoveryConsents.id, row.sourceConsentId), eq(recoveryConsents.personId, row.personId), eq(recoveryConsents.status, "active")));
  }

  private async disableTarget(transaction: DatabaseTransaction, row: CutoverRecord, clearCredential: boolean, reason: string): Promise<void> {
    if (!row.targetConnectionId) return;
    const facts = await transaction.execute(sql`select 1 where exists(select 1 from integration_activity_facts where connection_id=${row.targetConnectionId}) or exists(select 1 from recovery_observations where connection_id=${row.targetRecoveryConnectionId})`);
    if (facts.rowCount) throw new ConflictError("Target already contains evidence; rollback is forbidden");
    await transaction.update(integrationConnections).set({ importEnabled: false, lifecycle: "disconnected", disconnectedAt: sql`clock_timestamp()`, remoteDisconnectPending: false,
      ...(clearCredential ? { credentialKeyId: null, credentialNonce: null, credentialCiphertext: null, credentialTag: null } : {}),
      leaseOwner: null, leaseUntil: null, updatedAt: sql`clock_timestamp()` }).where(and(eq(integrationConnections.id, row.targetConnectionId), eq(integrationConnections.personId, row.personId)));
    if (row.targetRecoveryConnectionId) await transaction.update(recoveryConnections).set({ status: "disconnected", disconnectedAt: sql`clock_timestamp()` }).where(eq(recoveryConnections.id, row.targetRecoveryConnectionId));
    if (row.targetConsentId) await transaction.update(recoveryConsents).set({ status: "revoked", revokedAt: sql`clock_timestamp()`, revocationReason: reason.slice(0, 256) }).where(eq(recoveryConsents.id, row.targetConsentId));
  }

  private async ownedLocked(transaction: DatabaseTransaction, id: string, version: number): Promise<CutoverRecord> {
    const initial = await transaction.query.integrationCutovers.findFirst({ where: eq(integrationCutovers.id, id) });
    if (!initial) throw new NotFoundError("Cutover was not found");
    await lockPersonEvidenceMutation(transaction, initial.personId);
    const row = await transaction.query.integrationCutovers.findFirst({ where: eq(integrationCutovers.id, id) });
    if (!row || row.version !== version) throw new ConflictError("Cutover version changed");
    return row;
  }

  private async latest(transaction: DatabaseTransaction, personId: string): Promise<CutoverRecord | undefined> {
    return transaction.query.integrationCutovers.findFirst({ where: eq(integrationCutovers.personId, personId), orderBy: [desc(integrationCutovers.createdAt), desc(integrationCutovers.id)] });
  }

  private async previewInTransaction(transaction: DatabaseTransaction, personId: string, requested?: string): Promise<CutoverPreviewContext> {
    const source = await transaction.query.integrationConnections.findFirst({ where: and(eq(integrationConnections.personId, personId), eq(integrationConnections.providerKey, "intervals_icu")) });
    const person = await transaction.query.persons.findFirst({ where: eq(persons.id, personId) });
    if (!source?.importEnabled || !source.externalUserId || !source.credentialCiphertext || !person?.timezone) throw new ConflictError("An authorized Intervals connection and Person timezone are required");
    try { new Intl.DateTimeFormat("en", { timeZone: person.timezone }).format(); } catch { throw new DomainValidationError("Person timezone is invalid"); }
    if (requested !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(requested)) throw new DomainValidationError("Cutover date is invalid");
    const dates = await transaction.execute(sql<{ earliest: string; factsRevision: string }>`
      select (greatest((clock_timestamp() at time zone ${person.timezone})::date,
        (select max(local_date) from recovery_observations where connection_id=${source.recoveryConnectionId}),
        (select max((occurred_at at time zone ${person.timezone})::date) from integration_activity_facts where connection_id=${source.id})) + 1)::text as earliest,
        concat((select count(*) from recovery_observations where connection_id=${source.recoveryConnectionId}), ':',
          (select coalesce(max(created_at)::text,'') from recovery_observations where connection_id=${source.recoveryConnectionId}), ':',
          (select count(*) from integration_activity_facts where connection_id=${source.id}), ':',
          (select coalesce(max(created_at)::text,'') from integration_activity_facts where connection_id=${source.id})) as "factsRevision"
    `);
    const earliest = dates.rows[0]!.earliest as string;
    const startsOn = requested ?? earliest;
    if (startsOn < earliest) throw new ConflictError("Cutover date must follow all existing source evidence and today");
    const instants = await transaction.execute(sql<{ startsAt: Date; drains: Date; roundtrip: string }>`select (${startsOn}::date::timestamp at time zone ${person.timezone}) as "startsAt", ((${startsOn}::date + 14)::timestamp at time zone ${person.timezone}) as drains, ((${startsOn}::date::timestamp at time zone ${person.timezone}) at time zone ${person.timezone})::date::text as roundtrip`);
    if (instants.rows[0]!.roundtrip !== startsOn) throw new ConflictError("Requested local day does not exist in this timezone");
    const orphan = await transaction.execute(sql`select 1 from recovery_observations o join source_references r on r.id=o.source_reference_id where o.connection_id=${source.recoveryConnectionId} and r.external_system like '%activity_fit%' and not exists(select 1 from integration_activity_facts a where a.connection_id=${source.id} and a.provider_identity=substring(r.external_record_id from '^(.*):140[.]9:[0-9a-f]{64}$')) limit 1`);
    if (orphan.rowCount) throw new ConflictError("Existing FIT evidence has no confirmed parent activity");
    const used = await transaction.execute(sql<{ capability: string }>`
      select distinct case m.metric::text when 'hrv_rmssd' then 'recovery.hrv_rmssd' when 'sleep_score' then 'recovery.sleep_score' end as capability
      from recovery_observations o join recovery_metric_details m on m.observation_id=o.id where o.connection_id=${source.recoveryConnectionId} and m.metric::text in ('hrv_rmssd','sleep_score')
      union select 'training.normalized_load' where exists(select 1 from integration_activity_facts where connection_id=${source.id} and training_load is not null)
      union select 'training.device_attribution' where exists(select 1 from integration_activity_facts where connection_id=${source.id} and garmin_attributed=true)
      union select 'training.original_fit' where exists(select 1 from external_activity_details where connection_id=${source.id} and payload is not null)
    `);
    const current = await this.latest(transaction, personId);
    const expectedRevision = createHash("sha256").update(JSON.stringify({ sourceId: source.id, consent: source.consentId, externalUserId: source.externalUserId, importEnabled: source.importEnabled, usedCapabilities: used.rows.map((item) => item.capability as string).filter(Boolean).sort(), timezone: person.timezone, startsOn, currentId: current?.id ?? null, currentVersion: current?.version ?? null })).digest("hex");
    return { source, sourceExternalUserId: source.externalUserId, timezone: person.timezone, startsOn,
      startsAt: new Date(instants.rows[0]!.startsAt as Date), sourceDrainsUntil: new Date(instants.rows[0]!.drains as Date), expectedRevision,
      usedCapabilities: used.rows.map((row) => row.capability as string).filter(Boolean).sort() };
  }
}
