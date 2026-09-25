import { describe, expect, it } from "vitest";

import {
  findAutomaticActivityLinks,
  type ActivityLinkExternalCandidate,
  type ActivityLinkSessionCandidate
} from "../src/domain/automatic-activity-link.js";
import { countUncoveredExternalActivities } from "../src/domain/training.js";

const session: ActivityLinkSessionCandidate = {
  id: "session-a", localDate: "2026-09-23", occurredAt: "2026-09-23T16:00:00.000Z",
  workoutName: "Ahilej B", programVersionId: "version-a", programWorkoutPosition: 2,
  programWorkoutName: "Ahilej B", trustedExternalTitle: null, hasStrengthSets: true,
  sourceChannel: "manual", sourceExternalSystem: null, sourceExternalRecordId: null
};
const activity: ActivityLinkExternalCandidate = {
  id: "activity-a", localDate: "2026-09-23", occurredAt: "2026-09-23T16:07:00.000Z",
  name: "Ahilej B", distanceMeters: null, garminAttributed: true,
  providerIdentity: "intervals-activity-a"
};

describe("automatic activity association", () => {
  it("accepts an exact provider record identity even for a date-only session", () => {
    expect(findAutomaticActivityLinks([{
      ...session, occurredAt: null, programVersionId: null,
      programWorkoutPosition: null, sourceChannel: "import", sourceExternalSystem: "intervals_icu",
      sourceExternalRecordId: activity.providerIdentity
    }], [{ ...activity, name: "Strength Training" }])).toEqual([{
      sessionId: session.id, externalActivityId: activity.id, basis: "source_identity"
    }]);
  });

  it("accepts one typed program workout only after its external title is trusted", () => {
    expect(findAutomaticActivityLinks([session], [activity])).toEqual([]);
    expect(findAutomaticActivityLinks([{
      ...session, trustedExternalTitle: "Ahilej B"
    }], [activity])).toEqual([{
      sessionId: session.id, externalActivityId: activity.id, basis: "trusted_title_and_time"
    }]);
  });

  it("rejects time alone, generic names, date-only sessions, and unpinned programs", () => {
    expect(findAutomaticActivityLinks([session], [{ ...activity, name: "Strength Training" }])).toEqual([]);
    expect(findAutomaticActivityLinks([{ ...session, workoutName: "Strength Training" }], [{ ...activity, name: "Strength Training" }])).toEqual([]);
    expect(findAutomaticActivityLinks([{ ...session, occurredAt: null }], [activity])).toEqual([]);
    expect(findAutomaticActivityLinks([{ ...session, programWorkoutPosition: null }], [activity])).toEqual([]);
    expect(findAutomaticActivityLinks([{ ...session, programWorkoutName: "Other" }], [activity])).toEqual([]);
  });

  it.each([
    "Strength Workout", "Strength Session", "Functional Strength", "Morning Strength",
    "Indoor Strength Training", "Weight Lifting", "Gym Workout 2",
    "Силовая тренировка", "Тренировка в зале"
    , "HIIT Workout", "Cardio Workout", "Yoga Workout"
  ])("does not infer identity from an untrusted Garmin title: %s", (name) => {
    expect(findAutomaticActivityLinks([{
      ...session, workoutName: name, programWorkoutName: name
    }], [{ ...activity, name }])).toEqual([]);
  });

  it("rejects incompatible evidence and a nearby competing workout", () => {
    const trusted = { ...session, trustedExternalTitle: "Ahilej B" };
    expect(findAutomaticActivityLinks([trusted], [{ ...activity, distanceMeters: 100 }])).toEqual([]);
    expect(findAutomaticActivityLinks([trusted], [{ ...activity, garminAttributed: false }])).toEqual([]);
    expect(findAutomaticActivityLinks([trusted], [{ ...activity, occurredAt: "2026-09-23T17:00:00.000Z" }])).toEqual([]);
    expect(findAutomaticActivityLinks([trusted, { ...trusted, id: "session-b" }], [activity])).toEqual([]);
    expect(findAutomaticActivityLinks([trusted], [activity, { ...activity, id: "activity-b" }])).toEqual([]);
  });

  it("does not suppress independent user classification with a conflicting session", () => {
    expect(findAutomaticActivityLinks([{ ...session, programVersionId: null }], [{
      ...activity,
      classification: { kind: "program_workout", programVersionId: "version-a", workoutPosition: 2 }
    }])).toEqual([]);
    expect(findAutomaticActivityLinks([session], [{
      ...activity,
      classification: { kind: "not_program_workout", programVersionId: "version-a", workoutPosition: null }
    }])).toEqual([]);
    expect(findAutomaticActivityLinks([{ ...session, trustedExternalTitle: "Ahilej B" }], [{
      ...activity,
      classification: { kind: "program_workout", programVersionId: "version-a", workoutPosition: 2 }
    }])).toHaveLength(1);
  });

  it("counts a linked detailed session and external load source as one occurrence", () => {
    expect(countUncoveredExternalActivities(
      [{ externalActivityId: "activity-a" }],
      [{ id: "activity-a" }, { id: "activity-b" }]
    )).toBe(1);
  });
});
