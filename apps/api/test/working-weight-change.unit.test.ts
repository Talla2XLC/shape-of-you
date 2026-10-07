import { describe, expect, it, vi } from "vitest";

import type { WorkingWeightProposal } from "@shape-of-you/contracts";

import { DailyAssessmentService } from "../src/coaching/daily-assessment.service.js";

const versionId = "00000000-0000-4000-8000-000000000145";
const firstSession = "00000000-0000-4000-8000-000000000146";
const secondSession = "00000000-0000-4000-8000-000000000147";

function setup() {
  const localDate = new Date().toISOString().slice(0, 10);
  const candidate = {
    programId: "00000000-0000-4000-8000-000000000148",
    programLockVersion: 1,
    programVersionId: versionId,
    workoutPosition: 1,
    prescriptionPosition: 1,
    exerciseId: "00000000-0000-4000-8000-000000000149",
    exerciseVersionId: "00000000-0000-4000-8000-000000000150",
    exerciseLabel: "Press",
    currentTargetWeightKg: 50,
    suggestedTargetWeightKg: 52.5,
    evidenceSessionId: firstSession
  };
  const store = {
    getPreferences: vi.fn().mockResolvedValue({ timezone: "UTC" }),
    getEvidenceRevision: vi.fn().mockResolvedValue("b".repeat(64))
  };
  const training = {
    progressionCandidates: vi.fn().mockResolvedValue({ items: [candidate] }),
    findAppliedWorkingWeight: vi.fn().mockResolvedValue(null),
    applyConfirmedWorkingWeight: vi.fn().mockResolvedValue({ status: "applied", changeId: versionId, program: {} })
  };
  const service = new DailyAssessmentService(
    store as never, { getPersonId: () => candidate.programId } as never,
    {} as never, training as never, {} as never, {} as never, {} as never
  );
  vi.spyOn(service, "read").mockResolvedValue({
    state: "available", policyVersion: "daily-assessment-v6", status: "ready",
    localDate, evidenceChecksum: "a".repeat(64)
  } as never);
  vi.spyOn(service, "readTrainingProgression").mockResolvedValue({
    state: "available", reason: "ready", localDate, programVersionId: versionId,
    workoutPosition: 1, workoutName: "A", items: [{
      prescriptionPosition: 1, action: "add_weight", reason: "two_sessions_qualified", suggestedTargetWeightKg: 52.5,
      evidenceSessionIds: [firstSession, secondSession]
    }]
  } as never);
  return { service, store, training, candidate, localDate };
}

describe("confirmed working-weight safety composition", () => {
  it("offers an exact candidate only while Recovery and source revisions remain safe", async () => {
    const { service, store, training } = setup();
    const available = await service.readWorkingWeightProposals();
    expect(available).toMatchObject({ state: "available", items: [{
      currentTargetWeightKg: 50, suggestedTargetWeightKg: 52.5,
      evidenceSessionIds: [firstSession, secondSession]
    }] });
    vi.spyOn(service, "read").mockResolvedValueOnce({
      state: "available", policyVersion: "daily-assessment-v6", status: "caution",
      localDate: available.localDate
    } as never);
    await expect(service.readWorkingWeightProposals()).resolves.toMatchObject({
      state: "unavailable", reason: "recovery_not_ready", items: []
    });
    expect(training.progressionCandidates).toHaveBeenCalledTimes(1);
    store.getEvidenceRevision.mockResolvedValueOnce("b".repeat(64)).mockResolvedValueOnce("c".repeat(64));
    await expect(service.readWorkingWeightProposals()).resolves.toMatchObject({
      state: "unavailable", reason: "evidence_changed", items: []
    });
  });

  it("writes only the exact freshly approved proposal and rejects stale or missing confirmation", async () => {
    const { service, training } = setup();
    const offered = await service.readWorkingWeightProposals();
    const proposal = offered.items[0] as WorkingWeightProposal;
    const requestId = "00000000-0000-4000-8000-000000000151";
    await expect(service.applyConfirmedWorkingWeight({ requestId, confirmed: true, proposal }))
      .resolves.toMatchObject({ status: "applied" });
    expect(training.applyConfirmedWorkingWeight).toHaveBeenCalledOnce();
    await expect(service.applyConfirmedWorkingWeight({ requestId, confirmed: false, proposal } as never))
      .rejects.toThrow("Explicit confirmation");
    await expect(service.applyConfirmedWorkingWeight({ requestId, confirmed: true, proposal: {
      ...proposal, suggestedTargetWeightKg: 55
    } })).rejects.toThrow("changed");
    expect(training.applyConfirmedWorkingWeight).toHaveBeenCalledOnce();
  });

  it("rereads Recovery after confirmation and never writes when it becomes cautious", async () => {
    const { service, training, localDate } = setup();
    const offered = await service.readWorkingWeightProposals();
    vi.spyOn(service, "read").mockResolvedValueOnce({
      state: "available", policyVersion: "daily-assessment-v6", status: "caution",
      localDate, evidenceChecksum: "c".repeat(64)
    } as never);
    await expect(service.applyConfirmedWorkingWeight({
      requestId: "00000000-0000-4000-8000-000000000152",
      confirmed: true, proposal: offered.items[0]!
    })).rejects.toThrow("changed");
    expect(training.applyConfirmedWorkingWeight).not.toHaveBeenCalled();
  });
  it("offers and rechecks one exact high-reserve session without weakening Recovery", async () => {
    const { service, training, localDate } = setup();
    vi.spyOn(service, "readTrainingProgression").mockResolvedValue({
      state: "available", reason: "ready", localDate, programVersionId: versionId,
      workoutPosition: 1, workoutName: "A", items: [{ prescriptionPosition: 1,
        action: "add_weight", reason: "single_session_high_reserve", suggestedTargetWeightKg: 52.5,
        evidenceSessionIds: [firstSession] }]
    } as never);
    const offered = await service.readWorkingWeightProposals();
    expect(offered.items[0]?.evidenceSessionIds).toEqual([firstSession]);
    await expect(service.applyConfirmedWorkingWeight({ requestId: versionId, confirmed: true,
      proposal: offered.items[0]! })).resolves.toMatchObject({ status: "applied" });
    vi.spyOn(service, "read").mockResolvedValueOnce({ state: "available", status: "caution", localDate } as never);
    await expect(service.applyConfirmedWorkingWeight({ requestId: firstSession, confirmed: true,
      proposal: offered.items[0]! })).rejects.toThrow("changed");
    expect(training.applyConfirmedWorkingWeight).toHaveBeenCalledOnce();
  });

});
