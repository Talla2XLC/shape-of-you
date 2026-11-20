import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ScheduleGarminCutover } from "@shape-of-you/contracts";
import { SyntheticPersonContext } from "../src/application/person-context.js";
import { GarminCutoverService, CutoverCoverageChangedError, garminCutoverCapabilityVersion } from "../src/integrations/garmin-cutover.service.js";
import { ConnectionCredentialCipher } from "../src/integrations/credential-cipher.js";
import type { GarminPersonalRuntime } from "../src/integrations/garmin-personal.service.js";
import type { CutoverRecord, IntegrationCutoverRepository } from "../src/storage/integration-cutover-repository.js";
import { CutoverJournalProofRequiredError } from "../src/storage/integration-cutover-repository.js";

const key = "synthetic-cutover-key";
function fixture(usedCapabilities: string[] = ["recovery.hrv_rmssd", "recovery.sleep_score"]) {
  const personId = randomUUID();
  const cipher = new ConnectionCredentialCipher("test", new Map([["test", randomBytes(32)]]));
  const base = { id: randomUUID(), personId, version: 1, state: "scheduled", startsOn: "2090-01-01", timezone: "UTC",
    startsAt: new Date("2090-01-01T00:00:00Z"), sourceDrainsUntil: new Date("2090-01-15T00:00:00Z"),
    capabilityVersion: garminCutoverCapabilityVersion, acceptedCoverageGaps: usedCapabilities, failureCode: null,
    sourceRevocationUnconfirmed: false, lastAttemptAt: null, restoreSuppressed: false, dedupeKey: "schedule-intent" } as CutoverRecord;
  const context = { source: {}, sourceExternalUserId: "synthetic-athlete", timezone: "UTC", startsOn: base.startsOn,
    startsAt: base.startsAt, sourceDrainsUntil: base.sourceDrainsUntil, expectedRevision: "revision", usedCapabilities };
  const store = { find: vi.fn().mockResolvedValue(null), preview: vi.fn().mockResolvedValue(context),
    pendingTarget: vi.fn().mockResolvedValue(null), schedule: vi.fn().mockResolvedValue(base), retry: vi.fn().mockResolvedValue(base),
    cancel: vi.fn().mockResolvedValue({ ...base, state: "cancelled" }), cleanupExpiredRevocations: vi.fn().mockResolvedValue(0),
    nextDue: vi.fn().mockResolvedValue(null), activate: vi.fn().mockResolvedValue(base), failBeforeActivation: vi.fn(), finishDrain: vi.fn() };
  const provider = { inspectCutoverCandidate: vi.fn().mockResolvedValue({ externalUserId: null, activityPresent: false, originalFit: null }),
    verifyKey: vi.fn().mockResolvedValue(undefined), invalidateScope: vi.fn() };
  const identity = { authorizationIdentity: vi.fn().mockResolvedValue(null) };
  const service = new GarminCutoverService(new SyntheticPersonContext(personId), {
    store: store as unknown as IntegrationCutoverRepository,
    garmin: { store: identity, provider, cipher } as unknown as GarminPersonalRuntime
  });
  const input: ScheduleGarminCutover = { startsOn: base.startsOn, expectedRevision: "revision", apiKey: key, consent: true,
    acceptedCoverageGaps: usedCapabilities as ScheduleGarminCutover["acceptedCoverageGaps"], dedupeKey: base.dedupeKey };
  return { service, store, provider, cipher, identity, personId, base, input };
}

describe("Garmin cutover coordinator", () => {
  it("reports restored authority as suppressed even if a legacy failure code is absent", async () => {
    const f = fixture();
    f.store.find.mockResolvedValue({ ...f.base, state: "active", restoreSuppressed: true });
    await expect(f.service.status()).resolves.toMatchObject({ cutover: { failureCode: "restore_suppressed" } });
  });

  it("fails before activation with a dedicated missing-journal-proof reason", async () => {
    const f = fixture();
    const id = randomUUID(), consentId = randomUUID();
    f.store.nextDue.mockResolvedValue({ ...f.base, targetConnectionId: id, targetConsentId: consentId });
    f.store.pendingTarget.mockResolvedValue({ id, consentId, credential: f.cipher.encrypt(key, `garmin_personal:${f.personId}:${id}`) });
    f.store.activate.mockRejectedValue(new CutoverJournalProofRequiredError());
    expect(await f.service.processNext()).toBe(true);
    expect(f.store.failBeforeActivation).toHaveBeenCalledWith(f.base.id, 1, "journal_not_ready");
  });

  it("previews locally without requesting or persisting a credential", async () => {
    const f = fixture();
    expect(await f.service.preview({})).toMatchObject({ startsOn: "2090-01-01", sourceTailFromDate: "2089-12-18",
      gaps: [{ capability: "recovery.hrv_rmssd" }, { capability: "recovery.sleep_score" }] });
    expect(f.provider.inspectCutoverCandidate).not.toHaveBeenCalled();
    expect(f.store.schedule).not.toHaveBeenCalled();
  });

  it("returns a bounded refreshed preview before persistence when waivers are missing", async () => {
    const f = fixture();
    const result = f.service.schedule({ ...f.input, acceptedCoverageGaps: [] });
    await expect(result).rejects.toBeInstanceOf(CutoverCoverageChangedError);
    try { await result; } catch (error) {
      expect(JSON.stringify(error)).not.toContain(key);
      expect((error as CutoverCoverageChangedError).preview.gaps).toHaveLength(2);
    }
    expect(f.store.schedule).not.toHaveBeenCalled();
  });

  it("binds the encrypted key to the exact target ID and returns no secret or provider identity", async () => {
    const f = fixture();
    const result = await f.service.schedule(f.input);
    const [personId, command] = f.store.schedule.mock.calls[0]!;
    expect(personId).toBe(f.personId);
    expect(f.cipher.decrypt(command.credential, `garmin_personal:${f.personId}:${command.targetConnectionId}`)).toBe(key);
    expect(command.externalUserId).toBeNull();
    expect(JSON.stringify(result)).not.toContain(key);
    expect(JSON.stringify(result)).not.toContain("synthetic-athlete");
    expect(JSON.stringify(result)).not.toContain(command.credential.ciphertext);
  });

  it("retries using only the encrypted pending key", async () => {
    const f = fixture();
    const id = randomUUID();
    f.store.pendingTarget.mockResolvedValue({ id, recoveryConnectionId: randomUUID(), consentId: randomUUID(),
      credential: f.cipher.encrypt(key, `garmin_personal:${f.personId}:${id}`) });
    await f.service.retry({ startsOn: f.input.startsOn, expectedRevision: "revision", expectedVersion: 3,
      acceptedCoverageGaps: f.input.acceptedCoverageGaps, dedupeKey: "retry-intent" });
    expect(f.provider.inspectCutoverCandidate).toHaveBeenCalledWith(key);
    expect(f.identity.authorizationIdentity).not.toHaveBeenCalled();
    expect(f.store.retry.mock.calls[0]![1]).toMatchObject({ targetConnectionId: id, expectedVersion: 3 });
  });

  it("never waives malformed FIT bytes as successful coverage", async () => {
    const f = fixture([]);
    f.provider.inspectCutoverCandidate.mockResolvedValue({ externalUserId: "42", activityPresent: true, originalFit: new Uint8Array([1, 2, 3]) });
    await expect(f.service.schedule(f.input)).rejects.toMatchObject({ status: 502 });
    expect(f.store.schedule).not.toHaveBeenCalled();
  });

  it("replays an already committed intent without a second key read or new plan", async () => {
    const f = fixture();
    f.store.find.mockResolvedValue({ ...f.base, state: "active" });
    await expect(f.service.schedule(f.input)).resolves.toMatchObject({ cutover: { id: f.base.id, state: "active" } });
    expect(f.provider.inspectCutoverCandidate).not.toHaveBeenCalled();
    expect(f.store.preview).not.toHaveBeenCalled();
    expect(f.store.schedule).not.toHaveBeenCalled();
  });

  it("fails a stale capability generation before decrypting or requesting a key", async () => {
    const f = fixture();
    f.store.nextDue.mockResolvedValue({ ...f.base, capabilityVersion: "old-mapping" });
    expect(await f.service.processNext()).toBe(true);
    expect(f.store.failBeforeActivation).toHaveBeenCalledWith(f.base.id, 1, "coverage_changed");
    expect(f.provider.verifyKey).not.toHaveBeenCalled();
    expect(f.store.activate).not.toHaveBeenCalled();
  });
});
