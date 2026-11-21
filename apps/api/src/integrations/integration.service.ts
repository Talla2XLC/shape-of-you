import { createHash, randomBytes, randomUUID } from "node:crypto";

import { Inject, Injectable, Optional } from "@nestjs/common";
import type {
  DisconnectIntegration,
  GarminIntervalsConnection,
  IntegrationConnection,
  IntegrationAuthorizationStart,
  StartGarminIntervalsAuthorization,
  CreateRecoveryObservation,
  RecoveryObservationDetail,
  RecoveryMetric, RecoveryMetricUnit
} from "@shape-of-you/contracts";

import { CONNECTED_PROVIDER_DATA_STORE, INTEGRATION_IMPORT_CONTEXT, PERSON_CONTEXT, INTEGRATION_CIPHER, INTEGRATION_PROVIDER, INTEGRATION_STORE, RECOVERY_STORE, TRAINING_STORE } from "../application/tokens.js";
import type { PersonContext } from "../application/person-context.js";
import type { RecoveryStore } from "../storage/recovery-repository.js";
import type { ConnectedProviderRepository } from "../storage/connected-provider-repository.js";
import type { TrainingStore } from "../storage/training-repository.js";
import type { ConnectionCredentialCipher } from "./credential-cipher.js";
import type { ActiveIntegrationConnection, IntegrationImportPolicy, IntegrationStore } from "./integration-store.js";
import type { HealthDataProvider, HealthDataReader, ProviderWellnessRecord } from "./provider.js";
import { ActivityDetailsReadError, IntegrationProviderError } from "./provider.js";
import { normalizedChecksum } from "./intervals-icu/normalizer.js";
import { parseGarminRecoverySnapshot } from "./intervals-icu/fit-recovery.js";
import { parseFitActivityDetails, activityDetailsNormalizationVersion } from "./intervals-icu/fit-activity-details.js";
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
export class IntegrationService<Status extends IntegrationConnection = GarminIntervalsConnection> {
  public constructor(
    @Inject(PERSON_CONTEXT) private readonly personContext: PersonContext,
    @Inject(INTEGRATION_STORE) private readonly store: IntegrationStore<Status> | null,
    @Inject(INTEGRATION_PROVIDER) private readonly provider: HealthDataReader | null,
    @Inject(INTEGRATION_CIPHER) private readonly cipher: ConnectionCredentialCipher | null,
    @Inject(RECOVERY_STORE) private readonly recovery: RecoveryStore,
    @Inject(TRAINING_STORE) private readonly training: TrainingStore,
    @Optional() @Inject(INTEGRATION_IMPORT_CONTEXT) private readonly context: IntegrationImportContext = { providerKey: "intervals_icu", historicalWindowDays },
    @Optional() @Inject(CONNECTED_PROVIDER_DATA_STORE) private readonly connectedData: Pick<ConnectedProviderRepository, "importFitnessDay" | "importNutritionDay" | "importBodyMeasurement"> | null = null
  ) {}

  /** Indicates whether this coordinator can issue provider requests; policy cleanup needs no credentials. */
  public isConfigured(): boolean { return Boolean(this.store && this.provider && this.cipher); }

  /** Returns only the safe browser projection, including feature unavailability. */
  public async status(): Promise<Status> {
    if (!this.store || !this.provider || !this.cipher) return this.emptyStatus();
    return await this.store.status(this.personContext.getPersonId()) ?? this.emptyStatus("disconnected");
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
    return { authorizationUrl: this.oauthProvider().authorizationUrl(state) };
  }

  /** Consumes OAuth state exactly once, exchanges code server-side and encrypts the Person token. */
  public async completeAuthorization(state: string, code: string): Promise<string> {
    this.assertEnabled();
    if (!state || state.length > 256 || !code || code.length > 4096) throw new IntegrationProviderError("authorization_required");
    const transaction = await this.store!.consumeAuthorization(stateHash(state), new Date());
    if (!transaction) throw new IntegrationProviderError("authorization_required");
    const authorization = await this.oauthProvider().exchangeAuthorizationCode(code);
    const existingIdentity = await this.store!.authorizationIdentity(transaction.personId);
    const id = existingIdentity?.id ?? randomUUID();
    const recoveryConnectionId = existingIdentity?.recoveryConnectionId ?? randomUUID();
    const consentId = randomUUID();
    const credential = this.cipher!.encrypt(authorization.accessToken, associatedData(transaction.personId, id, this.context.providerKey));
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
  public async disconnect(input: DisconnectIntegration): Promise<Status> {
    this.assertEnabled();
    const personId = this.personContext.getPersonId();
    const connection = await this.store!.beginDisconnect(personId, input.reason);
    if (connection) {
      try {
        const token = this.cipher!.decrypt(connection.credential, associatedData(connection.personId, connection.id, this.context.providerKey));
        await this.oauthProvider().disconnect(token);
        await this.store!.completeRemoteDisconnect(connection.id, connection.consentId);
      } catch (error) {
        const code = error instanceof IntegrationProviderError ? error.failureCode : "provider_unavailable";
        await this.store!.failRemoteDisconnect(connection.id, code, connection.consentId);
      }
    }
    return await this.store!.status(personId) ?? this.emptyStatus("disconnected");
  }

  /** Starts or resumes the current Person's explicitly requested historical import. */
  public async startHistoricalImport(): Promise<Status> {
    this.assertEnabled();
    const personId = this.personContext.getPersonId();
    if (!await this.store!.startHistoricalImport(personId)) {
      throw new ConflictError(this.context.providerKey === "intervals_icu" ? "An active Intervals.icu connection is required" : "An active Garmin connection is required");
    }
    return await this.store!.status(personId) ?? this.emptyStatus("disconnected");
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
    const token = this.cipher.decrypt(connection.credential, associatedData(connection.personId, connection.id, this.context.providerKey));
    await this.oauthProvider().disconnect(token);
    await this.store.completeRemoteDisconnect(connection.id, connection.consentId);
  }

  /** Retries a previously durable local disconnect without enabling import. */
  public async retryRemoteDisconnect(connection: ActiveIntegrationConnection): Promise<void> {
    try {
      const token = this.cipher!.decrypt(connection.credential, associatedData(connection.personId, connection.id, this.context.providerKey));
      await this.oauthProvider().disconnect(token);
      await this.store!.completeRemoteDisconnect(connection.id, connection.consentId);
    } catch (error) {
      const code = error instanceof IntegrationProviderError ? error.failureCode : "provider_unavailable";
      await this.store!.failRemoteDisconnect(connection.id, code, connection.consentId);
    }
  }

  /** Reconciles one already-claimed connection for the in-process worker. */
  public async reconcileConnection(connection: ActiveIntegrationConnection): Promise<void> {
    try {
      const today = new Date();
      const policy = await this.store!.importPolicy?.(connection.id, connection.consentId) ?? null;
      if (policy && !policy.requestAllowed) throw new IntegrationProviderError("cutover_source_stopped");
      const token = this.cipher!.decrypt(connection.credential, associatedData(connection.personId, connection.id, this.context.providerKey));
      const todayLabel = policy ? new Intl.DateTimeFormat("en-CA", { timeZone: policy.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(today) : isoDate(today);
      let rollingFrom = addDays(todayLabel, -reconciliationWindowDays);
      let rollingUntil = todayLabel;
      if (policy && ["scheduled", "draining", "active"].includes(policy.state)) {
        if (policy.role === "target") rollingFrom = rollingFrom < policy.startsOn ? policy.startsOn : rollingFrom;
        else {
          rollingUntil = rollingUntil >= policy.startsOn ? addDays(policy.startsOn, -1) : rollingUntil;
          if (today >= policy.startsAt) rollingFrom = addDays(policy.startsOn, -14);
        }
      }
      const fitBudget = { remaining: maxFitDownloadsPerPass };
      const rolling = rollingFrom > rollingUntil ? { changed: false, complete: true } : await this.reconcileRange(connection, token, rollingFrom, rollingUntil, fitBudget);
      if (rollingFrom <= rollingUntil) await this.training.reconcileRecentActivityLinks(connection.personId,
        policy ? addDays(rollingFrom, -2) : rollingFrom, policy ? addDays(rollingUntil, 2) : rollingUntil);
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
      await this.store!.releaseClaim(connection.id, connection.consentId);
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
    const lowerBound = connection.historicalScopeFromDate ?? historicalLowerBound;
    const policy = await this.store!.importPolicy?.(connection.id, connection.consentId) ?? null;
    const cursorBefore = claim.cursorBefore ?? rollingFrom;
    const candidateNewest = addDays(cursorBefore, -1);
    const newest = policy?.role === "source" && candidateNewest >= policy.startsOn ? addDays(policy.startsOn, -1) : candidateNewest;
    if (newest < lowerBound) {
      await this.store!.markHistoricalWindowSucceeded(connection.id, claimToken, lowerBound, true);
      return;
    }
    const candidateOldest = addDays(newest, -(this.context.historicalWindowDays - 1));
    const oldest = candidateOldest < lowerBound ? lowerBound : candidateOldest;
    try {
      const result = await this.reconcileRange(connection, token, oldest, newest, fitBudget);
      if (result.complete) {
        await this.store!.markHistoricalWindowSucceeded(connection.id, claimToken, oldest, oldest === lowerBound);
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
    const policy = await this.store!.importPolicy?.(connection.id, connection.consentId) ?? null;
    const beforeRequest = this.store!.assertReadAllowed ? async () => {
      if (!await this.store!.assertReadAllowed!(connection.id, connection.consentId)) throw new IntegrationProviderError("cutover_source_stopped");
    } : undefined;
    const options = policy || beforeRequest ? { ...(beforeRequest ? { beforeRequest } : {}),
      ...(policy ? { activityFromDate: addDays(oldest, -2), activityToDate: addDays(newest, 2) } : {}) } : undefined;
    const result = await this.provider!.reconcile(token, oldest, newest, `${connection.id}:${connection.consentId}`, options);
    if ((result.connectedDays?.length || result.bodyMeasurements?.length) && !this.connectedData) throw new IntegrationProviderError("provider_unavailable");
    let changed = false;
    let timezone: string | null | undefined;
    for (const wellness of result.wellness) {
      if (!admitted(policy, wellness.localDate)) continue;
      changed = await this.importWellness(connection, wellness) || changed;
    }
    const connectedOwner = { id: connection.id, personId: connection.personId, consentId: connection.consentId, providerKey: this.context.providerKey };
    for (const day of result.connectedDays ?? []) {
      if (!admitted(policy, day.localDate)) continue;
      if (day.fitness) { const outcome = await this.connectedData!.importFitnessDay(connectedOwner, day); changed = outcome === "created" || outcome === "corrected" || changed; }
      if (day.nutrition) { const outcome = await this.connectedData!.importNutritionDay(connectedOwner, day); changed = outcome === "created" || outcome === "corrected" || changed; }
    }
    for (const measurement of result.bodyMeasurements ?? []) {
      // Physical measurements use the snapshot policy timezone/date boundary, never the activity instant fence.
      const date = measurement.measuredAt && policy ? dateAtTimezone(measurement.measuredAt, policy.timezone) : measurement.localDate;
      if (!admitted(policy, date)) continue;
      const outcome = await this.connectedData!.importBodyMeasurement(connectedOwner, measurement);
      changed = outcome === "created" || outcome === "corrected" || changed;
    }
    for (const activity of result.activities) {
      if (!admitted(policy, activity.localDate, activity.occurredAt)) continue;
      const activityChecksum = normalizedChecksum(Object.fromEntries(
        Object.entries(activity).filter(([key]) => key !== "fileType")
      ));
      // Recheck FIT once per UTC day because the original file can change without summary changes.
      const inboxChecksum = activity.fileType === "fit"
        ? normalizedChecksum({ activityChecksum, fitImportVersion: 2, fitNormalizationVersion: activityDetailsNormalizationVersion, fitReviewDate: isoDate(new Date()) })
        : activityChecksum;
      const inbox = await this.store!.recordInbox(connection.id, connection.consentId, "activity", activity.identity, inboxChecksum,
        { localDate: activity.localDate, occurredAt: activity.occurredAt });
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
        sourceProvider: this.context.providerKey, garminAttributed: activity.garminAttributed,
        trainingStressScore: activity.trainingStressScore ?? null,
        providerExerciseLoad: activity.providerExerciseLoad ?? null, providerExerciseLoadBasis: activity.providerExerciseLoadBasis ?? null,
        aerobicTrainingEffect: activity.aerobicTrainingEffect ?? null, anaerobicTrainingEffect: activity.anaerobicTrainingEffect ?? null,
        caloriesKcal: activity.caloriesKcal ?? null, averagePowerWatts: activity.averagePowerWatts ?? null,
        normalizedPowerWatts: activity.normalizedPowerWatts ?? null, maximumPowerWatts: activity.maximumPowerWatts ?? null,
        intensityFactor: activity.intensityFactor ?? null, bodyBatteryDelta: activity.bodyBatteryDelta ?? null
      });
      if (outcome === "stopped") continue;
      if (needsFit) {
        fitBudget.remaining--;
        changed = await this.importActivityRecovery(connection, token, activity.identity, inbox.receiptId, timezone!) || changed;
      }
      await this.store!.completeInbox(connection.id, connection.consentId, inbox.receiptId);
      changed = outcome !== "unchanged" || changed;
    }
    return { changed, complete: !result.incomplete };
  }

  private async importActivityRecovery(
    connection: ActiveIntegrationConnection,
    token: string,
    activityId: string,
    receiptId: string,
    timezone: string
  ): Promise<boolean> {
    let file: Uint8Array | null;
    try { file = await this.provider!.originalActivityFile(token, activityId, `${connection.id}:${connection.consentId}`, {
      beforeRequest: async () => {
        if (this.store!.assertReadAllowed && !await this.store!.assertReadAllowed(connection.id, connection.consentId)) {
          throw new IntegrationProviderError("cutover_source_stopped");
        }
      }
    }); }
    catch (error) {
      await this.store!.setActivityDetailsIssue(connection.id, connection.consentId, receiptId,
        error instanceof ActivityDetailsReadError ? error.issue : error instanceof IntegrationProviderError && error.failureCode === "provider_response_invalid" ? "invalid_fit" : "provider_unavailable");
      throw error;
    }
    const fileChecksum = createHash("sha256").update(file ?? new Uint8Array()).digest("hex");
    let detailsChanged = false;
    if (file === null) {
      const changed = await this.training.importExternalActivityDetails({ personId: connection.personId,
        connectionId: connection.id, consentId: connection.consentId, providerIdentity: activityId,
        fileChecksum, normalizationVersion: activityDetailsNormalizationVersion, payload: null });
      await this.store!.setActivityDetailsIssue(connection.id, connection.consentId, receiptId, "source_file_unavailable");
      return changed;
    }
    try {
      const payload = parseFitActivityDetails(file);
      const supported = payload.sessions.some((session) => session.records.length || session.laps.length);
      detailsChanged = await this.training.importExternalActivityDetails({ personId: connection.personId,
        connectionId: connection.id, consentId: connection.consentId, providerIdentity: activityId,
        fileChecksum, normalizationVersion: activityDetailsNormalizationVersion, payload: supported ? payload : null });
      await this.store!.setActivityDetailsIssue(connection.id, connection.consentId, receiptId, supported ? null : "no_supported_measurements");
    } catch (error) {
      if (!(error instanceof IntegrationProviderError && error.failureCode === "provider_response_invalid")) throw error;
      await this.store!.setActivityDetailsIssue(connection.id, connection.consentId, receiptId, error instanceof ActivityDetailsReadError ? error.issue : "invalid_fit");
    }
    let snapshot: ReturnType<typeof parseGarminRecoverySnapshot>;
    try {
      snapshot = parseGarminRecoverySnapshot(file);
    } catch (error) {
      if (error instanceof IntegrationProviderError && error.failureCode === "provider_response_invalid") return detailsChanged;
      throw error;
    }
    const current = await this.store!.recoveryFact(connection.id, activityId, fitFactKey);
    if (!snapshot) {
      if (!current || current.checksum === "removed") return detailsChanged;
      const withdrawn = await this.recovery.withdrawObservation(
        connection.personId, current.observationId,
        `${this.context.providerKey}:${activityId}:${fitFactKey}:removed:${current.observationId}`,
        "provider_field_removed",
        { connectionId: connection.recoveryConnectionId, consentId: connection.consentId }
      );
      await this.store!.linkRecoveryFact(connection.id, connection.consentId, activityId, receiptId, fitFactKey, "removed", withdrawn.observation.id);
      return withdrawn.created || detailsChanged;
    }
    const checksum = normalizedChecksum({ fileChecksum, snapshot });
    if (current?.checksum === checksum) {
      await this.store!.linkRecoveryFact(connection.id, connection.consentId, activityId, receiptId, fitFactKey, checksum, current.observationId);
      return detailsChanged;
    }
    const base: CreateRecoveryObservation = {
      kind: "metric", observedFrom: snapshot.observedAt, observedUntil: snapshot.observedAt,
      temporalPrecision: "instant", localDate: null, timezone, quality: "estimated",
      connectionId: connection.recoveryConnectionId, consentId: connection.consentId,
      dedupeKey: `${this.context.providerKey}:${activityId}:${fitFactKey}:${checksum.slice(0, 16)}${current ? `:${current.observationId}` : ""}`,
      sourceReference: {
        channel: "account", externalSystem: `${this.context.providerKey}_activity_fit:garmin_140_9_v1`,
        externalRecordId: `${activityId}:140.9:${fileChecksum}`, occurredAt: snapshot.observedAt
      },
      detail: { type: "metric", metric: fitFactKey, value: snapshot.minutes, unit: "minute" }
    };
    const persisted = current && current.checksum !== "removed"
      ? await this.recovery.correctObservation(connection.personId, current.observationId, { ...base, reason: "provider_record_changed" })
      : await this.recovery.createObservation(connection.personId, base);
    await this.store!.linkRecoveryFact(connection.id, connection.consentId, activityId, receiptId, fitFactKey, checksum, persisted.observation.id);
    return persisted.created || detailsChanged;
  }

  private async importWellness(connection: ActiveIntegrationConnection, wellness: ProviderWellnessRecord): Promise<boolean> {
    const recordChecksum = normalizedChecksum(wellness);
    const inbox = await this.store!.recordInbox(connection.id, connection.consentId, "wellness", wellness.identity, recordChecksum,
      { localDate: wellness.localDate });
    if (inbox.state !== "process") return false;
    const facts: readonly WellnessFact[] = [
      ...(wellness.totalSleepMinutes === null ? [] : [{ key: "sleep", detail: wellness.sleepDetail ?? { type: "sleep" as const, totalSleepMinutes: wellness.totalSleepMinutes, sleepQuality: null } }]),
      ...metric("sleep_score", "score", wellness.sleepScore),
      ...metric("resting_heart_rate", "bpm", wellness.restingHeartRate),
      ...metric("night_heart_rate", "bpm", wellness.averageSleepingHeartRate),
      ...metric("hrv_rmssd", "ms", wellness.hrvRmssd),
      ...metric("oxygen_saturation", "percent", wellness.oxygenSaturation),
      ...metric("respiration_rate", "breaths_per_minute", wellness.respirationRate),
      ...metric("body_battery", "score", wellness.bodyBatteryLatest ?? null),
      ...metric("body_battery_min", "score", wellness.bodyBatteryMinimum),
      ...metric("body_battery_max", "score", wellness.bodyBatteryMaximum),
      ...metric("steps", "count", wellness.steps ?? null),
      ...(wellness.extraMetrics ?? []).map((detail) => ({ key: detail.metric, detail })),
      ...(wellness.bodyBatteryInstant ? [{ key: "body_battery_instant", detail: { type: "metric" as const, metric: "body_battery" as const, unit: "score" as const, value: wellness.bodyBatteryInstant.value }, observedFrom: wellness.bodyBatteryInstant.observedAt, observedUntil: wellness.bodyBatteryInstant.observedAt }] : []),
      ...(wellness.naps ?? []).map((nap) => ({ key: `sleep_nap:${nap.identity}`, detail: { type: "sleep" as const, sleepKind: "nap" as const, totalSleepMinutes: nap.totalSleepMinutes, sleepQuality: null }, observedFrom: nap.observedFrom, observedUntil: nap.observedUntil }))
    ];
    let changed = false;
    for (const fact of facts) {
      const checksum = normalizedChecksum({ localDate: wellness.localDate, detail: fact.detail, ...(fact.observedFrom ? { observedFrom: fact.observedFrom, observedUntil: fact.observedUntil } : {}) });
      const current = await this.store!.recoveryFact(connection.id, wellness.identity, fact.key);
      if (current?.checksum === checksum) {
        await this.store!.linkRecoveryFact(connection.id, connection.consentId, wellness.identity, inbox.receiptId, fact.key, checksum, current.observationId);
        continue;
      }
      const base: CreateRecoveryObservation = {
        kind: fact.detail.type,
        observedFrom: fact.observedFrom ?? null,
        observedUntil: fact.observedUntil ?? null,
        temporalPrecision: fact.observedFrom ? "instant" : "local_date",
        localDate: fact.observedFrom ? null : wellness.localDate,
        timezone: wellness.timezone,
        quality: "reliable",
        connectionId: connection.recoveryConnectionId,
        consentId: connection.consentId,
        dedupeKey: `${this.context.providerKey}:${wellness.identity}:${fact.key}:${checksum.slice(0, 16)}${current ? `:${current.observationId}` : ""}`,
        sourceReference: {
          channel: "account",
          externalSystem: `${this.context.providerKey}_wellness`,
          externalRecordId: `${wellness.identity}:${fact.key}:${checksum}`,
          occurredAt: fact.observedUntil ?? (fact.key === "steps" ? wellness.updatedAt ?? null : null)
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
    const previousKeys = wellness.naps !== undefined ? await this.store!.recoveryFactKeys?.(connection.id, wellness.identity) ?? [] : [];
    const authoritative = wellness.authoritativeFactKeys ?? legacyWellnessFactKeys;
    for (const factKey of [...authoritative, ...previousKeys.filter((key) => key.startsWith("sleep_nap:"))]) {
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
        `${this.context.providerKey}:${wellness.identity}:${factKey}:removed:${current.observationId}`,
        "provider_field_removed",
        { connectionId: connection.recoveryConnectionId, consentId: connection.consentId }
      );
      await this.store!.linkRecoveryFact(connection.id, connection.consentId, wellness.identity, inbox.receiptId, factKey, "removed", withdrawn.observation.id);
      changed = withdrawn.created || changed;
    }
    await this.store!.completeInbox(connection.id, connection.consentId, inbox.receiptId);
    return changed;
  }

  private emptyStatus(lifecycle: "unavailable" | "disconnected" = "unavailable"): Status {
    return { ...unavailableStatus(lifecycle), provider: this.context.providerKey,
      displayName: this.context.providerKey === "intervals_icu" ? "Garmin via Intervals.icu" : "Garmin" } as Status;
  }

  private oauthProvider(): HealthDataProvider {
    if (!this.provider || !("authorizationUrl" in this.provider)) throw new DomainValidationError("OAuth is not available for this provider");
    return this.provider as HealthDataProvider;
  }

  private assertEnabled(): void {
    if (!this.store || !this.provider || !this.cipher) throw new DomainValidationError("Garmin via Intervals.icu is not configured");
  }
}

function metric(
  metricName: RecoveryMetric,
  unit: RecoveryMetricUnit,
  value: number | null
): readonly { readonly key: string; readonly detail: RecoveryObservationDetail }[] {
  return value === null ? [] : [{ key: metricName, detail: { type: "metric", metric: metricName, value, unit } }];
}

function admitted(policy: IntegrationImportPolicy | null, localDate: string, occurredAt?: string): boolean {
  if (!policy || !["scheduled", "draining", "active"].includes(policy.state)) return true;
  if (!policy.requestAllowed) return false;
  if (occurredAt !== undefined) {
    const start = Date.parse(occurredAt);
    return Number.isFinite(start) && (policy.role === "source" ? start < policy.startsAt.valueOf() : start >= policy.startsAt.valueOf());
  }
  return policy.role === "source" ? localDate < policy.startsOn : localDate >= policy.startsOn;
}
/** Binds import provenance and bounded history to one explicit provider. */
export interface IntegrationImportContext {
  readonly providerKey: "intervals_icu" | "garmin_personal";
  readonly historicalWindowDays: number;
}
function associatedData(personId: string, connectionId: string, providerKey: string): string { return `${providerKey}:${personId}:${connectionId}`; }
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

interface WellnessFact { readonly key: string; readonly detail: RecoveryObservationDetail; readonly observedFrom?: string; readonly observedUntil?: string; }
const legacyWellnessFactKeys = ["sleep", "sleep_score", "resting_heart_rate", "night_heart_rate", "hrv_rmssd", "oxygen_saturation", "respiration_rate", "body_battery", "body_battery_min", "body_battery_max", "steps"] as const;
function dateAtTimezone(instant: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
