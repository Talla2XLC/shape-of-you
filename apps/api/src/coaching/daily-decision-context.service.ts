import { Inject, Injectable } from "@nestjs/common";

import type { DailyDecisionContextResult } from "@shape-of-you/contracts";

import { DailyAssessmentEvidenceChangedError } from "../domain/errors.js";
import { TrainingService } from "../training/training.service.js";
import { CurrentRecoveryContextService } from "./current-recovery-context.service.js";
import { DailyAssessmentService } from "./daily-assessment.service.js";

/** Composes current owner facts for Coach without exporting the legacy API decision. */
@Injectable()
export class DailyDecisionContextService {
  public constructor(
    @Inject(DailyAssessmentService) private readonly dailyAssessment: DailyAssessmentService,
    @Inject(CurrentRecoveryContextService) private readonly currentRecovery: CurrentRecoveryContextService,
    @Inject(TrainingService) private readonly training: TrainingService
  ) {}

  /** Reads one consistent Person-local fact set and retains timezone failure as a typed result. */
  public async read(): Promise<DailyDecisionContextResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const assessment = await this.dailyAssessment.readDecisionFacts();
      if (assessment.state === "timezone_required") return assessment;
      const [recovery, training] = await Promise.all([
        this.currentRecovery.read(),
        this.training.getTrainingContext({ localDate: assessment.localDate, historyLimit: 20 })
      ]);
      const verified = await this.dailyAssessment.readDecisionFacts();
      if (
        recovery.state !== "available" ||
        recovery.localDate !== assessment.localDate || recovery.timezone !== assessment.timezone ||
        verified.state !== "available" || verified.localDate !== assessment.localDate ||
        verified.timezone !== assessment.timezone ||
        verified.evidenceChecksum !== assessment.evidenceChecksum ||
        (training.status === "active" ? training.program.activeVersionId : null) !==
          assessment.activeTrainingProgramVersionId ||
        JSON.stringify(training.nextStep) !== JSON.stringify(assessment.trainingNextStep)
      ) continue;
      return {
        state: "available",
        policyVersion: "daily-decision-context-v1",
        localDate: assessment.localDate,
        timezone: assessment.timezone,
        evidenceChecksum: assessment.evidenceChecksum,
        facts: assessment.facts,
        recovery,
        training: {
          activeProgramVersionId: assessment.activeTrainingProgramVersionId,
          nextStep: training.nextStep
        }
      };
    }
    throw new DailyAssessmentEvidenceChangedError();
  }
}
