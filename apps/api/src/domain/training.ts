import type {
  CreateTrainingProgram,
  CreateTrainingProgramVersion
} from "@shape-of-you/contracts";

import { DomainValidationError } from "./errors.js";

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
  input: CreateTrainingProgram | CreateTrainingProgramVersion
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
