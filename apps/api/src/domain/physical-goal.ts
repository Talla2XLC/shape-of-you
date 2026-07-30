import type {
  CreatePhysicalGoal,
  CreatePhysicalGoalVersion,
  PhysicalGoal,
  PhysicalGoalCriterion,
  PhysicalGoalCriterionInput,
  PhysicalGoalVersion
} from "@shape-of-you/contracts";

import type {
  PhysicalGoalCriterionRow,
  PhysicalGoalRow,
  PhysicalGoalVersionRow,
  SourceReferenceRow
} from "../database/schema.js";
import { DomainValidationError } from "./errors.js";
import { toSourceReference } from "./source-reference.js";

const expectedUnits = {
  weight: "kg",
  body_fat_percentage: "percent",
  lean_mass: "kg",
  waist: "cm",
  chest: "cm",
  hips: "cm",
  thigh: "cm",
  biceps: "cm"
} as const;

/**
 * Validates goal criteria that cannot be fully expressed by transport schema.
 *
 * @param criteria - Structured criteria supplied for a goal version.
 * @throws DomainValidationError when mode shape, units or ordering are invalid.
 */
export function validatePhysicalGoalCriteria(
  criteria: readonly PhysicalGoalCriterionInput[]
): void {
  criteria.forEach((criterion, index) => {
    if (expectedUnits[criterion.metric] !== criterion.unit) {
      throw new DomainValidationError(
        `unit ${criterion.unit} is invalid for ${criterion.metric}`
      );
    }
    const values = {
      target: criterion.targetValue,
      minimum: criterion.minimumValue,
      maximum: criterion.maximumValue
    };
    if (
      criterion.mode === "directional" &&
      (criterion.direction === null ||
        values.target !== null ||
        values.minimum !== null ||
        values.maximum !== null)
    ) {
      throw new DomainValidationError(
        `criterion ${index + 1} has invalid directional shape`
      );
    }
    if (
      criterion.mode === "exact" &&
      (criterion.direction !== null ||
        values.target === null ||
        values.minimum !== null ||
        values.maximum !== null)
    ) {
      throw new DomainValidationError(
        `criterion ${index + 1} has invalid exact shape`
      );
    }
    if (
      criterion.mode === "range" &&
      (criterion.direction !== null ||
        values.target !== null ||
        values.minimum === null ||
        values.maximum === null ||
        values.minimum > values.maximum)
    ) {
      throw new DomainValidationError(
        `criterion ${index + 1} has invalid range shape`
      );
    }
    if (
      criterion.mode === "dynamic" &&
      (values.target !== null ||
        values.minimum !== null ||
        values.maximum !== null)
    ) {
      throw new DomainValidationError(
        `criterion ${index + 1} has invalid dynamic shape`
      );
    }
  });
}

/**
 * Validates version dates and structured criteria.
 *
 * @param input - Goal creation or version creation command.
 * @throws DomainValidationError when the dates or criteria are inconsistent.
 */
export function validatePhysicalGoalVersionInput(
  input: CreatePhysicalGoal | CreatePhysicalGoalVersion
): void {
  if (
    input.effectiveFrom &&
    input.targetDate &&
    input.targetDate < input.effectiveFrom
  ) {
    throw new DomainValidationError(
      "targetDate must not precede effectiveFrom"
    );
  }
  validatePhysicalGoalCriteria(input.criteria);
}

/**
 * Serializes one persisted criterion.
 *
 * @param row - Criterion row owned by the selected version.
 * @returns Public typed criterion.
 */
export function toPhysicalGoalCriterion(
  row: PhysicalGoalCriterionRow
): PhysicalGoalCriterion {
  return {
    id: row.id,
    position: row.position,
    metric: row.metric,
    mode: row.mode,
    direction: row.direction,
    targetValue:
      row.targetValue === null ? null : Number(row.targetValue),
    minimumValue:
      row.minimumValue === null ? null : Number(row.minimumValue),
    maximumValue:
      row.maximumValue === null ? null : Number(row.maximumValue),
    unit: row.unit
  };
}

/**
 * Serializes one immutable goal version.
 *
 * @param row - Persisted goal version.
 * @param criteria - Ordered version criteria.
 * @param sourceReference - Version provenance.
 * @returns Public immutable goal version.
 */
export function toPhysicalGoalVersion(
  row: PhysicalGoalVersionRow,
  criteria: readonly PhysicalGoalCriterionRow[],
  sourceReference: SourceReferenceRow
): PhysicalGoalVersion {
  return {
    id: row.id,
    goalId: row.goalId,
    version: row.version,
    intent: row.intent,
    effectiveFrom: row.effectiveFrom,
    targetDate: row.targetDate,
    criteria: criteria
      .slice()
      .sort((left, right) => left.position - right.position)
      .map(toPhysicalGoalCriterion),
    sourceReference: toSourceReference(sourceReference),
    dedupeKey: row.dedupeKey,
    createdAt: row.createdAt.toISOString()
  };
}

/**
 * Serializes a PhysicalGoal root with its current and latest versions.
 *
 * @param row - Persisted goal root.
 * @param currentVersion - Activated version, when present.
 * @param latestVersion - Highest immutable version.
 * @returns Public goal aggregate.
 */
export function toPhysicalGoal(
  row: PhysicalGoalRow,
  currentVersion: PhysicalGoalVersion | null,
  latestVersion: PhysicalGoalVersion
): PhysicalGoal {
  return {
    id: row.id,
    personId: row.personId,
    status: row.status,
    currentVersion,
    latestVersion,
    lockVersion: row.lockVersion,
    createdAt: row.createdAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null
  };
}
