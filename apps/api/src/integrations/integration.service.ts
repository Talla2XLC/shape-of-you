import { createHash, randomBytes, randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import type {
  DisconnectIntegration,
  GarminIntervalsConnection,
  IntegrationAuthorizationStart,
  StartGarminIntervalsAuthorization,
  CreateRecoveryObservation,
  RecoveryObservationDetail
} from "@shape-of-you/contracts";

import { PERSON_CONTEXT, INTEGRATION_CIPHER, INTEGRATION_PROVIDER, INTEGRATION_STORE, RECOVERY_STORE, TRAINING_STORE } from "../application/tokens.js";
import type { PersonContext } from "../application/person-context.js";
import type { RecoveryStore } from "../storage/recovery-repository.js";
import type { TrainingStore } from "../storage/training-repository.js";
import type { ConnectionCredentialCipher } from "./credential-cipher.js";
import type { ActiveIntegrationConnection, IntegrationStore } from "./integration-store.js";
import type { HealthDataProvider, ProviderWellnessRecord } from "./provider.js";
import { IntegrationProviderError } from "./provider.js";
import { normalizedChecksum } from "./intervals-icu/normalizer.js";
import { parseGarminRecoverySnapshot } from "./intervals-icu/fit-recovery.js";
import { ConflictError, DomainValidationError } from "../domain/errors.js";

const transactionTtlMs = 10 * 60_000;
const reconciliationWindowDays = 14;
const historicalWindowDays = 180;
const historicalLowerBound = "2000-01-01";
const historicalClaimLeaseMs = 30 * 60_000;
const maxFitDownloadsPerPass = 20;
const fitFactKey = "garmin_post_activity_recovery_time";

/** Coordinates OAuth, typed import, disconnect and sync state inside the API. */
@Injectable()
export class IntegrationService {
  public constructor(
    @Inject(PERSON_CONTEXT) private readonly personContext: PersonContext,
    @Inject(INTEGRATION_STORE) private readonly store: IntegrationStore | null,
    @Inject(INTEGRATION_PROVIDER) private readonly provider: HealthDataProvider | null,
    @Inject(INTEGRATION_CIPHER) private readonly cipher: ConnectionCredentialCipher | null,
    @Inject(RECOVERY_STORE) private readonly recovery: RecoveryStore,
    @Inject(TRAINING_STORE) private readonly training: TrainingStore
  ) {}

  /** Returns only the safe browser projection, including feature unavailability. */
  public async status(): Promise<GarminIntervalsConnection> {
    if (!this.store || !this.provider || !this.cipher) return unavailableStatus();
    return await this.store.status(this.personContext.getPersonId()) ?? unavailableStatus("disconnected");
  }

  /** Creates a short-lived, Person-bound, one-use authorization transaction. */
  public async start(input: StartGarminIntervalsAuthorization): Promise<IntegrationAuthorizationStart> {
    this.assertEnabled();
    if (!isSafeReturnTo(input.returnTo)) throw new DomainValidationError("Integration return path is invalid");
    const state = randomBytes(32).toString("base64url");
    await this.store!.createAuthorization(
      this.personContext.getPersonId(),
      stateHash(state),
      input.returnTo,
      new Date(Date.now() + transactionTtlMs)
    );
    return { authorizationUrl: this.provider!.authorizationUrl(state) };
  }

  /** Consumes OAuth state exactly once, exchanges code server-side and encrypts the Person token. */
  public async completeAuthorization(state: string, code: string): Promise<string> {
    this.assertEnabled();
    if (!state || state.length > 256 || !code || code.length > 4096) throw new IntegrationProviderError("authorization_required");
    const transaction = await this.store!.consumeAuthorization(stateHash(state), new Date());
    if (!transaction) throw new IntegrationProviderError("authorization_required");
    const authorization = await this.provider!.exchangeAuthorizationCode(code);
    const existingIdentity = await this.store!.authorizationIdentity(transaction.personId);
    const id = existingIdentity?.id ?? randomUUID();
    const recoveryConnectionId = existingIdentity?.recoveryConnectionId ?? randomUUID();
    const consentId = randomUUID();
    const credential = this.cipher!.encrypt(authorization.accessToken, associatedData(transaction.personId, id));
    await this.store!.activate({ id, recoveryConnectionId, consentId, personId: transaction.personId, externalUserId: authorization.externalUserId, credential, authorizationStartedAt: transaction.createdAt });
    return transaction.returnTo;
  }

  /** Consumes a denied/error OAuth transaction so its state cannot be replayed. */
  public async denyAuthorization(state: string): Promise<void> {
    this.assertEnabled();
    if (!state || state.length > 256) throw new IntegrationProviderError("authorization_required");
    const transaction = await this.store!.consumeAuthorization(stateHash(state), new Date());
    if (!transaction) throw new IntegrationProviderError("authorization_required");
  }

  /** Stops local import before attempting remote revocation; facts remain available. */
  public async disconnect(input: DisconnectIntegration): Promise<GarminIntervalsConnection> {
    this.assertEnabled();
    const personId = this.personContext.getPersonId();
    const connection = await this.store!.beginDisconnect(personId, input.reason);
    if (connection) {
      try {
        const token = this.cipher!.decrypt(connection.credential, associatedData(connection.personId, connection.id));
        await this.provider!.disconnect(token);
        await this.store!.completeRemoteDisconnect(connection.id);
      } catch (error) {
        const code = error instanceof IntegrationProviderError ? error.failureCode : "provider_unavailable";
        await this.store!.failRemoteDisconnect(connection.id, code);
      }
    }
    return await this.store!.status(personId) ?? unavailableStatus("disconnected");
  }

  /** Starts or resumes the current Person's explicitly requested historical import. */
  public async startHistoricalImport(): Promise<GarminIntervalsConnection> {
    this.assertEnabled();
    const personId = this.personContext.getPersonId();
    if (!await this.store!.startHistoricalImport(personId)) {
      throw new ConflictError("An active Intervals.icu connection is required");
    }
    return await this.store!.status(personId) ?? unavailableStatus("disconnected");
  }

  /** Reconciles one Person connection; provider failures only degrade sync state. */
  public async reconcilePerson(personId: string): Promise<void> {
    this.assertEnabled();
    const connection = await this.store!.findActive(personId);
    if (connection) await this.reconcileConnection(connection);
  }

  /** Revokes provider access before journal-backed local erasure may complete. */
  public async prepareErasure(personId: string, recoveryConnectionId: string): Promise<void> {
    if (!this.store) return;
    const connection = await this.store.findForErasure(personId, recoveryConnectionId);
    if (!connection) return;
    if (!this.provider || !this.cipher) throw new IntegrationProviderError("provider_unavailable");
    const token = this.cipher.decrypt(connection.credential, associatedData(connection.personId, connection.id));
    await this.provider.disconnect(token);
    await this.store.completeRemoteDisconnect(connection.id);
  }

  /** Retries a previously durable local disconnect without enabling import. */
  public async retryRemoteDisconnect(connection: ActiveIntegrationConnection): Promise<void> {
    try {
      const token = this.cipher!.decrypt(connection.credential, associatedData(connection.personId, connection.id));
      await this.provider!.disconnect(token);
      await this.store!.completeRemoteDisconnect(connection.id);
    } catch (error) {
      const code = error instanceof IntegrationProviderError ? error.failureCode : "provider_unavailable";
      await this.store!.failRemoteDisconnect(connection.id, code);
    }
  }

  /** Reconciles one already-claimed connection for the in-process worker. */
  public async reconcileConnection(connection: ActiveIntegrationConnection): Promise<void> {
    try {
      const token = this.cipher!.decrypt(connection.credential, associatedData(connection.personId, connection.id));
      const today = new Date();
      const from = new Date(today.valueOf() - reconciliationWindowDays * 86_400_000);
      const rollingFrom = isoDate(from);
      const fitBudget = { remaining: maxFitDownloadsPerPass };
      const rolling = await this.reconcileRange(connection, token, rollingFrom, isoDate(today), fitBudget);
      await this.training.reconcileRecentActivityLinks(connection.personId, rollingFrom, isoDate(today));
      if (rolling.complete) {
        await this.store!.markSyncSucceeded(connection.id, connection.consentId, rolling.changed);
      } else {
        await this.store!.markSyncPartial(connection.id, connection.consentId);
      }

      if (
        rolling.complete
        &&
        connection.historicalImportStatus === "running"
        && (!connection.historicalNextAttemptAt || connection.historicalNextAttemptAt <= today)
      ) {
        await this.reconcileHistoricalWindow(connection, token, rollingFrom, fitBudget);
      }
    } catch (error) {
      const failure = error instanceof IntegrationProviderError ? error.failureCode : "provider_unavailable";
      await this.store!.markSyncFailed(connection.id, connection.consentId, failure);
    } finally {
      await this.store!.releaseClaim(connection.id);
    }
  }

  private async reconcileHistoricalWindow(
    connection: ActiveIntegrationConnection,
    token: string,
    rollingFrom: string,
    fitBudget: { remaining: number }
  ): Promise<void> {
    const claimToken = randomUUID();
    const claim = await this.store!.claimHistoricalWindow(
      connection.id,
      connection.consentId,
      connection.historicalCursorBefore,
      claimToken,
      historicalClaimLeaseMs
    );
    if (!claim) return;
    const cursorBefore = claim.cursorBefore ?? rollingFrom;
    const newest = addDays(cursorBefore, -1);
    if (newest < historicalLowerBound) {
      await this.store!.markHistoricalWindowSucceeded(connection.id, claimToken, historicalLowerBound, true);
      return;
    }
    const candidateOldest = addDays(newest, -(historicalWindowDays - 1));
    const oldest = candidateOldest < historicalLowerBound ? historicalLowerBound : candidateOldest;
    try {
      const result = await this.reconcileRange(connection, token, oldest, newest, fitBudget);
      if (result.complete) {
        await this.store!.markHistoricalWindowSucceeded(connection.id, claimToken, oldest, oldest === historicalLowerBound);
      } else {
        await this.store!.deferHistoricalWindow(connection.id, claimToken);
      }
    } catch (error) {
      const failure = error instanceof IntegrationProviderError ? error.failureCode : "provider_unavailable";
      await this.store!.markHistoricalImportFailed(connection.id, claimToken, failure, isRetryableHistoryFailure(failure));
    }
  }

  private async reconcileRange(
    connection: ActiveIntegrationConnection,
    token: string,
    oldest: string,
    newest: string,
    fitBudget: { remaining: number }
  ): Promise<{ readonly changed: boolean; readonly complete: boolean }> {
    const result = await this.provider!.reconcile(token, oldest, newest);
    let changed = false;
    let timezone: string | null | undefined;
    for (const wellness of result.wellness) changed = await this.importWellness(connection, wellness) || changed;
    for (const activity of result.activities) {
      const activityChecksum = normalizedChecksum(Object.fromEntries(
        Object.entries(activity).filter(([key]) => key !== "fileType")
      ));
      // Recheck FIT once per UTC day because the original file can change without summary changes.
      const inboxChecksum = activity.fileType === "fit"
        ? normalizedChecksum({ activityChecksum, fitImportVersion: 1, fitReviewDate: isoDate(new Date()) })
        : activityChecksum;
      const inbox = await this.store!.recordInbox(connection.id, connection.consentId, "activity", activity.identity, inboxChecksum);
      if (inbox.state !== "process") continue;
      const needsFit = activity.fileType === "fit";
      if (needsFit && timezone === undefined) timezone = await this.store!.personTimezone(connection.personId);
      if (needsFit && timezone === null) return { changed, complete: false };
      if (needsFit && fitBudget.remaining === 0) return { changed, complete: false };
      const outcome = await this.training.importExternalActivity({
        connectionId: connection.id, personId: connection.personId, consentId: connection.consentId,
        providerIdentity: activity.identity, normalizedChecksum: activityChecksum,
        occurredAt: activity.occurredAt, localDate: activity.localDate, timezone: activity.timezone,
        name: activity.name, durationSeconds: activity.durationSeconds, distanceMeters: activity.distanceMeters,
        trainingLoad: activity.trainingLoad,
        trainingLoadBasis: activity.trainingLoadBasis,
        trainingLoadBasisVersion: activity.trainingLoadBasisVersion,
        averageHeartRate: activity.averageHeartRate,
        maximumHeartRate: activity.maximumHeartRate, deviceName: activity.deviceName,
        sourceProvider: "intervals_icu", garminAttributed: activity.garminAttributed
      });
      if (outcome === "stopped") continue;
      if (needsFit) {
        fitBudget.remaining--;
        changed = await this.importActivityRecovery(connection, token, activity.identity, inbox.receiptId, timezone!) || changed;
      }
      await this.store!.completeInbox(connection.id, connection.consentId, inbox.receiptId);
      changed = outcome !== "unchanged" || changed;
    }
    return { changed, complete: true };
  }

  private async importActivityRecovery(
    connection: ActiveIntegrationConnection,
    token: string,
    activityId: string,
    receiptId: string,
    timezone: string
  ): Promise<boolean> {
    const file = await this.provider!.originalActivityFile(token, activityId);
    if (file === null) return false;
    let snapshot: ReturnType<typeof parseGarminRecoverySnapshot>;
    try {
      snapshot = parseGarminRecoverySnapshot(file);
    } catch (error) {
      if (error instanceof IntegrationProviderError && error.failureCode === "provider_response_invalid") return false;
      throw error;
    }
    const current = await this.store!.recoveryFact(connection.id, activityId, fitFactKey);
    if (!snapshot) {
      if (!current || current.checksum === "removed") return false;
      const withdrawn = await this.recovery.withdrawObservation(
        connection.personId, current.observationId,
        `intervals:${activityId}:${fitFactKey}:removed:${current.observationId}`,
        "provider_field_removed",
        { connectionId: connection.recoveryConnectionId, consentId: connection.consentId }
      );
      await this.store!.linkRecoveryFact(connection.id, connection.consentId, activityId, receiptId, fitFactKey, "removed", withdrawn.observation.id);
      return withdrawn.created;
    }
    const fileChecksum = createHash("sha256").update(file).digest("hex");
    const checksum = normalizedChecksum({ fileChecksum, snapshot });
    if (current?.checksum === checksum) {
      await this.store!.linkRecoveryFact(connection.id, connection.consentId, activityId, receiptId, fitFactKey, checksum, current.observationId);
      return false;
    }
    const base: CreateRecoveryObservation = {
      kind: "metric", observedFrom: snapshot.observedAt, observedUntil: snapshot.observedAt,
      temporalPrecision: "instant", localDate: null, timezone, quality: "estimated",
      connectionId: connection.recoveryConnectionId, consentId: connection.consentId,
      dedupeKey: `intervals:${activityId}:${fitFactKey}:${checksum.slice(0, 16)}${current ? `:${current.observationId}` : ""}`,
      sourceReference: {
        channel: "account", externalSystem: "intervals_icu_activity_fit:garmin_140_9_v1",
        externalRecordId: `${activityId}:140.9:${fileChecksum}`, occurredAt: snapshot.observedAt
      },
      detail: { type: "metric", metric: fitFactKey, value: snapshot.minutes, unit: "minute" }
    };
    const persisted = current && current.checksum !== "removed"
      ? await this.recovery.correctObservation(connection.personId, current.observationId, { ...base, reason: "provider_record_changed" })
      : await this.recovery.createObservation(connection.personId, base);
    await this.store!.linkRecoveryFact(connection.id, connection.consentId, activityId, receiptId, fitFactKey, checksum, persisted.observation.id);
    return persisted.created;
  }

  private async importWellness(connection: ActiveIntegrationConnection, wellness: ProviderWellnessRecord): Promise<boolean> {
    const recordChecksum = normalizedChecksum(wellness);
    const inbox = await this.store!.recordInbox(connection.id, connection.consentId, "wellness", wellness.identity, recordChecksum);
    if (inbox.state !== "process") return false;
    const facts: readonly { readonly key: string; readonly detail: RecoveryObservationDetail }[] = [
      ...(wellness.totalSleepMinutes === null ? [] : [{ key: "sleep", detail: { type: "sleep" as const, totalSleepMinutes: wellness.totalSleepMinutes, sleepQuality: null } }]),
      ...metric("sleep_score", "score", wellness.sleepScore),
      ...metric("resting_heart_rate", "bpm", wellness.restingHeartRate),
      ...metric("night_heart_rate", "bpm", wellness.averageSleepingHeartRate),
      ...metric("hrv_rmssd", "ms", wellness.hrvRmssd),
      ...metric("oxygen_saturation", "percent", wellness.oxygenSaturation),
      ...metric("respiration_rate", "breaths_per_minute", wellness.respirationRate),
      ...metric("body_battery_min", "score", wellness.bodyBatteryMinimum),
      ...metric("body_battery_max", "score", wellness.bodyBatteryMaximum),
      ...metric("steps", "count", wellness.steps ?? null)
    ];
    let changed = false;
    for (const fact of facts) {
      const checksum = normalizedChecksum({ localDate: wellness.localDate, detail: fact.detail });
      const current = await this.store!.recoveryFact(connection.id, wellness.identity, fact.key);
      if (current?.checksum === checksum) {
        await this.store!.linkRecoveryFact(connection.id, connection.consentId, wellness.identity, inbox.receiptId, fact.key, checksum, current.observationId);
        continue;
      }
      const base: CreateRecoveryObservation = {
        kind: fact.detail.type,
        observedFrom: null,
        observedUntil: null,
        temporalPrecision: "local_date",
        localDate: wellness.localDate,
        timezone: wellness.timezone,
        quality: "reliable",
        connectionId: connection.recoveryConnectionId,
        consentId: connection.consentId,
        dedupeKey: `intervals:${wellness.identity}:${fact.key}:${checksum.slice(0, 16)}${current ? `:${current.observationId}` : ""}`,
        sourceReference: {
          channel: "account",
          externalSystem: "intervals_icu_wellness",
          externalRecordId: `${wellness.identity}:${fact.key}:${checksum}`,
          occurredAt: fact.key === "steps" ? wellness.updatedAt ?? null : null
        },
        detail: fact.detail
      };
      const persisted = current
        ? await this.recovery.correctObservation(connection.personId, current.observationId, { ...base, reason: "provider_record_changed" })
        : await this.recovery.createObservation(connection.personId, base);
      await this.store!.linkRecoveryFact(connection.id, connection.consentId, wellness.identity, inbox.receiptId, fact.key, checksum, persisted.observation.id);
      changed = persisted.created || changed;
    }
    const present = new Set(facts.map((fact) => fact.key));
    for (const factKey of [
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
    ] as const) {
      if (present.has(factKey)) continue;
      const current = await this.store!.recoveryFact(connection.id, wellness.identity, factKey);
      if (!current) continue;
      if (current.checksum === "removed") {
        await this.store!.linkRecoveryFact(connection.id, connection.consentId, wellness.identity, inbox.receiptId, factKey, "removed", current.observationId);
        continue;
      }
      const withdrawn = await this.recovery.withdrawObservation(
        connection.personId,
        current.observationId,
        `intervals:${wellness.identity}:${factKey}:removed:${current.observationId}`,
        "provider_field_removed",
        { connectionId: connection.recoveryConnectionId, consentId: connection.consentId }
      );
      await this.store!.linkRecoveryFact(connection.id, connection.consentId, wellness.identity, inbox.receiptId, factKey, "removed", withdrawn.observation.id);
      changed = withdrawn.created || changed;
    }
    await this.store!.completeInbox(connection.id, connection.consentId, inbox.receiptId);
    return changed;
  }

  private assertEnabled(): void {
    if (!this.store || !this.provider || !this.cipher) throw new DomainValidationError("Garmin via Intervals.icu is not configured");
  }
}

function metric(
  metricName: "sleep_score" | "resting_heart_rate" | "night_heart_rate" | "hrv_rmssd" | "oxygen_saturation" | "respiration_rate" | "body_battery_min" | "body_battery_max" | "steps",
  unit: "score" | "bpm" | "ms" | "percent" | "breaths_per_minute" | "count",
  value: number | null
): readonly { readonly key: string; readonly detail: RecoveryObservationDetail }[] {
  return value === null ? [] : [{ key: metricName, detail: { type: "metric", metric: metricName, value, unit } }];
}
function associatedData(personId: string, connectionId: string): string { return `intervals_icu:${personId}:${connectionId}`; }
function stateHash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function isoDate(value: Date): string { return value.toISOString().slice(0, 10); }
function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}
function isRetryableHistoryFailure(value: IntegrationProviderError["failureCode"]): boolean {
  return value === "provider_rate_limited" || value === "provider_timeout" || value === "provider_unavailable";
}
function isSafeReturnTo(value: string): boolean { return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !value.includes("#"); }
function unavailableStatus(lifecycle: "unavailable" | "disconnected" = "unavailable"): GarminIntervalsConnection {
  return {
    provider: "intervals_icu", displayName: "Garmin via Intervals.icu", recoveryConnectionId: null,
    lifecycle, failureCode: null, lastAttemptAt: null, lastSuccessfulSyncAt: null, lastDataAt: null,
    connectedAt: null, disconnectedAt: null,
    historicalImport: {
      status: "not_requested", processedThroughDate: null, requestedAt: null,
      lastAttemptAt: null, completedAt: null, failureCode: null
    }
  };
}
