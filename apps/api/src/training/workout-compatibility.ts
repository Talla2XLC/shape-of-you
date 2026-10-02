import type { LegacyWorkoutSession, PersonalRecordList, TrainingContext, WorkoutSession } from "@shape-of-you/contracts";
import { ConflictError } from "../domain/errors.js";

/**
 * Projects a completed fact into the frozen legacy output without hiding evidence.
 * @throws ConflictError when a V2 fact cannot be represented by a legacy client.
 */
export function legacyWorkoutSession(session: WorkoutSession): LegacyWorkoutSession {
  if (session.completionState === "in_progress" || session.exercises.some((exercise) =>
    exercise.exerciseId === null || exercise.exerciseVersionId === null || exercise.loadBasis === null ||
    exercise.sets.some((set) => set.reps === null && set.durationSeconds === null && set.distanceMeters === null)
  )) {
    throw new ConflictError("WorkoutSession requires the V2 read contract; no facts were omitted");
  }
  const legacy = { ...session };
  delete (legacy as Partial<WorkoutSession>).completionState;
  return legacy as LegacyWorkoutSession;
}

/** Preserves every item, or fails the entire legacy list explicitly. */
export function legacyWorkoutList(list: { readonly items: readonly WorkoutSession[] }) {
  return { items: list.items.map(legacyWorkoutSession) };
}

/** Preserves planned authority while applying the frozen session boundary. */
export function legacyTrainingContext(context: TrainingContext) {
  return { ...context, recentSessions: legacyWorkoutList(context.recentSessions) };
}


/** Rejects date-only record precision that the legacy strength-record output cannot express. */
export function legacyPersonalRecords(list: PersonalRecordList) {
  return { items: list.items.map((item) => {
    if (item.occurredAt === null) throw new ConflictError("PersonalRecord requires the V2 read contract");
    return { exerciseId: item.exerciseId, exerciseVersionId: item.exerciseVersionId, exerciseLabel: item.exerciseLabel,
      sessionId: item.sessionId, performedSetId: item.performedSetId, weightKg: item.weightKg, reps: item.reps, occurredAt: item.occurredAt };
  }) };
}
