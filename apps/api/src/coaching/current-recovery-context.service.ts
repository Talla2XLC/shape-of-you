import { Inject, Injectable } from "@nestjs/common";

import type {
  ConnectedRecoveryMetricDelivery,
  CurrentRecoveryObservation,
  CurrentRecoveryContextResult,
  RecoveryObservation
} from "@shape-of-you/contracts";

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
import {
  CONNECTED_RECOVERY_METRIC_KEYS,
  type IntegrationStore
} from "../integrations/integration-store.js";
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
    const internalMetricDelivery = delivery?.metricDelivery ?? CONNECTED_RECOVERY_METRIC_KEYS.map(
      (metric) => ({ metric, state: "unknown" as const, observationId: null })
    );
    const metricDelivery = internalMetricDelivery.map((item): ConnectedRecoveryMetricDelivery => {
      const observation = findConnectedObservation(
        observations.items,
        item.metric,
        delivery?.recoveryConnectionId ?? null
      );
      const state = reconcileDeliveryState(item.state, item.observationId, observation);
      if (item.metric !== "steps") {
        return { metric: item.metric, state, periodState: null, asOf: null };
      }
      const asOf = observation?.sourceReference.occurredAt ?? null;
      return {
        metric: "steps",
        state,
        periodState: asOf !== null ? "partial_day" as const : null,
        asOf
      };
    }) ?? [];
    const freshness = evaluateConnectedRecoveryFreshness(
      delivery === null ? null : {
        ...delivery,
        targetDateSupportedFactsPresent: metricDelivery.some(
          (item) => item.state === "confirmed_present"
        )
      },
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
      metricDelivery,
      observations: {
        items: observations.items.map(toCurrentRecoveryObservation)
      }
    };
  }
}

function toCurrentRecoveryObservation(
  observation: RecoveryObservation
): CurrentRecoveryObservation {
  return {
    kind: observation.kind,
    observedFrom: observation.observedFrom,
    observedUntil: observation.observedUntil,
    temporalPrecision: observation.temporalPrecision,
    localDate: observation.localDate,
    timezone: observation.timezone,
    quality: observation.quality,
    detail: observation.detail
  };
}

function findConnectedObservation(
  observations: readonly RecoveryObservation[],
  metric: string,
  recoveryConnectionId: string | null
): RecoveryObservation | undefined {
  if (recoveryConnectionId === null) return undefined;
  return observations.find((observation) => (
    observation.connectionId === recoveryConnectionId
    && (metric === "sleep"
      ? observation.detail.type === "sleep"
      : observation.detail.type === "metric" && observation.detail.metric === metric)
  ));
}

function reconcileDeliveryState(
  state: ConnectedRecoveryMetricDelivery["state"],
  publishedObservationId: string | null,
  observation: RecoveryObservation | undefined
): ConnectedRecoveryMetricDelivery["state"] {
  if (observation) {
    return state === "confirmed_present" && publishedObservationId === observation.id
      ? "confirmed_present"
      : "retained_unconfirmed";
  }
  return state === "confirmed_absent" ? "confirmed_absent" : "unknown";
}
