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
import { DomainValidationError } from "../domain/errors.js";

const transactionTtlMs = 10 * 60_000;
const reconciliationWindowDays = 14;

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
      const result = await this.provider!.reconcile(token, isoDate(from), isoDate(today));
      let changed = false;
      for (const wellness of result.wellness) changed = await this.importWellness(connection, wellness) || changed;
      for (const activity of result.activities) {
        const checksum = normalizedChecksum(activity);
        if (!await this.store!.recordInbox(connection.id, "activity", activity.identity, checksum)) continue;
        const outcome = await this.training.importExternalActivity({
          connectionId: connection.id, personId: connection.personId,
          providerIdentity: activity.identity, normalizedChecksum: checksum,
          occurredAt: activity.occurredAt, localDate: activity.localDate, timezone: activity.timezone,
          name: activity.name, durationSeconds: activity.durationSeconds, distanceMeters: activity.distanceMeters,
          trainingLoad: activity.trainingLoad, averageHeartRate: activity.averageHeartRate,
          maximumHeartRate: activity.maximumHeartRate, deviceName: activity.deviceName,
          sourceProvider: "intervals_icu", garminAttributed: activity.garminAttributed
        });
        if (outcome === "stopped") continue;
        await this.store!.completeInbox(connection.id, "activity", activity.identity, checksum);
        changed = outcome !== "unchanged" || changed;
      }
      await this.store!.markSyncSucceeded(connection.id, changed);
    } catch (error) {
      const failure = error instanceof IntegrationProviderError ? error.failureCode : "provider_unavailable";
      await this.store!.markSyncFailed(connection.id, failure);
    } finally {
      await this.store!.releaseClaim(connection.id);
    }
  }

  private async importWellness(connection: ActiveIntegrationConnection, wellness: ProviderWellnessRecord): Promise<boolean> {
    const recordChecksum = normalizedChecksum(wellness);
    if (!await this.store!.recordInbox(connection.id, "wellness", wellness.identity, recordChecksum)) return false;
    const facts: readonly { readonly key: string; readonly detail: RecoveryObservationDetail }[] = [
      ...(wellness.totalSleepMinutes === null ? [] : [{ key: "sleep", detail: { type: "sleep" as const, totalSleepMinutes: wellness.totalSleepMinutes, sleepQuality: null } }]),
      ...metric("sleep_score", "score", wellness.sleepScore),
      ...metric("resting_heart_rate", "bpm", wellness.restingHeartRate),
      ...metric("hrv_rmssd", "ms", wellness.hrvRmssd),
      ...metric("body_battery", "score", wellness.bodyBattery)
    ];
    let changed = false;
    for (const fact of facts) {
      const checksum = normalizedChecksum({ localDate: wellness.localDate, detail: fact.detail });
      const current = await this.store!.recoveryFact(connection.id, wellness.identity, fact.key);
      if (current?.checksum === checksum) continue;
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
          occurredAt: null
        },
        detail: fact.detail
      };
      const persisted = current
        ? await this.recovery.correctObservation(connection.personId, current.observationId, { ...base, reason: "provider_record_changed" })
        : await this.recovery.createObservation(connection.personId, base);
      await this.store!.linkRecoveryFact(connection.id, wellness.identity, fact.key, checksum, persisted.observation.id);
      changed = persisted.created || changed;
    }
    const present = new Set(facts.map((fact) => fact.key));
    for (const factKey of ["sleep", "sleep_score", "resting_heart_rate", "hrv_rmssd", "body_battery"] as const) {
      if (present.has(factKey)) continue;
      const current = await this.store!.recoveryFact(connection.id, wellness.identity, factKey);
      if (!current || current.checksum === "removed") continue;
      const withdrawn = await this.recovery.withdrawObservation(
        connection.personId,
        current.observationId,
        `intervals:${wellness.identity}:${factKey}:removed:${current.observationId}`,
        "provider_field_removed"
      );
      await this.store!.linkRecoveryFact(connection.id, wellness.identity, factKey, "removed", withdrawn.observation.id);
      changed = withdrawn.created || changed;
    }
    await this.store!.completeInbox(connection.id, "wellness", wellness.identity, recordChecksum);
    return changed;
  }

  private assertEnabled(): void {
    if (!this.store || !this.provider || !this.cipher) throw new DomainValidationError("Garmin via Intervals.icu is not configured");
  }
}

function metric(metricName: "sleep_score" | "resting_heart_rate" | "hrv_rmssd" | "body_battery", unit: "score" | "bpm" | "ms", value: number | null): readonly { readonly key: string; readonly detail: RecoveryObservationDetail }[] {
  return value === null ? [] : [{ key: metricName, detail: { type: "metric", metric: metricName, value, unit } }];
}
function associatedData(personId: string, connectionId: string): string { return `intervals_icu:${personId}:${connectionId}`; }
function stateHash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function isoDate(value: Date): string { return value.toISOString().slice(0, 10); }
function isSafeReturnTo(value: string): boolean { return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !value.includes("#"); }
function unavailableStatus(lifecycle: "unavailable" | "disconnected" = "unavailable"): GarminIntervalsConnection {
  return { provider: "intervals_icu", displayName: "Garmin via Intervals.icu", recoveryConnectionId: null, lifecycle, failureCode: null, lastAttemptAt: null, lastSuccessfulSyncAt: null, lastDataAt: null, connectedAt: null, disconnectedAt: null };
}
