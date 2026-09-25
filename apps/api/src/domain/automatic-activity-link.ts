/** Current detailed session fields needed for a conservative activity match. */
export interface ActivityLinkSessionCandidate {
  readonly id: string;
  readonly localDate: string;
  readonly occurredAt: string | null;
  readonly workoutName: string;
  readonly programVersionId: string | null;
  readonly programWorkoutPosition: number | null;
  readonly programWorkoutName: string | null;
  readonly trustedExternalTitle: string | null;
  readonly hasStrengthSets: boolean;
  readonly sourceChannel: string;
  readonly sourceExternalSystem: string | null;
  readonly sourceExternalRecordId: string | null;
}

/** Current imported activity fields needed for a conservative session match. */
export interface ActivityLinkExternalCandidate {
  readonly id: string;
  readonly localDate: string;
  readonly occurredAt: string;
  readonly name: string;
  readonly durationSeconds: number;
  readonly distanceMeters: number | null;
  readonly garminAttributed: boolean;
  readonly sourceProvider: string;
  readonly providerIdentity: string;
  readonly classification?: {
    readonly kind: "program_workout" | "not_program_workout";
    readonly programVersionId: string;
    readonly workoutPosition: number | null;
  } | null;
}

/** Persisted reason for an automatic association. */
export type AutomaticActivityLinkBasis = "source_identity" | "trusted_title_and_time" | "confirmed_recording_context";

export interface AutomaticActivityLink {
  readonly sessionId: string;
  readonly externalActivityId: string;
  readonly basis: AutomaticActivityLinkBasis;
}

const START_TOLERANCE_MS = 15 * 60_000;
const MIN_STRENGTH_DURATION_SECONDS = 10 * 60;
function normalizedName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("und");
}

function candidateBasis(
  session: ActivityLinkSessionCandidate,
  activity: ActivityLinkExternalCandidate,
  confirmedRecordingModeTitle: string | null
): AutomaticActivityLinkBasis | null {
  if (session.localDate !== activity.localDate) return null;
  if (activity.classification !== null && activity.classification !== undefined) {
    if (
      activity.classification.kind !== "program_workout" ||
      session.programVersionId !== activity.classification.programVersionId ||
      session.programWorkoutPosition !== activity.classification.workoutPosition
    ) return null;
  }
  if (
    session.sourceChannel === "import" &&
    session.sourceExternalSystem === "intervals_icu" &&
    session.sourceExternalRecordId !== null &&
    session.sourceExternalRecordId === activity.providerIdentity
  ) return "source_identity";

  if (session.occurredAt === null || !session.hasStrengthSets ||
    !activity.garminAttributed || activity.distanceMeters !== null) return null;
  const startDifference = Math.abs(Date.parse(session.occurredAt) - Date.parse(activity.occurredAt));
  if (!Number.isFinite(startDifference) || startDifference > START_TOLERANCE_MS) return null;
  const exactProgramWorkout = session.programVersionId !== null &&
    session.programWorkoutPosition !== null && session.programWorkoutName !== null &&
    normalizedName(session.workoutName) === normalizedName(session.programWorkoutName);
  if (exactProgramWorkout && session.trustedExternalTitle !== null &&
    normalizedName(session.trustedExternalTitle) === normalizedName(activity.name)) {
    return "trusted_title_and_time";
  }
  if (confirmedRecordingModeTitle === null ||
    normalizedName(confirmedRecordingModeTitle) !== normalizedName(activity.name) ||
    activity.sourceProvider !== "intervals_icu" ||
    activity.durationSeconds < MIN_STRENGTH_DURATION_SECONDS) return null;
  if (session.programVersionId !== null && !exactProgramWorkout) return null;
  return "confirmed_recording_context";
}

/** Lists all evidence-compatible pairs before reciprocal-uniqueness selection. */
export function findActivityLinkCandidates(
  sessions: readonly ActivityLinkSessionCandidate[],
  activities: readonly ActivityLinkExternalCandidate[],
  confirmedRecordingModeTitle: string | null = null
): readonly AutomaticActivityLink[] {
  const candidates: AutomaticActivityLink[] = [];
  for (const session of sessions) {
    for (const activity of activities) {
      const basis = candidateBasis(session, activity, confirmedRecordingModeTitle);
      if (basis !== null) candidates.push({ sessionId: session.id, externalActivityId: activity.id, basis });
    }
  }
  return candidates;
}

/** Selects only reciprocal single-candidate pairs; tied evidence fails closed. */
export function findAutomaticActivityLinks(
  sessions: readonly ActivityLinkSessionCandidate[],
  activities: readonly ActivityLinkExternalCandidate[],
  confirmedRecordingModeTitle: string | null = null
): readonly AutomaticActivityLink[] {
  const candidates = findActivityLinkCandidates(sessions, activities, confirmedRecordingModeTitle);
  const sessionCounts = new Map<string, number>();
  const activityCounts = new Map<string, number>();
  for (const candidate of candidates) {
    sessionCounts.set(candidate.sessionId, (sessionCounts.get(candidate.sessionId) ?? 0) + 1);
    activityCounts.set(candidate.externalActivityId, (activityCounts.get(candidate.externalActivityId) ?? 0) + 1);
  }
  return candidates.filter((candidate) =>
    sessionCounts.get(candidate.sessionId) === 1 && activityCounts.get(candidate.externalActivityId) === 1
  );
}
