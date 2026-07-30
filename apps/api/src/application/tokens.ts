/** Injection token for the configured dependency readiness probe. */
export const READINESS_PROBE = Symbol("READINESS_PROBE");

/** Injection token for the authorized Person resolution boundary. */
export const PERSON_CONTEXT = Symbol("PERSON_CONTEXT");

/** Injection token for the WeightMeasurement persistence boundary. */
export const WEIGHT_MEASUREMENT_STORE = Symbol("WEIGHT_MEASUREMENT_STORE");

/** Injection token for the BodyMeasurementSession persistence boundary. */
export const BODY_MEASUREMENT_SESSION_STORE = Symbol(
  "BODY_MEASUREMENT_SESSION_STORE"
);

/** Injection token for the PhysicalGoal persistence boundary. */
export const PHYSICAL_GOAL_STORE = Symbol("PHYSICAL_GOAL_STORE");
