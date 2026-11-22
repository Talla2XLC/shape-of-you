import { randomUUID } from "node:crypto";
import { HttpException, Inject, Injectable, Optional } from "@nestjs/common";
import type { ConnectGarminPersonal, GarminPersonalConnection } from "@shape-of-you/contracts";

import { CONNECTED_PROVIDER_DATA_STORE, GARMIN_CUTOVER_RUNTIME, GARMIN_PERSONAL_RUNTIME, PERSON_CONTEXT, RECOVERY_STORE, TRAINING_STORE } from "../application/tokens.js";
import type { PersonContext } from "../application/person-context.js";
import type { RecoveryStore } from "../storage/recovery-repository.js";
import type { ConnectedProviderRepository } from "../storage/connected-provider-repository.js";
import type { TrainingStore } from "../storage/training-repository.js";
import type { IntegrationRepository } from "../storage/integration-repository.js";
import type { ConnectionCredentialCipher } from "./credential-cipher.js";
import type { GarminPersonalProvider } from "./garmin-personal/provider.js";
import { ConflictError, DomainValidationError } from "../domain/errors.js";
import { IntegrationProviderError, type HealthDataReader } from "./provider.js";
import { IntegrationService } from "./integration.service.js";
import type { GarminCutoverRuntime } from "./garmin-cutover.service.js";

/** Direct Garmin dependencies; availability never depends on Intervals OAuth configuration. */
export interface GarminPersonalRuntime {
  readonly store: IntegrationRepository<GarminPersonalConnection>;
  readonly provider: GarminPersonalProvider;
  readonly cipher: ConnectionCredentialCipher;
}

/** Personal-key authorization and provider-scoped reuse of the existing typed importer. */
@Injectable()
export class GarminPersonalService {
  private readonly importer: IntegrationService<GarminPersonalConnection>;
  private readonly attempts = new Map<string, { started: number; count: number }>();

  public constructor(
    @Inject(PERSON_CONTEXT) private readonly person: PersonContext,
    @Inject(RECOVERY_STORE) recovery: RecoveryStore,
    @Inject(TRAINING_STORE) training: TrainingStore,
    @Optional() @Inject(GARMIN_PERSONAL_RUNTIME) private readonly runtime: GarminPersonalRuntime | null = null,
    @Optional() @Inject(GARMIN_CUTOVER_RUNTIME) private readonly cutover: GarminCutoverRuntime | null = null,
    @Optional() @Inject(CONNECTED_PROVIDER_DATA_STORE) connectedData: Pick<ConnectedProviderRepository, "importFitnessDay" | "importNutritionDay" | "importBodyMeasurement"> | null = null
  ) {
    const reader: HealthDataReader | null = runtime ? {
      reconcile: async (key, from, to, scope, options) => {
        const result = await runtime.provider.reconcile(key, from, to, scope, options);
        const legacyFacts = result.wellness.length > 0 || result.activities.length > 0;
        const connectedFacts = Boolean(result.connectedDays?.length || result.bodyMeasurements?.length);
        if (!legacyFacts && !connectedFacts) return result;
        // Some primary Nutrition/Weight DTOs carry no account ID. Never invent an ID or require watch data to connect.
        if (!result.externalUserId) {
          if (legacyFacts) throw new IntegrationProviderError("provider_response_invalid");
          return result;
        }
        if (!scope) throw new IntegrationProviderError("provider_response_invalid");
        const [id, consent] = scope.split(":");
        if (!id || !consent) throw new IntegrationProviderError("provider_response_invalid");
        try {
          if (!await runtime.store.bindExternalIdentity(id, consent, result.externalUserId)) return { wellness: [], activities: [] };
        } catch {
          throw new IntegrationProviderError("authorization_required");
        }
        return result;
      },
      originalActivityFile: (key, id, scope, options) => runtime.provider.originalActivityFile(key, id, scope, options)
    } : null;
    this.importer = new IntegrationService(person, runtime?.store ?? null, reader, runtime?.cipher ?? null,
      recovery, training, { providerKey: "garmin_personal", historicalWindowDays: 14 }, connectedData);
  }

  /** Returns only safe connection status; a connected empty account is successful. */
  public async status(): Promise<GarminPersonalConnection> {
    const status = await this.importer.status();
    const policy = await this.cutover?.store.find(this.person.getPersonId());
    const safe = { ...status, sync: status.sync ?? { state: "blocked" as const, nextAttemptAt: null } };
    return policy && ["scheduled", "failed"].includes(policy.state) && policy.targetRecoveryConnectionId !== null &&
      policy.targetRecoveryConnectionId === status.recoveryConnectionId ? { ...safe, lifecycle: "connecting", sync: { state: "blocked", nextAttemptAt: null } } : safe;
  }

  /** Requests the current Person's rolling import; acceptance is distinct from eventual provider success. */
  public async requestSync(): Promise<GarminPersonalConnection> {
    if (!this.runtime) throw new HttpException("Direct Garmin sync is unavailable", 503);
    if (!await this.runtime.store.requestSync(this.person.getPersonId())) {
      throw new ConflictError("Garmin sync is not available for this connection");
    }
    return this.status();
  }

  /** Checks access without persistence, consent activation or domain writes. */
  public async check(apiKey: string): Promise<{ verified: true }> {
    const runtime = this.requiredRuntime();
    this.limitAttempt();
    await this.verifyKey(runtime, apiKey);
    return { verified: true };
  }

  /** Activates or rotates a verified key; the external account ID is bound on first data delivery. */
  public async connect(input: ConnectGarminPersonal): Promise<GarminPersonalConnection> {
    const runtime = this.requiredRuntime();
    this.limitAttempt();
    if (input.consent !== true) throw new DomainValidationError("Import consent is required");
    const personId = this.person.getPersonId();
    const startedAt = new Date();
    const existing = await runtime.store.authorizationIdentity(personId);
    const previous = await runtime.store.findActive(personId);
    await this.verifyKey(runtime, input.apiKey);
    const id = existing?.id ?? randomUUID();
    const recoveryConnectionId = existing?.recoveryConnectionId ?? randomUUID();
    const consentId = randomUUID();
    const credential = runtime.cipher.encrypt(input.apiKey, `garmin_personal:${personId}:${id}`);
    await runtime.store.activate({ id, personId, recoveryConnectionId, consentId, credential,
      externalUserId: null, authorizationStartedAt: startedAt, expectedConsentId: existing?.consentId ?? null });
    if (previous) {
      runtime.provider.invalidateScope(`${previous.id}:${previous.consentId}`);
    }
    return this.status();
  }

  /** Stops local import and discards our key; Garmin revocation remains the account owner's action. */
  public async disconnect(reason: string): Promise<GarminPersonalConnection> {
    const runtime = this.requiredRuntime();
    const previous = await runtime.store.beginDisconnect(this.person.getPersonId(), reason);
    if (previous) {
      runtime.provider.invalidateScope(`${previous.id}:${previous.consentId}`);
    }
    return this.status();
  }

  /** Starts only explicitly requested, bounded and resumable historical import. */
  public startHistoricalImport(): Promise<GarminPersonalConnection> { return this.importer.startHistoricalImport(); }

  /** Runs one scoped claim in the existing in-process worker. */
  public async processNext(workerId: string, leaseMs: number): Promise<boolean> {
    if (!this.runtime) return false;
    const connection = await this.runtime.store.claimDue(workerId, leaseMs);
    if (!connection) return false;
    await this.importer.reconcileConnection(connection);
    return true;
  }

  /** Clears direct credentials during journal-backed erasure, including already disconnected accounts. */
  public async prepareErasure(personId: string, recoveryConnectionId: string): Promise<void> {
    if (!this.runtime) return;
    const connection = await this.runtime.store.findForErasure(personId, recoveryConnectionId);
    if (!connection) return;
    this.runtime.provider.invalidateScope(`${connection.id}:${connection.consentId}`);
    await this.runtime.store.completeRemoteDisconnect(connection.id, connection.consentId);
  }

  private async verifyKey(runtime: GarminPersonalRuntime, apiKey: string): Promise<void> {
    try { await runtime.provider.verifyKey(apiKey); }
    catch (error) {
      if (!(error instanceof IntegrationProviderError)) throw new HttpException("Garmin access could not be checked", 503);
      const failures = {
        authorization_required: [422, "Garmin did not accept this key"],
        provider_rate_limited: [429, "Garmin asked us to retry later"],
        provider_timeout: [504, "Garmin did not respond in time"],
        provider_unavailable: [503, "Garmin is temporarily unavailable"],
        provider_response_invalid: [502, "Garmin returned an unsupported response"]
      } as const;
      const [status, message] = error.failureCode === "cutover_source_stopped"
        ? [503, "Import permission has ended"] as const : failures[error.failureCode];
      throw new HttpException(message, status);
    }
  }

  private requiredRuntime(): GarminPersonalRuntime {
    if (!this.runtime) throw new DomainValidationError("Garmin is not configured");
    return this.runtime;
  }

  private limitAttempt(): void {
    const id = this.person.getPersonId();
    const now = Date.now();
    for (const [key, value] of this.attempts) if (now - value.started >= 60_000) this.attempts.delete(key);
    const current = this.attempts.get(id);
    if ((current?.count ?? 0) >= 5 || (!current && this.attempts.size >= 1000)) {
      throw new HttpException("Please retry later", 429);
    }
    this.attempts.set(id, { started: current?.started ?? now, count: (current?.count ?? 0) + 1 });
  }
}
