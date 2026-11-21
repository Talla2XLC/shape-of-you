import { createHash } from "node:crypto";
import { ConnectedProviderDataService } from "../connected-provider-data/connected-provider-data.service.js";
import { Inject, Injectable, Optional } from "@nestjs/common";

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
    @Inject(TrainingService) private readonly training: TrainingService,
    @Optional() @Inject(ConnectedProviderDataService) private readonly connectedData: ConnectedProviderDataService | null = null
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
      const connectedNutritionDay = this.connectedData?.isConfigured()
        ? (await this.connectedData.nutrition(assessment.localDate)).item : null;
      const connectedDailyFitness = training.connectedDailyFitness ?? [];
      const verified = await this.dailyAssessment.readDecisionFacts();
      const verifiedConnected = this.connectedData?.isConfigured() ? await Promise.all([
        this.connectedData.nutrition(assessment.localDate),
        this.connectedData.fitness({ fromDate: assessment.localDate, toDate: assessment.localDate })
      ]) : null;
      if (verifiedConnected && (verifiedConnected[0].item?.id !== connectedNutritionDay?.id ||
        JSON.stringify(verifiedConnected[1].items.map(item => item.id).sort()) !== JSON.stringify(connectedDailyFitness.map(item => item.id).sort()))) continue;
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
        evidenceChecksum: connectedNutritionDay || connectedDailyFitness.length
          ? createHash("sha256").update(JSON.stringify([assessment.evidenceChecksum, connectedNutritionDay?.id ?? null, connectedDailyFitness.map(item => item.id).sort()])).digest("hex")
          : assessment.evidenceChecksum,
        ...(connectedNutritionDay ? { connectedNutritionDay } : {}),
        ...(connectedDailyFitness.length ? { connectedDailyFitness } : {}),
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
