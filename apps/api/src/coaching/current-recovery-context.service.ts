import { Inject, Injectable } from "@nestjs/common";

import type { CurrentRecoveryContextResult } from "@shape-of-you/contracts";

import type { PersonContext } from "../application/person-context.js";
import {
  DAILY_ASSESSMENT_STORE,
  INTEGRATION_STORE,
  PERSON_CONTEXT
} from "../application/tokens.js";
import {
  CONNECTED_RECOVERY_FRESHNESS_POLICY_VERSION,
  evaluateConnectedRecoveryFreshness
} from "../domain/connected-recovery-freshness.js";
import { assertIanaTimezone } from "../domain/date-context.js";
import type { IntegrationStore } from "../integrations/integration-store.js";
import { RecoveryService } from "../recovery/recovery.service.js";
import type { DailyAssessmentStore } from "../storage/daily-assessment-repository.js";
import { derivePersonLocalDate } from "./daily-assessment.service.js";

/** Composes current typed Recovery facts with safe connected-data freshness. */
@Injectable()
export class CurrentRecoveryContextService {
  public constructor(
    @Inject(PERSON_CONTEXT) private readonly personContext: PersonContext,
    @Inject(DAILY_ASSESSMENT_STORE) private readonly preferences: DailyAssessmentStore,
    @Inject(INTEGRATION_STORE) private readonly integrations: IntegrationStore | null,
    @Inject(RecoveryService) private readonly recovery: RecoveryService
  ) {}

  public async read(now = new Date()): Promise<CurrentRecoveryContextResult> {
    const personId = this.personContext.getPersonId();
    const preferences = await this.preferences.getPreferences(personId);
    if (preferences.timezone === null) return { state: "timezone_required", timezone: null };
    assertIanaTimezone(preferences.timezone);
    const timezone = preferences.timezone;
    const localDate = derivePersonLocalDate(timezone, now);
    const [observations, delivery] = await Promise.all([
      this.recovery.listObservations({ localDate, limit: 100 }),
      this.integrations?.connectedRecoveryDelivery(personId, localDate) ?? Promise.resolve(null)
    ]);
    const freshness = evaluateConnectedRecoveryFreshness(
      delivery,
      now,
      this.integrations !== null
    );
    return {
      state: "available",
      policyVersion: CONNECTED_RECOVERY_FRESHNESS_POLICY_VERSION,
      calculatedAt: now.toISOString(),
      localDate,
      timezone,
      ...freshness,
      observations
    };
  }
}
