import { randomUUID } from "node:crypto";
import { HttpException, Inject, Injectable, Optional } from "@nestjs/common";
import {
  GarminCutoverCapabilitySchema, GarminCutoverFailureSchema,
  type CancelGarminCutover, type GarminCutover, type GarminCutoverCapability,
  type GarminCutoverGap, type GarminCutoverPreview, type GarminCutoverStatus,
  type PreviewGarminCutover, type RetryGarminCutover, type ScheduleGarminCutover
} from "@shape-of-you/contracts";

import { GARMIN_CUTOVER_RUNTIME, PERSON_CONTEXT } from "../application/tokens.js";
import type { PersonContext } from "../application/person-context.js";
import type { CutoverPreviewContext, CutoverRecord, IntegrationCutoverRepository } from "../storage/integration-cutover-repository.js";
import { CutoverJournalProofRequiredError } from "../storage/integration-cutover-repository.js";
import { ConflictError, DomainValidationError } from "../domain/errors.js";
import type { GarminPersonalRuntime } from "./garmin-personal.service.js";
import { IntegrationProviderError } from "./provider.js";
import { parseFitActivityDetails } from "./intervals-icu/fit-activity-details.js";

/** Mapping authority acknowledged by one explicit cutover command; changes invalidate pending waivers. */
export const garminCutoverCapabilityVersion = "garmin-cutover-v1";

/** Optional API-owned persistence and ordinary encrypted Garmin runtime. */
export interface GarminCutoverRuntime {
  readonly store: IntegrationCutoverRepository;
  readonly garmin: GarminPersonalRuntime | null;
}

/** A safe refreshed preview only; the submitted secret and provider payload never enter the error. */
export class CutoverCoverageChangedError extends Error {
  public constructor(public readonly preview: GarminCutoverPreview) {
    super("Coverage confirmation changed");
    this.name = "CutoverCoverageChangedError";
  }
}

const descriptions: Record<GarminCutoverCapability, string> = {
  "recovery.hrv_rmssd": "Direct Garmin HRV mapping is not yet confirmed.",
  "recovery.sleep_score": "Direct Garmin overall sleep score mapping is not yet confirmed.",
  "training.normalized_load": "Garmin load is not interchangeable with Intervals relative training stress.",
  "training.device_attribution": "Direct activity summary device attribution is not yet confirmed.",
  "training.original_fit": "An original FIT has not been validated for this candidate account."
};

/** Coordinates a forward-only handover; candidate reads never create domain facts. */
@Injectable()
export class GarminCutoverService {
  private readonly attempts = new Map<string, { count: number; started: number }>();

  public constructor(
    @Inject(PERSON_CONTEXT) private readonly person: PersonContext,
    @Optional() @Inject(GARMIN_CUTOVER_RUNTIME) private readonly runtime: GarminCutoverRuntime | null = null
  ) {}

  /** Reads only safe local status; no current provider request or key access. */
  public async status(): Promise<GarminCutoverStatus> {
    return { cutover: this.runtime ? project(await this.runtime.store.find(this.person.getPersonId())) : null };
  }

  /** Previews local source ownership and known mapping gaps without persisting a credential. */
  public async preview(input: PreviewGarminCutover): Promise<GarminCutoverPreview> {
    const runtime = this.requiredRuntime();
    return publicPreview(await runtime.store.preview(this.person.getPersonId(), input.startsOn));
  }

  /** Verifies one user-submitted key and schedules the exact acknowledged future policy atomically. */
  public schedule(input: ScheduleGarminCutover): Promise<GarminCutoverStatus> {
    if (input.consent !== true) throw new DomainValidationError("Import consent is required");
    return this.prepare(input, false);
  }

  /** Retries a failed plan with its encrypted pending key unless an explicit replacement is supplied. */
  public retry(input: RetryGarminCutover): Promise<GarminCutoverStatus> { return this.prepare(input, true); }

  /** Cancels only a plan which never committed new import authority. */
  public async cancel(input: CancelGarminCutover): Promise<GarminCutoverStatus> {
    const runtime = this.requiredRuntime();
    const pending = await runtime.store.pendingTarget(this.person.getPersonId());
    const row = await runtime.store.cancel(this.person.getPersonId(), input.expectedVersion, input.reason);
    if (pending) runtime.garmin!.provider.invalidateScope(`${pending.id}:${pending.consentId}`);
    return { cutover: project(row) };
  }

  /** Performs at most one due transition; all state commits use repository CAS and DB time. */
  public async processNext(): Promise<boolean> {
    if (!this.runtime) return false;
    const cleaned = await this.runtime.store.cleanupExpiredRevocations();
    const row = await this.runtime.store.nextDue();
    if (!row) return cleaned > 0;
    if (row.state === "draining") {
      try { await this.runtime.store.finishDrain(row.id, row.version); }
      catch (error) { if (!(error instanceof ConflictError)) throw error; }
      return true;
    }
    try {
      if (!this.runtime.garmin) throw new IntegrationProviderError("provider_unavailable");
      if (row.capabilityVersion !== garminCutoverCapabilityVersion) {
        await this.runtime.store.failBeforeActivation(row.id, row.version, "coverage_changed");
        return true;
      }
      const pending = await this.runtime.store.pendingTarget(row.personId);
      if (!pending || pending.id !== row.targetConnectionId || pending.consentId !== row.targetConsentId) {
        await this.runtime.store.failBeforeActivation(row.id, row.version, "consent_changed");
        return true;
      }
      const key = this.runtime.garmin.cipher.decrypt(pending.credential, keyContext(row.personId, pending.id));
      await this.runtime.garmin.provider.verifyKey(key);
      await this.runtime.store.activate(row.id, row.version);
    } catch (error) {
      // A concurrent cancellation/activation wins; never alter a committed or newer generation.
      try {
        await this.runtime.store.failBeforeActivation(row.id, row.version,
          error instanceof CutoverJournalProofRequiredError ? "journal_not_ready" :
            error instanceof IntegrationProviderError ? error.failureCode : "source_conflict");
      } catch (conflict) { if (!(conflict instanceof ConflictError)) throw conflict; }
    }
    return true;
  }

  private async prepare(input: ScheduleGarminCutover | RetryGarminCutover, retry: boolean): Promise<GarminCutoverStatus> {
    const runtime = this.requiredRuntime();
    const personId = this.person.getPersonId();
    this.limit(personId);
    const current = await runtime.store.find(personId);
    if (current?.dedupeKey === input.dedupeKey) {
      if (current.startsOn !== input.startsOn || current.capabilityVersion !== garminCutoverCapabilityVersion ||
          [...current.acceptedCoverageGaps].sort().join() !== [...input.acceptedCoverageGaps].sort().join()) {
        throw new ConflictError("Cutover request identity changed");
      }
      return { cutover: project(current) };
    }
    const context = await runtime.store.preview(personId, input.startsOn);
    let preview = publicPreview(context);
    if (preview.expectedRevision !== input.expectedRevision) throw new CutoverCoverageChangedError(preview);
    const allowed = new Set(preview.gaps.map(item => item.capability));
    if (new Set(input.acceptedCoverageGaps).size !== input.acceptedCoverageGaps.length ||
        input.acceptedCoverageGaps.some(key => !allowed.has(key))) throw new DomainValidationError("Unshown capability acknowledgement");
    const pending = retry ? await runtime.store.pendingTarget(personId) : null;
    const identity = pending ?? await runtime.garmin!.store.authorizationIdentity(personId);
    const targetConnectionId = identity?.id ?? randomUUID();
    const targetRecoveryConnectionId = identity?.recoveryConnectionId ?? randomUUID();
    const key = input.apiKey ?? (pending ? runtime.garmin!.cipher.decrypt(pending.credential, keyContext(personId, pending.id)) : null);
    if (!key) throw new DomainValidationError("A Garmin key is required");
    let candidate;
    try {
      candidate = await runtime.garmin!.provider.inspectCutoverCandidate(key);
      if (candidate.originalFit !== null) parseFitActivityDetails(candidate.originalFit);
    } catch (error) { throw publicProviderError(error); }
    preview = publicPreview(context, candidate.originalFit !== null);
    if (preview.gaps.some(gap => !input.acceptedCoverageGaps.includes(gap.capability))) {
      throw new CutoverCoverageChangedError(preview);
    }
    const command = {
      targetConnectionId, targetRecoveryConnectionId, targetConsentId: randomUUID(),
      startsOn: input.startsOn, expectedRevision: input.expectedRevision, dedupeKey: input.dedupeKey,
      capabilityVersion: garminCutoverCapabilityVersion, acceptedCoverageGaps: input.acceptedCoverageGaps,
      externalUserId: candidate.externalUserId,
      credential: runtime.garmin!.cipher.encrypt(key, keyContext(personId, targetConnectionId)),
      ...(retry && "expectedVersion" in input ? { expectedVersion: input.expectedVersion } : {})
    };
    const row = retry ? await runtime.store.retry(personId, command) : await runtime.store.schedule(personId, command);
    return { cutover: project(row) };
  }

  private requiredRuntime(): GarminCutoverRuntime & { readonly garmin: GarminPersonalRuntime } {
    if (!this.runtime?.garmin) throw new HttpException("Garmin transition is not configured", 503);
    return this.runtime as GarminCutoverRuntime & { readonly garmin: GarminPersonalRuntime };
  }

  private limit(personId: string): void {
    const now = Date.now();
    for (const [id, value] of this.attempts) if (now - value.started >= 60_000) this.attempts.delete(id);
    const current = this.attempts.get(personId);
    if ((current?.count ?? 0) >= 5 || (!current && this.attempts.size >= 1000)) throw new HttpException("Please retry later", 429);
    this.attempts.set(personId, { started: current?.started ?? now, count: (current?.count ?? 0) + 1 });
  }
}

function keyContext(personId: string, connectionId: string): string { return `garmin_personal:${personId}:${connectionId}`; }
function publicPreview(context: CutoverPreviewContext, validFit = false): GarminCutoverPreview {
  const used = new Set(context.usedCapabilities);
  const gaps: GarminCutoverGap[] = GarminCutoverCapabilitySchema.enum
    .filter(capability => used.has(capability) && !(capability === "training.original_fit" && validFit))
    .map(capability => ({ capability, status: capability.startsWith("recovery.") || capability === "training.normalized_load" ? "unsupported" : "unverified", description: descriptions[capability] }));
  return { expectedRevision: context.expectedRevision, startsOn: context.startsOn, timezone: context.timezone,
    startsAt: context.startsAt.toISOString(), sourceDrainsUntil: context.sourceDrainsUntil.toISOString(),
    sourceTailFromDate: new Date(Date.parse(`${context.startsOn}T12:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10),
    capabilityVersion: garminCutoverCapabilityVersion, gaps };
}
function project(row: CutoverRecord | null): GarminCutover | null {
  if (!row) return null;
  const failureCode = row.restoreSuppressed ? "restore_suppressed" : row.failureCode === null ? null : GarminCutoverFailureSchema.enum.find(code => code === row.failureCode) ?? "source_conflict";
  return { id: row.id, version: row.version, state: row.state, startsOn: row.startsOn, timezone: row.timezone,
    startsAt: row.startsAt.toISOString(), sourceDrainsUntil: row.sourceDrainsUntil.toISOString(),
    capabilityVersion: row.capabilityVersion,
    acceptedCoverageGaps: row.acceptedCoverageGaps.filter((key): key is GarminCutoverCapability => GarminCutoverCapabilitySchema.enum.some(value => value === key)),
    failureCode, sourceRevocationUnconfirmed: row.sourceRevocationUnconfirmed, lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null };
}
function publicProviderError(error: unknown): HttpException {
  if (!(error instanceof IntegrationProviderError)) return new HttpException("Garmin candidate could not be checked", 503);
  const status = error.failureCode === "authorization_required" ? 422 : error.failureCode === "provider_rate_limited" ? 429 :
    error.failureCode === "provider_timeout" ? 504 : error.failureCode === "provider_response_invalid" ? 502 : 503;
  return new HttpException("Garmin candidate could not be checked", status);
}
