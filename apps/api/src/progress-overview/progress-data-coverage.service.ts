import { Inject, Injectable } from "@nestjs/common";

import type { ProgressDataCoverage, ProgressDataCoverageQuery } from "@shape-of-you/contracts";

import { assertIanaTimezone, assertLocalDate } from "../domain/date-context.js";
import { NutritionService } from "../nutrition/nutrition.service.js";
import { RecoveryService } from "../recovery/recovery.service.js";
import { TrainingService } from "../training/training.service.js";
import { WeightMeasurementService } from "../weight-measurements/weight-measurement.service.js";
import { buildCoverageDirection, shiftLocalDate } from "./progress-data-coverage.policy.js";

/** Coordinates provider-neutral module summaries into recommendation-context readiness. */
@Injectable()
export class ProgressDataCoverageService {
  public constructor(
    @Inject(WeightMeasurementService) private readonly weights: WeightMeasurementService,
    @Inject(NutritionService) private readonly nutrition: NutritionService,
    @Inject(TrainingService) private readonly training: TrainingService,
    @Inject(RecoveryService) private readonly recovery: RecoveryService
  ) {}

  /** Reads current evidence through a constant number of module-owned summaries. */
  public async read(query: ProgressDataCoverageQuery): Promise<ProgressDataCoverage> {
    assertLocalDate(query.localDate);
    assertIanaTimezone(query.timezone);
    const completedThrough = shiftLocalDate(query.localDate, -1);
    const recentFrom = shiftLocalDate(query.localDate, -90);
    const [weight, nutrition, training, recovery] = await Promise.all([
      this.weights.getDataCoverage(recentFrom, query.localDate, query.localDate),
      this.nutrition.getDataCoverage(recentFrom, query.localDate, query.localDate),
      this.training.getDataCoverage(recentFrom, query.localDate, query.localDate),
      this.recovery.getDataCoverage(recentFrom, query.localDate, query.localDate)
    ]);
    return {
      localDate: query.localDate,
      completedThrough,
      timezone: query.timezone,
      policyVersion: "profile-data-coverage-v1",
      directions: [
        buildCoverageDirection("sleep", query.localDate, recovery.sleep),
        buildCoverageDirection("hrv", query.localDate, recovery.hrv),
        buildCoverageDirection("resting_heart_rate", query.localDate, recovery.restingHeartRate),
        buildCoverageDirection("body_battery", query.localDate, recovery.bodyBattery),
        buildCoverageDirection("training", query.localDate, training),
        buildCoverageDirection("weight", query.localDate, weight),
        buildCoverageDirection("nutrition", query.localDate, nutrition)
      ]
    };
  }
}
