import type {
  CreateTrainingProgram,
  CreateTrainingProgramVersion,
  ExternalActivitySummary,
  NextTrainingStep,
  SaveConfirmedTrainingProgram,
  TrainingProgram,
  TrainingProgramCadence,
  WorkoutSession,
  TrainingProgramVersion
} from "@shape-of-you/contracts";

import { DomainValidationError } from "./errors.js";

/** Resolved program snapshot whose prescriptions pin immutable ExerciseVersions. */
export interface ResolvedTrainingProgramSnapshot {
  readonly name: string;
  readonly note: string | null;
  readonly cadence: TrainingProgramCadence | null;
  readonly workouts: readonly {
    readonly name: string;
    readonly prescriptions: readonly {
      readonly exerciseVersionId: string;
      readonly loadBasis: "external_weight" | "body_weight" | "assisted";
      readonly targetWeightKg: number | null;
      readonly targetSets: number;
      readonly targetRepsMin: number;
      readonly targetRepsMax: number;
      readonly targetRir: number | null;
      readonly progressionIncrementKg: number | null;
      readonly note: string | null;
    }[];
  }[];
}

/** Minimal set result used to evaluate one progression prescription. */
export interface ProgressionEvidenceSet {
  /** Completed repetitions. */
  readonly reps: number;
  /** Reported repetitions in reserve, when known. */
  readonly rir: number | null;
}

/** Parameters that make an explicit weight progression deterministic. */
export interface ProgressionPrescription {
  /** Required number of completed sets. */
  readonly targetSets: number;
  /** Upper repetition target that every counted set must meet. */
  readonly targetRepsMax: number;
  /** Minimum acceptable repetitions in reserve, when configured. */
  readonly targetRir: number | null;
  /** Current prescribed external or assistance weight. */
  readonly targetWeightKg: number | null;
  /** Explicit weight increment; null disables automatic candidacy. */
  readonly progressionIncrementKg: number | null;
}

/** Tests access to a shared or Person-private exercise identity. */
export function canAccessTrainingExercise(
  visibility: "shared" | "private",
  ownerPersonId: string | null,
  personId: string
): boolean {
  return visibility === "shared" || ownerPersonId === personId;
}

/**
 * Validates cross-field invariants for one program version command.
 *
 * @throws DomainValidationError when a repetition range or increment is invalid.
 */
export function validateTrainingProgramVersion(
  input:
    | CreateTrainingProgram
    | CreateTrainingProgramVersion
    | SaveConfirmedTrainingProgram
    | ResolvedTrainingProgramSnapshot
): void {
  for (const workout of input.workouts) {
    for (const prescription of workout.prescriptions) {
      if (prescription.targetRepsMin > prescription.targetRepsMax) {
        throw new DomainValidationError(
          "targetRepsMin cannot exceed targetRepsMax"
        );
      }
      if (
        prescription.progressionIncrementKg !== null &&
        prescription.progressionIncrementKg <= 0
      ) {
        throw new DomainValidationError(
          "progressionIncrementKg must be positive when supplied"
        );
      }
    }
  }
  const cadence = input.cadence ?? null;
  if (cadence !== null) {
    const positions = new Set(input.workouts.map((_workout, index) => index + 1));
    if (cadence.workoutSequence.some((position) => !positions.has(position))) {
      throw new DomainValidationError("cadence workoutSequence must reference an existing workout position");
    }
    if (cadence.lightCardio !== null) {
      if (cadence.lightCardio.targetAverageHeartRateMin > cadence.lightCardio.targetAverageHeartRateMax) {
        throw new DomainValidationError("light-cardio minimum heart rate cannot exceed maximum heart rate");
      }
      if (
        cadence.lightCardio.warmupSeconds + cadence.lightCardio.workSeconds +
          cadence.lightCardio.cooldownSeconds !== cadence.lightCardio.durationSeconds
      ) {
        throw new DomainValidationError("light-cardio phases must add up to durationSeconds");
      }
    }
  }
}

/**
 * Compares an active immutable version with a confirmed snapshot by domain
 * meaning, excluding generated identifiers, labels, positions, and timestamps.
 */
export function trainingProgramSnapshotMatches(
  active: TrainingProgramVersion,
  confirmed: ResolvedTrainingProgramSnapshot
): boolean {
  if (
    active.name !== confirmed.name ||
    active.note !== confirmed.note ||
    JSON.stringify(active.cadence) !== JSON.stringify(confirmed.cadence) ||
    active.workouts.length !== confirmed.workouts.length
  ) {
    return false;
  }

  return active.workouts.every((activeWorkout, workoutIndex) => {
    const confirmedWorkout = confirmed.workouts[workoutIndex];
    if (
      !confirmedWorkout ||
      activeWorkout.name !== confirmedWorkout.name ||
      activeWorkout.prescriptions.length !==
        confirmedWorkout.prescriptions.length
    ) {
      return false;
    }

    return activeWorkout.prescriptions.every(
      (activePrescription, prescriptionIndex) => {
        const confirmedPrescription =
          confirmedWorkout.prescriptions[prescriptionIndex];
        return Boolean(
          confirmedPrescription &&
            activePrescription.exerciseVersionId ===
              confirmedPrescription.exerciseVersionId &&
            activePrescription.loadBasis === confirmedPrescription.loadBasis &&
            activePrescription.targetWeightKg ===
              confirmedPrescription.targetWeightKg &&
            activePrescription.targetSets === confirmedPrescription.targetSets &&
            activePrescription.targetRepsMin ===
              confirmedPrescription.targetRepsMin &&
            activePrescription.targetRepsMax ===
              confirmedPrescription.targetRepsMax &&
            activePrescription.targetRir === confirmedPrescription.targetRir &&
            activePrescription.progressionIncrementKg ===
              confirmedPrescription.progressionIncrementKg &&
            activePrescription.note === confirmedPrescription.note
        );
      }
    );
  });
}

export const TRAINING_NEXT_STEP_POLICY_VERSION = "training-next-step-v1" as const;

function localWeekStart(localDate: string): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function qualifiesAsLightCardio(
  activity: ExternalActivitySummary,
  cardio: NonNullable<TrainingProgramCadence["lightCardio"]>
): boolean {
  const durationFloor = Math.round(cardio.durationSeconds * 0.9);
  const durationCeiling = Math.round(cardio.durationSeconds * 1.1);
  return activity.distanceMeters !== null && activity.distanceMeters > 0 &&
    activity.averageHeartRate !== null &&
    activity.durationSeconds >= durationFloor &&
    activity.durationSeconds <= durationCeiling &&
    activity.averageHeartRate >= cardio.targetAverageHeartRateMin - 5 &&
    activity.averageHeartRate <= cardio.targetAverageHeartRateMax + 5;
}

/**
 * Computes the next rolling program step from immutable plan and current facts.
 * It never parses labels and only merges detailed/external evidence by exact id.
 */
export function evaluateNextTrainingStep(input: {
  readonly program: TrainingProgram | null;
  readonly localDate: string | null;
  readonly sessions: readonly WorkoutSession[];
  readonly externalActivities: readonly ExternalActivitySummary[];
}): NextTrainingStep {
  const policyVersion = TRAINING_NEXT_STEP_POLICY_VERSION;
  if (input.program === null || input.program.activeVersion === null) {
    return { state: "no_active_program", policyVersion };
  }
  if (input.localDate === null) {
    return { state: "local_date_required", policyVersion };
  }
  const localDate = input.localDate;
  const active = input.program.activeVersion;
  const cadence = active.cadence;
  if (cadence === null) {
    return { state: "schedule_unavailable", policyVersion };
  }

  const weekStart = localWeekStart(localDate);
  const linkedActivityIds = new Set(
    input.sessions.flatMap((session) => session.externalActivityId === null ? [] : [session.externalActivityId])
  );
  const classified = input.sessions
    .filter((session) =>
      session.programVersionId === active.id && session.programWorkoutPosition !== null &&
      session.localDate >= weekStart && session.localDate <= localDate
    )
    .sort((left, right) =>
      left.localDate.localeCompare(right.localDate) ||
      (left.occurredAt ?? left.createdAt).localeCompare(right.occurredAt ?? right.createdAt)
    );
  const cardio = cadence.lightCardio;
  const qualifyingCardio = cardio === null ? [] : input.externalActivities
    .filter((activity) =>
      !linkedActivityIds.has(activity.id) &&
      activity.localDate >= weekStart && activity.localDate <= localDate &&
      qualifiesAsLightCardio(activity, cardio)
    )
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const todayEvidenceIds = [
    ...classified.filter((session) => session.localDate === localDate).map((session) => session.id),
    ...qualifyingCardio.filter((activity) => activity.localDate === localDate).map((activity) => activity.id)
  ];
  if (todayEvidenceIds.length > 0) {
    return {
      state: "complete_today",
      policyVersion,
      localDate,
      reason: "training_already_completed_today",
      evidenceIds: [...new Set(todayEvidenceIds)]
    };
  }

  const lastClassified = classified.at(-1) ?? null;
  const unclassified = input.externalActivities
    .filter((activity) =>
      !linkedActivityIds.has(activity.id) && activity.distanceMeters === null &&
      activity.localDate >= weekStart && activity.localDate <= localDate &&
      (lastClassified === null || activity.occurredAt > (lastClassified.occurredAt ?? `${lastClassified.localDate}T23:59:59.999Z`))
    )
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0];
  if (unclassified) {
    return {
      state: "needs_classification",
      policyVersion,
      localDate,
      externalActivityId: unclassified.id,
      question: "Последняя силовая была тренировкой A или B?"
    };
  }

  const cardioCount = qualifyingCardio.length;
  const strengthCount = classified.length;
  const cardioTarget = cardio?.sessionsPerWeek ?? 0;
  if (strengthCount >= cadence.strengthSessionsPerWeek && cardioCount >= cardioTarget) {
    return {
      state: "week_complete",
      policyVersion,
      localDate,
      reason: "weekly_targets_completed",
      evidenceIds: [...classified.map((session) => session.id), ...qualifyingCardio.map((activity) => activity.id)]
    };
  }

  const lastCardio = qualifyingCardio.at(-1) ?? null;
  const lastStrengthInstant = lastClassified?.occurredAt ?? (lastClassified ? `${lastClassified.localDate}T23:59:59.999Z` : null);
  if (
    cardio !== null && cardioCount < cardio.sessionsPerWeek &&
    (strengthCount >= cadence.strengthSessionsPerWeek ||
      (lastClassified !== null && (lastCardio === null || lastStrengthInstant! > lastCardio.occurredAt)))
  ) {
    return {
      state: "light_cardio",
      policyVersion,
      localDate,
      reason: strengthCount >= cadence.strengthSessionsPerWeek
        ? "strength_target_completed"
        : "between_strength_sessions",
      prescription: {
        durationSeconds: cardio.durationSeconds,
        targetAverageHeartRateMin: cardio.targetAverageHeartRateMin,
        targetAverageHeartRateMax: cardio.targetAverageHeartRateMax,
        warmupSeconds: cardio.warmupSeconds,
        workSeconds: cardio.workSeconds,
        cooldownSeconds: cardio.cooldownSeconds
      }
    };
  }

  const sequence = cadence.workoutSequence;
  let nextPosition = sequence[0]!;
  let reason: Extract<NextTrainingStep, { state: "strength" }>["reason"] = "sequence_start";
  if (lastClassified !== null) {
    const index = sequence.lastIndexOf(lastClassified.programWorkoutPosition!);
    nextPosition = sequence[(index >= 0 ? index + 1 : 0) % sequence.length]!;
    const previous = classified.at(-2);
    const previousIndex = previous ? sequence.lastIndexOf(previous.programWorkoutPosition!) : -1;
    const expectedLast = previousIndex >= 0 ? sequence[(previousIndex + 1) % sequence.length] : null;
    reason = expectedLast !== null && expectedLast !== lastClassified.programWorkoutPosition
      ? "sequence_reanchored_after_deviation"
      : "sequence_continues";
  } else if (lastCardio !== null) {
    reason = "after_cardio";
  } else if (cardioCount >= cardioTarget && cardioTarget > 0) {
    reason = "cardio_target_completed";
  }
  const workout = active.workouts.find((candidate) => candidate.position === nextPosition);
  if (!workout) {
    throw new DomainValidationError("cadence references a missing active workout");
  }
  return {
    state: "strength",
    policyVersion,
    localDate,
    programVersionId: active.id,
    workoutPosition: workout.position,
    workoutName: workout.name,
    reason
  };
}

/**
 * Calculates a next weight only when the explicit prescription is satisfied.
 *
 * Extra sets are allowed, but at least the prescribed number must meet the
 * upper repetition target and configured RIR floor. No implicit increment is
 * invented when the program omits one.
 */
export function calculateProgressionWeight(
  prescription: ProgressionPrescription,
  sets: readonly ProgressionEvidenceSet[]
): number | null {
  if (
    prescription.targetWeightKg === null ||
    prescription.progressionIncrementKg === null ||
    sets.length < prescription.targetSets
  ) {
    return null;
  }

  const counted = sets.slice(0, prescription.targetSets);
  const eligible = counted.every(
    (set) =>
      set.reps >= prescription.targetRepsMax &&
      (prescription.targetRir === null ||
        (set.rir !== null && set.rir >= prescription.targetRir))
  );

  if (!eligible) {
    return null;
  }

  return (
    Math.round(
      (prescription.targetWeightKg +
        prescription.progressionIncrementKg) *
        1000
    ) / 1000
  );
}
