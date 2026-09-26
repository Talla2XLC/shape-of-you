import type { TrainingProgramVersion, WorkoutSession } from "@shape-of-you/contracts";

type ProgramPrescription = TrainingProgramVersion["workouts"][number]["prescriptions"][number];

/** Read-only result for one exact active-program exercise. */
export interface TrainingProgressionDecision {
  readonly action: "hold" | "add_reps" | "add_weight" | "insufficient_evidence";
  readonly reason:
    | "no_detailed_session" | "incomplete_sets" | "ambiguous_exercise" | "ambiguous_prescription"
    | "unsupported_load_basis" | "weight_mismatch" | "rir_missing"
    | "below_repetition_range" | "rir_below_target" | "repetitions_available"
    | "second_session_needed" | "increment_missing" | "increment_too_large"
    | "two_sessions_qualified";
  readonly suggestedReps: readonly number[] | null;
  readonly suggestedTargetWeightKg: number | null;
  readonly evidenceSessionIds: readonly string[];
}

type SessionResult =
  | { readonly state: "complete"; readonly reps: readonly number[]; readonly allAtMax: boolean }
  | { readonly state: "incomplete"; readonly reason: TrainingProgressionDecision["reason"] };

function assessSession(
  prescription: ProgramPrescription,
  session: WorkoutSession
): SessionResult {
  const matching = session.exercises.filter((exercise) =>
    exercise.exerciseVersionId === prescription.exerciseVersionId &&
    exercise.loadBasis === prescription.loadBasis
  );
  if (matching.length !== 1) {
    return { state: "incomplete", reason: matching.length > 1 ? "ambiguous_exercise" : "incomplete_sets" };
  }
  const sets = matching[0]!.sets.slice(0, prescription.targetSets);
  if (sets.length !== prescription.targetSets || sets.some((set) => set.reps === null || set.weightKg === null)) {
    return { state: "incomplete", reason: "incomplete_sets" };
  }
  if (sets.some((set) => set.weightKg !== prescription.targetWeightKg)) {
    return { state: "incomplete", reason: "weight_mismatch" };
  }
  if (sets.some((set) => set.rir === null)) {
    return { state: "incomplete", reason: "rir_missing" };
  }
  const reps = sets.map((set) => set.reps!);
  if (reps.some((value) => value < prescription.targetRepsMin)) {
    return { state: "incomplete", reason: "below_repetition_range" };
  }
  if (prescription.targetRir !== null && sets.some((set) => set.rir! < prescription.targetRir!)) {
    return { state: "incomplete", reason: "rir_below_target" };
  }
  return { state: "complete", reps, allAtMax: reps.every((value) => value >= prescription.targetRepsMax) };
}

/**
 * Evaluates only detailed current sessions for the exact program workout.
 * Sessions must be supplied newest first. External activity is never set evidence.
 */
export function evaluateTrainingProgression(
  programVersionId: string,
  workoutPosition: number,
  prescription: ProgramPrescription,
  sessions: readonly WorkoutSession[],
  throughLocalDate: string,
  duplicatePrescription = false
): TrainingProgressionDecision {
  const relevant = sessions.filter((session) =>
    session.programVersionId === programVersionId &&
    session.programWorkoutPosition === workoutPosition &&
    session.localDate <= throughLocalDate
  ).slice(0, 2);
  const ids = relevant.map((session) => session.id);
  const result = (
    action: TrainingProgressionDecision["action"],
    reason: TrainingProgressionDecision["reason"],
    suggestedReps: readonly number[] | null = null,
    suggestedTargetWeightKg: number | null = null
  ): TrainingProgressionDecision => ({ action, reason, suggestedReps, suggestedTargetWeightKg, evidenceSessionIds: ids });

  if (duplicatePrescription) return result("insufficient_evidence", "ambiguous_prescription");
  if (prescription.loadBasis !== "external_weight" || prescription.targetWeightKg === null || prescription.targetWeightKg <= 0) {
    return result("insufficient_evidence", "unsupported_load_basis");
  }
  if (relevant.length === 0) return result("insufficient_evidence", "no_detailed_session");
  const latest = assessSession(prescription, relevant[0]!);
  if (latest.state === "incomplete") {
    return result(latest.reason === "below_repetition_range" || latest.reason === "rir_below_target" ? "hold" : "insufficient_evidence", latest.reason);
  }
  if (!latest.allAtMax) {
    return result("add_reps", "repetitions_available", latest.reps.map((reps) => Math.min(prescription.targetRepsMax, reps + 1)));
  }
  if (relevant.length < 2) return result("hold", "second_session_needed");
  const previous = assessSession(prescription, relevant[1]!);
  if (previous.state !== "complete" || !previous.allAtMax) return result("hold", "second_session_needed");
  const increment = prescription.progressionIncrementKg;
  if (increment === null || increment <= 0) return result("hold", "increment_missing");
  if (increment > 5 || increment / prescription.targetWeightKg > 0.1) return result("hold", "increment_too_large");
  return result("add_weight", "two_sessions_qualified", null,
    Math.round((prescription.targetWeightKg + increment) * 1000) / 1000);
}
