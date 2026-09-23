import {
  and,
  asc,
  desc,
  eq,
  gte,
  lte,
  ne,
  notExists,
  or,
  sql
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type {
  AcceptProgressionCandidate,
  ActivateTrainingProgramVersion,
  CorrectWorkoutSession,
  CreateExercise,
  CreateExerciseVersion,
  CreateTrainingProgram,
  CreateTrainingProgramVersion,
  CreateWorkoutSession,
  Exercise,
  ExerciseOverlay,
  PersonalRecordList,
  ProgressionCandidateList,
  MaterializeTrainingProgramCadence,
  MaterializeTrainingProgramCadenceResult,
  SaveConfirmedTrainingProgram,
  SaveConfirmedTrainingProgramResult,
  TrainingProgramCadence,
  TrainingProgram,
  TrainingProgramVersion,
  UpsertExerciseOverlay,
  WorkoutSession,
  WorkoutSessionHistory,
  WorkoutSessionList
} from "@shape-of-you/contracts";

import type { DatabaseContext } from "../database/context.js";
import {
  readTrainingBaselineDays,
  type TrainingBaselineDay
} from "../training/personal-baseline-history.js";
import type { DataCoverageEvidence } from "../domain/data-coverage.js";
import {
  performedExercises,
  performedSets,
  integrationActivityFacts,
  integrationConnections,
  sourceReferences,
  trainingExerciseCatalogSourceRecords,
  trainingExerciseCatalogSources,
  trainingExerciseOverlays,
  trainingExercises,
  trainingExerciseVersions,
  trainingProgramPrescriptions,
  trainingProgramCadences,
  trainingProgramCadenceWorkouts,
  trainingPrograms,
  trainingProgramVersions,
  trainingProgramWorkouts,
  trainingWorkoutSessionActivityLinks,
  workoutSessions,
  type SourceReferenceRow,
  type TrainingExerciseOverlayRow,
  type TrainingExerciseRow,
  type TrainingExerciseVersionRow,
  type TrainingProgramRow,
  type TrainingProgramVersionRow,
  type WorkoutSessionRow
} from "../database/schema.js";
import {
  calculateProgressionWeight,
  canAccessTrainingExercise,
  type ResolvedTrainingProgramSnapshot,
  trainingProgramSnapshotMatches,
  validateTrainingProgramVersion
} from "../domain/training.js";
import { deriveLocalDate } from "../domain/weight-measurement.js";
import {
  ConflictError,
  NotFoundError
} from "../domain/errors.js";
import { toSourceReference } from "../domain/source-reference.js";
import {
  discardUnusedSourceReference,
  ensureSourceReference,
  isPersonContextEvidence,
  lockPersonEvidenceMutation,
  type DatabaseTransaction
} from "./source-reference-repository.js";

/** Result of an idempotent workout create or correction command. */
export interface CreateWorkoutSessionResult {
  /** Whether the command inserted a new immutable fact. */
  readonly created: boolean;
  /** Inserted or previously existing session. */
  readonly session: WorkoutSession;
}

/** Source-neutral external exercise record accepted by the staging boundary. */
export interface StageExerciseSourceRecord {
  readonly sourceKey: string;
  readonly sourceName: string;
  readonly licenseName: string | null;
  readonly termsUrl: string | null;
  readonly externalRecordId: string;
  readonly fetchedAt: string;
  readonly checksum: string;
  readonly parserVersion: string;
  readonly rawSnapshot?: unknown;
}

/** Persisted identity returned by idempotent exercise-source staging. */
export interface StagedExerciseSourceRecord {
  readonly id: string;
  readonly created: boolean;
}

/** Provider-neutral typed activity command accepted by the Training boundary. */
export interface ImportExternalActivity {
  readonly connectionId: string;
  readonly personId: string;
  /** Consent generation captured with the provider request; stale generations must not write. */
  readonly consentId: string;
  readonly providerIdentity: string;
  readonly normalizedChecksum: string;
  readonly occurredAt: string;
  readonly localDate: string;
  readonly timezone: string;
  readonly name: string;
  readonly durationSeconds: number;
  readonly distanceMeters: number | null;
  readonly trainingLoad: number | null;
  readonly trainingLoadBasis: "relative_training_stress" | null;
  readonly trainingLoadBasisVersion: string | null;
  readonly averageHeartRate: number | null;
  readonly maximumHeartRate: number | null;
  readonly deviceName: string | null;
  readonly sourceProvider: string;
  readonly garminAttributed: boolean;
}

/** Current immutable external activity projection owned by Training. */
export interface ExternalActivityFact extends Omit<ImportExternalActivity, "consentId"> {
  readonly id: string;
  readonly supersedesId: string | null;
}

/** Persistence contract for Training catalog, plans, facts, and projections. */
export interface TrainingStore {
  importExternalActivity(input: ImportExternalActivity): Promise<"created" | "corrected" | "unchanged" | "stopped">;
  /** Lists newest current external-activity revisions for one Person with a SQL-applied bound. */
  listExternalActivities(personId: string, limit: number): Promise<readonly ExternalActivityFact[]>;
  /** Reads bounded owner-consolidated Training days for personal assessment. */
  listPersonalBaselineDays(personId: string, from: string, to: string): Promise<readonly TrainingBaselineDay[]>;
  createExercise(personId: string, input: CreateExercise): Promise<Exercise>;
  appendExerciseVersion(
    personId: string,
    id: string,
    input: CreateExerciseVersion
  ): Promise<Exercise>;
  findExercise(personId: string, id: string): Promise<Exercise | null>;
  upsertExerciseOverlay(
    personId: string,
    id: string,
    input: UpsertExerciseOverlay
  ): Promise<ExerciseOverlay>;
  stageExerciseSourceRecord(
    input: StageExerciseSourceRecord
  ): Promise<StagedExerciseSourceRecord>;
  createProgram(
    personId: string,
    input: CreateTrainingProgram
  ): Promise<TrainingProgram>;
  appendProgramVersion(
    personId: string,
    id: string,
    input: CreateTrainingProgramVersion
  ): Promise<TrainingProgram>;
  activateProgramVersion(
    personId: string,
    id: string,
    versionId: string,
    input: ActivateTrainingProgramVersion
  ): Promise<TrainingProgram>;
  saveConfirmedProgram(
    personId: string,
    input: SaveConfirmedTrainingProgram
  ): Promise<SaveConfirmedTrainingProgramResult>;
  materializeProgramCadence(
    personId: string,
    input: MaterializeTrainingProgramCadence
  ): Promise<MaterializeTrainingProgramCadenceResult>;
  findProgram(personId: string, id: string): Promise<TrainingProgram | null>;
  findActiveProgram(personId: string): Promise<TrainingProgram | null>;
  createWorkoutSession(
    personId: string,
    input: CreateWorkoutSession
  ): Promise<CreateWorkoutSessionResult>;
  correctWorkoutSession(
    personId: string,
    id: string,
    input: CorrectWorkoutSession
  ): Promise<CreateWorkoutSessionResult>;
  findWorkoutSession(
    personId: string,
    id: string
  ): Promise<WorkoutSession | null>;
  listWorkoutSessions(
    personId: string,
    limit: number,
    localDate?: string
  ): Promise<WorkoutSessionList>;
  /** Reads every current workout session for one exact Person-local date. */
  listWorkoutSessionsForLocalDate(personId: string, localDate: string): Promise<readonly WorkoutSession[]>;
  listWorkoutSessionsForLocalDateRange(personId: string, from: string, to: string): Promise<readonly WorkoutSession[]>;
  /** Reads current WorkoutSession and external-activity coverage as one date union. */
  getDataCoverage(personId: string, from: string, to: string, asOf: string): Promise<DataCoverageEvidence>;
  workoutSessionHistory(
    personId: string,
    id: string
  ): Promise<WorkoutSessionHistory | null>;
  personalRecords(personId: string): Promise<PersonalRecordList>;
  progressionCandidates(personId: string): Promise<ProgressionCandidateList>;
  acceptProgressionCandidate(
    personId: string,
    programId: string,
    input: AcceptProgressionCandidate
  ): Promise<TrainingProgram>;
}

type ProgramVersionInput =
  | CreateTrainingProgram
  | CreateTrainingProgramVersion
  | ResolvedTrainingProgramSnapshot;

type ConfirmedPrescription =
  SaveConfirmedTrainingProgram["workouts"][number]["prescriptions"][number];
type ConfirmedExerciseDescriptor = Extract<
  ConfirmedPrescription,
  { readonly exercise: unknown }
>["exercise"];
type ResolvedExercise = {
  readonly exercise: TrainingExerciseRow;
  readonly version: TrainingExerciseVersionRow;
};

function normalizeExerciseText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function descriptorKey(descriptor: ConfirmedExerciseDescriptor): string {
  return JSON.stringify([
    normalizeExerciseText(descriptor.name),
    ...[
      descriptor.category,
      descriptor.movementPattern,
      descriptor.equipment,
      descriptor.instructions,
      descriptor.note
    ].map((value) => value === null ? null : normalizeExerciseText(value))
  ]);
}

function trainingProgramCadenceMatches(
  left: TrainingProgramCadence | null,
  right: TrainingProgramCadence
): boolean {
  if (
    left === null ||
    left.kind !== right.kind ||
    left.strengthSessionsPerWeek !== right.strengthSessionsPerWeek ||
    left.workoutSequence.length !== right.workoutSequence.length ||
    left.workoutSequence.some((position, index) =>
      position !== right.workoutSequence[index]
    )
  ) {
    return false;
  }
  if (left.lightCardio === null || right.lightCardio === null) {
    return left.lightCardio === right.lightCardio;
  }
  return (
    left.lightCardio.sessionsPerWeek === right.lightCardio.sessionsPerWeek &&
    left.lightCardio.durationSeconds === right.lightCardio.durationSeconds &&
    left.lightCardio.targetAverageHeartRateMin ===
      right.lightCardio.targetAverageHeartRateMin &&
    left.lightCardio.targetAverageHeartRateMax ===
      right.lightCardio.targetAverageHeartRateMax &&
    left.lightCardio.warmupSeconds === right.lightCardio.warmupSeconds &&
    left.lightCardio.workSeconds === right.lightCardio.workSeconds &&
    left.lightCardio.cooldownSeconds === right.lightCardio.cooldownSeconds
  );
}

function descriptorMatches(
  descriptor: ConfirmedExerciseDescriptor,
  version: TrainingExerciseVersionRow,
  alias: string | null
): boolean {
  const requestedName = normalizeExerciseText(descriptor.name);
  if (
    normalizeExerciseText(version.name) !== requestedName &&
    (alias === null || normalizeExerciseText(alias) !== requestedName)
  ) {
    return false;
  }
  return ([
    [descriptor.category, version.category],
    [descriptor.movementPattern, version.movementPattern],
    [descriptor.equipment, version.equipment],
    [descriptor.instructions, version.instructions],
    [descriptor.note, version.note]
  ] as const).every(
    ([requested, actual]) =>
      requested === null ||
      (actual !== null &&
        normalizeExerciseText(requested) === normalizeExerciseText(actual))
  );
}

const replacementSession = alias(workoutSessions, "replacement_session");

function catalogOwner(
  personId: string,
  visibility: "shared" | "private"
): string | null {
  return visibility === "private" ? personId : null;
}

function numberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function serializeExercise(
  exercise: TrainingExerciseRow,
  version: TrainingExerciseVersionRow
): Exercise {
  return {
    id: exercise.id,
    visibility: exercise.visibility,
    ownerPersonId: exercise.ownerPersonId,
    lockVersion: exercise.lockVersion,
    createdAt: exercise.createdAt.toISOString(),
    currentVersion: {
      id: version.id,
      version: version.version,
      name: version.name,
      category: version.category,
      movementPattern: version.movementPattern,
      equipment: version.equipment,
      instructions: version.instructions,
      note: version.note,
      createdAt: version.createdAt.toISOString()
    }
  };
}

function serializeOverlay(row: TrainingExerciseOverlayRow): ExerciseOverlay {
  return {
    personId: row.personId,
    exerciseId: row.exerciseId,
    alias: row.alias,
    available: row.available,
    note: row.note,
    updatedAt: row.updatedAt.toISOString()
  };
}

async function lockPerson(
  transaction: DatabaseTransaction,
  personId: string
): Promise<void> {
  await lockPersonEvidenceMutation(transaction, personId);
}

/** PostgreSQL implementation of the Training persistence boundary. */
export class TrainingRepository implements TrainingStore {
  public constructor(private readonly database: DatabaseContext) {}

  public listPersonalBaselineDays(
    personId: string,
    from: string,
    to: string
  ): Promise<readonly TrainingBaselineDay[]> {
    return readTrainingBaselineDays(this.database.pool, personId, from, to);
  }

  public importExternalActivity(input: ImportExternalActivity): Promise<"created" | "corrected" | "unchanged" | "stopped"> {
    return this.database.db.transaction(async (transaction) => {
      await lockPerson(transaction, input.personId);
      const enabled = await transaction.query.integrationConnections.findFirst({
        columns: { id: true },
        where: and(
          eq(integrationConnections.id, input.connectionId),
          eq(integrationConnections.personId, input.personId),
          eq(integrationConnections.consentId, input.consentId),
          eq(integrationConnections.importEnabled, true)
        )
      });
      if (!enabled) return "stopped";
      const currentRows = await transaction.execute(sql<{ id: string; normalized_checksum: string }>`select id, normalized_checksum from integration_activity_facts current where current.connection_id = ${input.connectionId} and current.provider_identity = ${input.providerIdentity} and not exists (select 1 from integration_activity_facts successor where successor.supersedes_id = current.id) limit 1`);
      const current = currentRows.rows[0] as { readonly id: string; readonly normalized_checksum: string } | undefined;
      if (current?.normalized_checksum === input.normalizedChecksum) return "unchanged";
      await transaction.insert(integrationActivityFacts).values({
        connectionId: input.connectionId, personId: input.personId, providerIdentity: input.providerIdentity,
        normalizedChecksum: input.normalizedChecksum, occurredAt: new Date(input.occurredAt), localDate: input.localDate,
        timezone: input.timezone, name: input.name, durationSeconds: input.durationSeconds,
        distanceMeters: input.distanceMeters?.toFixed(3), trainingLoad: input.trainingLoad?.toFixed(3),
        trainingLoadBasis: input.trainingLoadBasis,
        trainingLoadBasisVersion: input.trainingLoadBasisVersion,
        averageHeartRate: input.averageHeartRate?.toFixed(3), maximumHeartRate: input.maximumHeartRate?.toFixed(3),
        deviceName: input.deviceName, sourceProvider: input.sourceProvider, garminAttributed: input.garminAttributed,
        supersedesId: current?.id ?? null, correctionReason: current ? "provider_record_changed" : null
      });
      return current ? "corrected" : "created";
    });
  }

  public async listExternalActivities(personId: string, limit: number): Promise<readonly ExternalActivityFact[]> {
    const successor = alias(integrationActivityFacts, "external_activity_successor");
    const rows = await this.database.db.select().from(integrationActivityFacts).where(and(
      eq(integrationActivityFacts.personId, personId),
      notExists(this.database.db.select({ id: successor.id }).from(successor).where(eq(successor.supersedesId, integrationActivityFacts.id)))
    )).orderBy(
      desc(integrationActivityFacts.occurredAt),
      desc(integrationActivityFacts.createdAt),
      desc(integrationActivityFacts.id)
    ).limit(limit);
    return rows.map((row) => ({
      id: row.id, connectionId: row.connectionId, personId: row.personId,
      providerIdentity: row.providerIdentity, normalizedChecksum: row.normalizedChecksum,
      occurredAt: row.occurredAt.toISOString(), localDate: row.localDate, timezone: row.timezone,
      name: row.name, durationSeconds: row.durationSeconds, distanceMeters: numberOrNull(row.distanceMeters),
      trainingLoad: numberOrNull(row.trainingLoad), averageHeartRate: numberOrNull(row.averageHeartRate),
      trainingLoadBasis: row.trainingLoadBasis as "relative_training_stress" | null,
      trainingLoadBasisVersion: row.trainingLoadBasisVersion,
      maximumHeartRate: numberOrNull(row.maximumHeartRate), deviceName: row.deviceName,
      sourceProvider: row.sourceProvider, garminAttributed: row.garminAttributed, supersedesId: row.supersedesId
    }));
  }

  private accessible(
    row: Pick<TrainingExerciseRow, "visibility" | "ownerPersonId">,
    personId: string
  ): boolean {
    return canAccessTrainingExercise(
      row.visibility,
      row.ownerPersonId,
      personId
    );
  }

  private async readExercise(
    transaction: DatabaseTransaction,
    personId: string,
    id: string
  ): Promise<Exercise | null> {
    const rows = await transaction
      .select({ exercise: trainingExercises, version: trainingExerciseVersions })
      .from(trainingExercises)
      .innerJoin(
        trainingExerciseVersions,
        eq(trainingExercises.currentVersionId, trainingExerciseVersions.id)
      )
      .where(eq(trainingExercises.id, id))
      .limit(1);
    const row = rows[0];
    return row && this.accessible(row.exercise, personId)
      ? serializeExercise(row.exercise, row.version)
      : null;
  }

  private async resolveExerciseVersion(
    transaction: DatabaseTransaction,
    personId: string,
    versionId: string
  ): Promise<{
    exercise: TrainingExerciseRow;
    version: TrainingExerciseVersionRow;
  } | null> {
    const rows = await transaction
      .select({ exercise: trainingExercises, version: trainingExerciseVersions })
      .from(trainingExerciseVersions)
      .innerJoin(
        trainingExercises,
        eq(trainingExerciseVersions.exerciseId, trainingExercises.id)
      )
      .where(eq(trainingExerciseVersions.id, versionId))
      .limit(1);
    const row = rows[0];
    return row && this.accessible(row.exercise, personId) ? row : null;
  }

  public async createExercise(
    personId: string,
    input: CreateExercise
  ): Promise<Exercise> {
    return this.database.db.transaction(async (transaction) => {
      const { exercise, version } = await this.insertExercise(
        transaction,
        personId,
        input
      );
      return serializeExercise(exercise, version);
    });
  }

  public async appendExerciseVersion(
    personId: string,
    id: string,
    input: CreateExerciseVersion
  ): Promise<Exercise> {
    return this.database.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select id from training_exercises where id = ${id} for update`
      );
      const current = await this.readExercise(transaction, personId, id);
      if (!current) {
        throw new NotFoundError("Training Exercise was not found");
      }
      if (current.lockVersion !== input.expectedLockVersion) {
        throw new ConflictError("Training Exercise changed concurrently");
      }
      const [version] = await transaction
        .insert(trainingExerciseVersions)
        .values({
          exerciseId: id,
          version: current.currentVersion.version + 1,
          name: input.name,
          category: input.category,
          movementPattern: input.movementPattern,
          equipment: input.equipment,
          instructions: input.instructions,
          note: input.note
        })
        .returning();
      if (!version) {
        throw new Error("ExerciseVersion insert failed");
      }
      const [updated] = await transaction
        .update(trainingExercises)
        .set({
          currentVersionId: version.id,
          lockVersion: current.lockVersion + 1
        })
        .where(
          and(
            eq(trainingExercises.id, id),
            eq(trainingExercises.lockVersion, current.lockVersion)
          )
        )
        .returning();
      if (!updated) {
        throw new ConflictError("Training Exercise changed concurrently");
      }
      return serializeExercise(updated, version);
    });
  }

  public findExercise(personId: string, id: string): Promise<Exercise | null> {
    return this.database.db.transaction((transaction) =>
      this.readExercise(transaction, personId, id)
    );
  }

  public async upsertExerciseOverlay(
    personId: string,
    id: string,
    input: UpsertExerciseOverlay
  ): Promise<ExerciseOverlay> {
    return this.database.db.transaction(async (transaction) => {
      const exercise = await this.readExercise(transaction, personId, id);
      if (!exercise) {
        throw new NotFoundError("Training Exercise was not found");
      }
      const [row] = await transaction
        .insert(trainingExerciseOverlays)
        .values({ personId, exerciseId: id, ...input })
        .onConflictDoUpdate({
          target: [
            trainingExerciseOverlays.personId,
            trainingExerciseOverlays.exerciseId
          ],
          set: { ...input, updatedAt: new Date() }
        })
        .returning();
      if (!row) {
        throw new Error("Exercise overlay upsert failed");
      }
      return serializeOverlay(row);
    });
  }

  public async stageExerciseSourceRecord(
    input: StageExerciseSourceRecord
  ): Promise<StagedExerciseSourceRecord> {
    return this.database.db.transaction(async (transaction) => {
      const [insertedSource] = await transaction
        .insert(trainingExerciseCatalogSources)
        .values({
          key: input.sourceKey,
          name: input.sourceName,
          licenseName: input.licenseName,
          termsUrl: input.termsUrl
        })
        .onConflictDoNothing()
        .returning();
      const source =
        insertedSource ??
        (
          await transaction
            .select()
            .from(trainingExerciseCatalogSources)
            .where(eq(trainingExerciseCatalogSources.key, input.sourceKey))
            .limit(1)
        )[0];
      if (!source) {
        throw new Error("Exercise catalog source resolution failed");
      }
      const [record] = await transaction
        .insert(trainingExerciseCatalogSourceRecords)
        .values({
          sourceId: source.id,
          externalRecordId: input.externalRecordId,
          fetchedAt: new Date(input.fetchedAt),
          checksum: input.checksum,
          parserVersion: input.parserVersion,
          rawSnapshot: input.rawSnapshot
        })
        .onConflictDoNothing()
        .returning();
      if (record) {
        return { id: record.id, created: true };
      }
      const [existing] = await transaction
        .select()
        .from(trainingExerciseCatalogSourceRecords)
        .where(
          and(
            eq(trainingExerciseCatalogSourceRecords.sourceId, source.id),
            eq(
              trainingExerciseCatalogSourceRecords.externalRecordId,
              input.externalRecordId
            )
          )
        )
        .limit(1);
      if (!existing) {
        throw new Error("Exercise source-record conflict did not resolve");
      }
      return { id: existing.id, created: false };
    });
  }

  private async insertExercise(
    transaction: DatabaseTransaction,
    personId: string,
    input: CreateExercise
  ): Promise<ResolvedExercise> {
    const [exercise] = await transaction
      .insert(trainingExercises)
      .values({
        visibility: input.visibility,
        ownerPersonId: catalogOwner(personId, input.visibility)
      })
      .returning();
    if (!exercise) {
      throw new Error("Exercise insert failed");
    }
    const [version] = await transaction
      .insert(trainingExerciseVersions)
      .values({
        exerciseId: exercise.id,
        version: 1,
        name: input.name,
        category: input.category,
        movementPattern: input.movementPattern,
        equipment: input.equipment,
        instructions: input.instructions,
        note: input.note
      })
      .returning();
    if (!version) {
      throw new Error("ExerciseVersion insert failed");
    }
    await transaction
      .update(trainingExercises)
      .set({ currentVersionId: version.id })
      .where(eq(trainingExercises.id, exercise.id));
    return { exercise, version };
  }

  private async resolveConfirmedProgram(
    transaction: DatabaseTransaction,
    personId: string,
    input: SaveConfirmedTrainingProgram
  ): Promise<
    | { readonly status: "resolved"; readonly snapshot: ResolvedTrainingProgramSnapshot }
    | {
        readonly status: "needs_clarification";
        readonly ambiguities: Extract<
          SaveConfirmedTrainingProgramResult,
          { readonly outcome: "needs_clarification" }
        >["ambiguities"];
      }
  > {
    const catalog = await transaction
      .select({
        exercise: trainingExercises,
        version: trainingExerciseVersions,
        overlay: trainingExerciseOverlays
      })
      .from(trainingExercises)
      .innerJoin(
        trainingExerciseVersions,
        eq(trainingExercises.currentVersionId, trainingExerciseVersions.id)
      )
      .leftJoin(
        trainingExerciseOverlays,
        and(
          eq(trainingExerciseOverlays.exerciseId, trainingExercises.id),
          eq(trainingExerciseOverlays.personId, personId)
        )
      )
      .where(
        or(
          eq(trainingExercises.visibility, "shared"),
          eq(trainingExercises.ownerPersonId, personId)
        )
      );
    const availableCatalog = catalog.filter(
      ({ overlay }) => overlay === null || overlay.available
    );
    const resolvedDescriptors = new Map<string, ResolvedExercise>();
    const missingDescriptors = new Map<string, ConfirmedExerciseDescriptor>();
    const ambiguities = new Map<
      string,
      Extract<
        SaveConfirmedTrainingProgramResult,
        { readonly outcome: "needs_clarification" }
      >["ambiguities"][number]
    >();

    for (const workout of input.workouts) {
      for (const prescription of workout.prescriptions) {
        if (!("exercise" in prescription)) {
          continue;
        }
        const key = descriptorKey(prescription.exercise);
        if (
          resolvedDescriptors.has(key) ||
          missingDescriptors.has(key) ||
          ambiguities.has(key)
        ) {
          continue;
        }
        const candidates = availableCatalog.filter(({ version, overlay }) =>
          descriptorMatches(prescription.exercise, version, overlay?.alias ?? null)
        );
        if (candidates.length === 1) {
          const candidate = candidates[0];
          if (!candidate) {
            throw new Error("Resolved ExerciseVersion was lost");
          }
          resolvedDescriptors.set(key, {
            exercise: candidate.exercise,
            version: candidate.version
          });
        } else if (candidates.length > 1) {
          ambiguities.set(key, {
            requestedName: prescription.exercise.name,
            candidates: candidates.map(({ exercise, version }) => ({
              exerciseId: exercise.id,
              exerciseVersionId: version.id,
              name: version.name,
              category: version.category,
              movementPattern: version.movementPattern,
              equipment: version.equipment
            }))
          });
        } else {
          missingDescriptors.set(key, prescription.exercise);
        }
      }
    }

    const resolvedIds = new Map<string, ResolvedExercise>();
    for (const workout of input.workouts) {
      for (const prescription of workout.prescriptions) {
        if ("exerciseVersionId" in prescription) {
          if (!resolvedIds.has(prescription.exerciseVersionId)) {
            const resolved = await this.resolveExerciseVersion(
              transaction,
              personId,
              prescription.exerciseVersionId
            );
            if (!resolved) {
              throw new NotFoundError("Training ExerciseVersion was not found");
            }
            resolvedIds.set(prescription.exerciseVersionId, resolved);
          }
        }
      }
    }
    if (ambiguities.size > 0) {
      return {
        status: "needs_clarification",
        ambiguities: [...ambiguities.values()]
      };
    }
    for (const [key, descriptor] of missingDescriptors) {
      resolvedDescriptors.set(
        key,
        await this.insertExercise(transaction, personId, {
          visibility: "private",
          ...descriptor
        })
      );
    }

    return {
      status: "resolved",
      snapshot: {
        name: input.name,
        note: input.note,
        cadence: input.cadence ?? null,
        workouts: input.workouts.map((workout) => ({
          name: workout.name,
          prescriptions: workout.prescriptions.map((prescription) => {
            const resolved = "exerciseVersionId" in prescription
              ? resolvedIds.get(prescription.exerciseVersionId)
              : resolvedDescriptors.get(descriptorKey(prescription.exercise));
            if (!resolved) {
              throw new Error("Resolved ExerciseVersion was lost");
            }
            return {
              exerciseVersionId: resolved.version.id,
              loadBasis: prescription.loadBasis,
              targetWeightKg: prescription.targetWeightKg,
              targetSets: prescription.targetSets,
              targetRepsMin: prescription.targetRepsMin,
              targetRepsMax: prescription.targetRepsMax,
              targetRir: prescription.targetRir,
              progressionIncrementKg: prescription.progressionIncrementKg,
              note: prescription.note
            };
          })
        }))
      }
    };
  }

  private async insertProgramVersionContents(
    transaction: DatabaseTransaction,
    personId: string,
    programId: string,
    versionNumber: number,
    input: ProgramVersionInput
  ): Promise<TrainingProgramVersionRow> {
    validateTrainingProgramVersion(input);
    const resolved = new Map<
      string,
      { exercise: TrainingExerciseRow; version: TrainingExerciseVersionRow }
    >();
    for (const workout of input.workouts) {
      for (const prescription of workout.prescriptions) {
        if (!resolved.has(prescription.exerciseVersionId)) {
          const exercise = await this.resolveExerciseVersion(
            transaction,
            personId,
            prescription.exerciseVersionId
          );
          if (!exercise) {
            throw new NotFoundError("Training ExerciseVersion was not found");
          }
          resolved.set(prescription.exerciseVersionId, exercise);
        }
      }
    }

    const [version] = await transaction
      .insert(trainingProgramVersions)
      .values({
        programId,
        personId,
        version: versionNumber,
        name: input.name,
        note: input.note
      })
      .returning();
    if (!version) {
      throw new Error("TrainingProgramVersion insert failed");
    }

    for (const [workoutIndex, workout] of input.workouts.entries()) {
      const [workoutRow] = await transaction
        .insert(trainingProgramWorkouts)
        .values({
          programVersionId: version.id,
          position: workoutIndex + 1,
          name: workout.name
        })
        .returning();
      if (!workoutRow) {
        throw new Error("TrainingProgram workout insert failed");
      }
      await transaction.insert(trainingProgramPrescriptions).values(
        workout.prescriptions.map((prescription, index) => {
          const exercise = resolved.get(prescription.exerciseVersionId);
          if (!exercise) {
            throw new Error("Resolved ExerciseVersion was lost");
          }
          return {
            workoutId: workoutRow.id,
            position: index + 1,
            exerciseId: exercise.exercise.id,
            exerciseVersionId: prescription.exerciseVersionId,
            loadBasis: prescription.loadBasis,
            targetWeightKg:
              prescription.targetWeightKg === null
                ? null
                : prescription.targetWeightKg.toFixed(3),
            targetSets: prescription.targetSets,
            targetRepsMin: prescription.targetRepsMin,
            targetRepsMax: prescription.targetRepsMax,
            targetRir:
              prescription.targetRir === null
                ? null
                : prescription.targetRir.toFixed(1),
            progressionIncrementKg:
              prescription.progressionIncrementKg === null
                ? null
                : prescription.progressionIncrementKg.toFixed(3),
            note: prescription.note
          };
        })
      );
    }
    const cadence = input.cadence ?? null;
    if (cadence !== null) {
      const cardio = cadence.lightCardio;
      await transaction.insert(trainingProgramCadences).values({
        programVersionId: version.id,
        kind: cadence.kind,
        strengthSessionsPerWeek: cadence.strengthSessionsPerWeek,
        cardioSessionsPerWeek: cardio?.sessionsPerWeek ?? null,
        cardioDurationSeconds: cardio?.durationSeconds ?? null,
        cardioHeartRateMin: cardio?.targetAverageHeartRateMin ?? null,
        cardioHeartRateMax: cardio?.targetAverageHeartRateMax ?? null,
        cardioWarmupSeconds: cardio?.warmupSeconds ?? null,
        cardioWorkSeconds: cardio?.workSeconds ?? null,
        cardioCooldownSeconds: cardio?.cooldownSeconds ?? null
      });
      await transaction.insert(trainingProgramCadenceWorkouts).values(
        cadence.workoutSequence.map((workoutPosition, index) => ({
          programVersionId: version.id,
          sequencePosition: index + 1,
          workoutPosition
        }))
      );
    }
    return version;
  }

  private async readProgramVersion(
    transaction: DatabaseTransaction,
    personId: string,
    versionId: string
  ): Promise<TrainingProgramVersion | null> {
    const [version] = await transaction
      .select()
      .from(trainingProgramVersions)
      .where(
        and(
          eq(trainingProgramVersions.id, versionId),
          eq(trainingProgramVersions.personId, personId)
        )
      )
      .limit(1);
    if (!version) {
      return null;
    }
    const [cadenceRow] = await transaction
      .select()
      .from(trainingProgramCadences)
      .where(eq(trainingProgramCadences.programVersionId, version.id))
      .limit(1);
    const cadenceSequence = cadenceRow
      ? await transaction
          .select()
          .from(trainingProgramCadenceWorkouts)
          .where(eq(trainingProgramCadenceWorkouts.programVersionId, version.id))
          .orderBy(asc(trainingProgramCadenceWorkouts.sequencePosition))
      : [];
    const workouts = await transaction
      .select()
      .from(trainingProgramWorkouts)
      .where(eq(trainingProgramWorkouts.programVersionId, version.id))
      .orderBy(asc(trainingProgramWorkouts.position));
    const publicWorkouts = [];
    for (const workout of workouts) {
      const rows = await transaction
        .select({
          prescription: trainingProgramPrescriptions,
          exerciseVersion: trainingExerciseVersions
        })
        .from(trainingProgramPrescriptions)
        .innerJoin(
          trainingExerciseVersions,
          eq(
            trainingProgramPrescriptions.exerciseVersionId,
            trainingExerciseVersions.id
          )
        )
        .where(eq(trainingProgramPrescriptions.workoutId, workout.id))
        .orderBy(asc(trainingProgramPrescriptions.position));
      publicWorkouts.push({
        position: workout.position,
        name: workout.name,
        prescriptions: rows.map(({ prescription, exerciseVersion }) => ({
          position: prescription.position,
          exerciseId: prescription.exerciseId,
          exerciseVersionId: prescription.exerciseVersionId,
          exerciseLabel: exerciseVersion.name,
          loadBasis: prescription.loadBasis,
          targetWeightKg: numberOrNull(prescription.targetWeightKg),
          targetSets: prescription.targetSets,
          targetRepsMin: prescription.targetRepsMin,
          targetRepsMax: prescription.targetRepsMax,
          targetRir: numberOrNull(prescription.targetRir),
          progressionIncrementKg: numberOrNull(
            prescription.progressionIncrementKg
          ),
          note: prescription.note
        }))
      });
    }
    return {
      id: version.id,
      version: version.version,
      name: version.name,
      note: version.note,
      cadence: cadenceRow
        ? {
            kind: "rolling_weekly",
            strengthSessionsPerWeek: cadenceRow.strengthSessionsPerWeek,
            workoutSequence: cadenceSequence.map((entry) => entry.workoutPosition),
            lightCardio: cadenceRow.cardioSessionsPerWeek === null
              ? null
              : {
                  sessionsPerWeek: cadenceRow.cardioSessionsPerWeek,
                  durationSeconds: cadenceRow.cardioDurationSeconds!,
                  targetAverageHeartRateMin: cadenceRow.cardioHeartRateMin!,
                  targetAverageHeartRateMax: cadenceRow.cardioHeartRateMax!,
                  warmupSeconds: cadenceRow.cardioWarmupSeconds!,
                  workSeconds: cadenceRow.cardioWorkSeconds!,
                  cooldownSeconds: cadenceRow.cardioCooldownSeconds!
                }
          }
        : null,
      workouts: publicWorkouts,
      createdAt: version.createdAt.toISOString()
    };
  }

  private async serializeProgram(
    transaction: DatabaseTransaction,
    program: TrainingProgramRow
  ): Promise<TrainingProgram> {
    if (!program.currentVersionId) {
      throw new Error("TrainingProgram has no current version");
    }
    const currentVersion = await this.readProgramVersion(
      transaction,
      program.personId,
      program.currentVersionId
    );
    if (!currentVersion) {
      throw new Error("TrainingProgram current version was not found");
    }
    const activeVersion = program.activeVersionId
      ? await this.readProgramVersion(
          transaction,
          program.personId,
          program.activeVersionId
        )
      : null;
    if (program.activeVersionId && !activeVersion) {
      throw new Error("TrainingProgram active version was not found");
    }
    return {
      id: program.id,
      personId: program.personId,
      lockVersion: program.lockVersion,
      activeVersionId: program.activeVersionId,
      activeVersion,
      createdAt: program.createdAt.toISOString(),
      currentVersion
    };
  }

  private async readProgram(
    transaction: DatabaseTransaction,
    personId: string,
    id: string
  ): Promise<TrainingProgram | null> {
    const [program] = await transaction
      .select()
      .from(trainingPrograms)
      .where(
        and(
          eq(trainingPrograms.id, id),
          eq(trainingPrograms.personId, personId)
        )
      )
      .limit(1);
    return program ? this.serializeProgram(transaction, program) : null;
  }

  public async createProgram(
    personId: string,
    input: CreateTrainingProgram
  ): Promise<TrainingProgram> {
    return this.database.db.transaction(async (transaction) => {
      await lockPerson(transaction, personId);
      const [program] = await transaction
        .insert(trainingPrograms)
        .values({ personId })
        .returning();
      if (!program) {
        throw new Error("TrainingProgram insert failed");
      }
      const version = await this.insertProgramVersionContents(
        transaction,
        personId,
        program.id,
        1,
        input
      );
      const [updated] = await transaction
        .update(trainingPrograms)
        .set({ currentVersionId: version.id })
        .where(eq(trainingPrograms.id, program.id))
        .returning();
      if (!updated) {
        throw new Error("TrainingProgram current version update failed");
      }
      return this.serializeProgram(transaction, updated);
    });
  }

  public async appendProgramVersion(
    personId: string,
    id: string,
    input: CreateTrainingProgramVersion
  ): Promise<TrainingProgram> {
    return this.database.db.transaction(async (transaction) => {
      await lockPerson(transaction, personId);
      const current = await this.readProgram(transaction, personId, id);
      if (!current) {
        throw new NotFoundError("TrainingProgram was not found");
      }
      if (current.lockVersion !== input.expectedLockVersion) {
        throw new ConflictError("TrainingProgram changed concurrently");
      }
      const version = await this.insertProgramVersionContents(
        transaction,
        personId,
        id,
        current.currentVersion.version + 1,
        input
      );
      const [updated] = await transaction
        .update(trainingPrograms)
        .set({
          currentVersionId: version.id,
          lockVersion: current.lockVersion + 1
        })
        .where(
          and(
            eq(trainingPrograms.id, id),
            eq(trainingPrograms.personId, personId),
            eq(trainingPrograms.lockVersion, current.lockVersion)
          )
        )
        .returning();
      if (!updated) {
        throw new ConflictError("TrainingProgram changed concurrently");
      }
      return this.serializeProgram(transaction, updated);
    });
  }

  public async activateProgramVersion(
    personId: string,
    id: string,
    versionId: string,
    input: ActivateTrainingProgramVersion
  ): Promise<TrainingProgram> {
    return this.database.db.transaction(async (transaction) => {
      await lockPerson(transaction, personId);
      const current = await this.readProgram(transaction, personId, id);
      if (!current) {
        throw new NotFoundError("TrainingProgram was not found");
      }
      if (current.lockVersion !== input.expectedLockVersion) {
        throw new ConflictError("TrainingProgram changed concurrently");
      }
      const version = await this.readProgramVersion(
        transaction,
        personId,
        versionId
      );
      if (!version) {
        throw new NotFoundError("TrainingProgramVersion was not found");
      }
      const [belongs] = await transaction
        .select({ id: trainingProgramVersions.id })
        .from(trainingProgramVersions)
        .where(
          and(
            eq(trainingProgramVersions.id, versionId),
            eq(trainingProgramVersions.programId, id),
            eq(trainingProgramVersions.personId, personId)
          )
        )
        .limit(1);
      if (!belongs) {
        throw new NotFoundError("TrainingProgramVersion was not found");
      }
      await transaction
        .update(trainingPrograms)
        .set({
          activeVersionId: null,
          lockVersion: sql`${trainingPrograms.lockVersion} + 1`
        })
        .where(
          and(
            eq(trainingPrograms.personId, personId),
            sql`${trainingPrograms.id} <> ${id}`,
            sql`${trainingPrograms.activeVersionId} IS NOT NULL`
          )
        );
      const [updated] = await transaction
        .update(trainingPrograms)
        .set({
          activeVersionId: versionId,
          lockVersion: current.lockVersion + 1
        })
        .where(
          and(
            eq(trainingPrograms.id, id),
            eq(trainingPrograms.personId, personId),
            eq(trainingPrograms.lockVersion, current.lockVersion)
          )
        )
        .returning();
      if (!updated) {
        throw new ConflictError("TrainingProgram changed concurrently");
      }
      return this.serializeProgram(transaction, updated);
    });
  }

  public async saveConfirmedProgram(
    personId: string,
    input: SaveConfirmedTrainingProgram
  ): Promise<SaveConfirmedTrainingProgramResult> {
    return this.database.db.transaction(async (transaction) => {
      await lockPerson(transaction, personId);
      validateTrainingProgramVersion(input);
      const [activeRow] = await transaction
        .select()
        .from(trainingPrograms)
        .where(
          and(
            eq(trainingPrograms.personId, personId),
            sql`${trainingPrograms.activeVersionId} IS NOT NULL`
          )
        )
        .limit(1);
      const active = activeRow
        ? await this.serializeProgram(transaction, activeRow)
        : null;
      const resolution = await this.resolveConfirmedProgram(
        transaction,
        personId,
        input
      );
      if (resolution.status === "needs_clarification") {
        return {
          outcome: "needs_clarification",
          program: null,
          ambiguities: resolution.ambiguities
        };
      }
      const snapshot = resolution.snapshot;

      if (
        active?.activeVersion &&
        trainingProgramSnapshotMatches(active.activeVersion, snapshot)
      ) {
        return { outcome: "unchanged", program: active };
      }

      if (!active) {
        if (
          input.expectedActiveProgramId !== null ||
          input.expectedLockVersion !== null
        ) {
          throw new ConflictError("Active TrainingProgram changed concurrently");
        }
        const [created] = await transaction
          .insert(trainingPrograms)
          .values({ personId })
          .returning();
        if (!created) {
          throw new Error("TrainingProgram insert failed");
        }
        const version = await this.insertProgramVersionContents(
          transaction,
          personId,
          created.id,
          1,
          snapshot
        );
        const [activated] = await transaction
          .update(trainingPrograms)
          .set({
            currentVersionId: version.id,
            activeVersionId: version.id,
            lockVersion: 1
          })
          .where(
            and(
              eq(trainingPrograms.id, created.id),
              eq(trainingPrograms.personId, personId),
              eq(trainingPrograms.lockVersion, 0)
            )
          )
          .returning();
        if (!activated) {
          throw new ConflictError("TrainingProgram changed concurrently");
        }
        return {
          outcome: "created",
          program: await this.serializeProgram(transaction, activated)
        };
      }

      if (
        input.expectedActiveProgramId !== active.id ||
        input.expectedLockVersion !== active.lockVersion
      ) {
        throw new ConflictError("Active TrainingProgram changed concurrently");
      }
      const version = await this.insertProgramVersionContents(
        transaction,
        personId,
        active.id,
        active.currentVersion.version + 1,
        snapshot
      );
      const [updated] = await transaction
        .update(trainingPrograms)
        .set({
          currentVersionId: version.id,
          activeVersionId: version.id,
          lockVersion: active.lockVersion + 1
        })
        .where(
          and(
            eq(trainingPrograms.id, active.id),
            eq(trainingPrograms.personId, personId),
            eq(trainingPrograms.lockVersion, active.lockVersion)
          )
        )
        .returning();
      if (!updated) {
        throw new ConflictError("TrainingProgram changed concurrently");
      }
      return {
        outcome: "updated",
        program: await this.serializeProgram(transaction, updated)
      };
    });
  }

  public async materializeProgramCadence(
    personId: string,
    input: MaterializeTrainingProgramCadence
  ): Promise<MaterializeTrainingProgramCadenceResult> {
    return this.database.db.transaction(async (transaction) => {
      await lockPerson(transaction, personId);
      const [activeRow] = await transaction
        .select()
        .from(trainingPrograms)
        .where(
          and(
            eq(trainingPrograms.personId, personId),
            sql`${trainingPrograms.activeVersionId} IS NOT NULL`
          )
        )
        .limit(1);
      const active = activeRow
        ? await this.serializeProgram(transaction, activeRow)
        : null;
      if (
        !active?.activeVersion ||
        active.id !== input.expectedActiveProgramId ||
        active.activeVersionId !== input.expectedActiveVersionId ||
        active.lockVersion !== input.expectedLockVersion
      ) {
        throw new ConflictError("Active TrainingProgram changed concurrently");
      }

      const snapshot: CreateTrainingProgramVersion = {
        expectedLockVersion: active.lockVersion,
        name: active.activeVersion.name,
        note: active.activeVersion.note,
        cadence: input.cadence,
        workouts: active.activeVersion.workouts.map((workout) => ({
          name: workout.name,
          prescriptions: workout.prescriptions.map((prescription) => ({
            exerciseVersionId: prescription.exerciseVersionId,
            loadBasis: prescription.loadBasis,
            targetWeightKg: prescription.targetWeightKg,
            targetSets: prescription.targetSets,
            targetRepsMin: prescription.targetRepsMin,
            targetRepsMax: prescription.targetRepsMax,
            targetRir: prescription.targetRir,
            progressionIncrementKg: prescription.progressionIncrementKg,
            note: prescription.note
          }))
        }))
      };
      validateTrainingProgramVersion(snapshot);

      if (trainingProgramCadenceMatches(
        active.activeVersion.cadence,
        input.cadence
      )) {
        return { outcome: "unchanged", program: active };
      }

      const version = await this.insertProgramVersionContents(
        transaction,
        personId,
        active.id,
        active.currentVersion.version + 1,
        snapshot
      );
      const [updated] = await transaction
        .update(trainingPrograms)
        .set({
          currentVersionId: version.id,
          activeVersionId: version.id,
          lockVersion: active.lockVersion + 1
        })
        .where(
          and(
            eq(trainingPrograms.id, active.id),
            eq(trainingPrograms.personId, personId),
            eq(trainingPrograms.activeVersionId, input.expectedActiveVersionId),
            eq(trainingPrograms.lockVersion, active.lockVersion)
          )
        )
        .returning();
      if (!updated) {
        throw new ConflictError("TrainingProgram changed concurrently");
      }
      return {
        outcome: "updated",
        program: await this.serializeProgram(transaction, updated)
      };
    });
  }

  public findProgram(
    personId: string,
    id: string
  ): Promise<TrainingProgram | null> {
    return this.database.db.transaction((transaction) =>
      this.readProgram(transaction, personId, id)
    );
  }

  public async findActiveProgram(
    personId: string
  ): Promise<TrainingProgram | null> {
    return this.database.db.transaction(async (transaction) => {
      const [program] = await transaction
        .select()
        .from(trainingPrograms)
        .where(
          and(
            eq(trainingPrograms.personId, personId),
            sql`${trainingPrograms.activeVersionId} IS NOT NULL`
          )
        )
        .limit(1);
      return program ? this.serializeProgram(transaction, program) : null;
    });
  }

  private async resolveSessionExercises(
    transaction: DatabaseTransaction,
    personId: string,
    exercises: CreateWorkoutSession["exercises"]
  ): Promise<
    Array<{
      input: CreateWorkoutSession["exercises"][number];
      exercise: TrainingExerciseRow;
      version: TrainingExerciseVersionRow;
    }>
  > {
    const result = [];
    for (const input of exercises) {
      const resolved = await this.resolveExerciseVersion(
        transaction,
        personId,
        input.exerciseVersionId
      );
      if (!resolved) {
        throw new NotFoundError("Training ExerciseVersion was not found");
      }
      result.push({ input, ...resolved });
    }
    return result;
  }

  private async insertSession(
    transaction: DatabaseTransaction,
    personId: string,
    input: CreateWorkoutSession | CorrectWorkoutSession,
    supersedesId: string | null,
    correctionReason: string | null
  ): Promise<{ row: WorkoutSessionRow; created: boolean }> {
    await lockPerson(transaction, personId);
    if (input.programWorkoutPosition != null && input.programVersionId == null) {
      throw new NotFoundError("TrainingProgramVersion is required for a program workout position");
    }
    if (input.programVersionId) {
      const [version] = await transaction
        .select({ id: trainingProgramVersions.id })
        .from(trainingProgramVersions)
        .where(
          and(
            eq(trainingProgramVersions.id, input.programVersionId),
            eq(trainingProgramVersions.personId, personId)
          )
        )
        .limit(1);
      if (!version) {
        throw new NotFoundError("TrainingProgramVersion was not found");
      }
      if (input.programWorkoutPosition != null) {
        const [workout] = await transaction
          .select({ id: trainingProgramWorkouts.id })
          .from(trainingProgramWorkouts)
          .where(and(
            eq(trainingProgramWorkouts.programVersionId, input.programVersionId),
            eq(trainingProgramWorkouts.position, input.programWorkoutPosition)
          ))
          .limit(1);
        if (!workout) {
          throw new NotFoundError("TrainingProgram workout was not found");
        }
      }
    }
    if (input.externalActivityId != null) {
      const successor = alias(integrationActivityFacts, "linked_activity_successor");
      const [activity] = await transaction
        .select({ id: integrationActivityFacts.id })
        .from(integrationActivityFacts)
        .where(and(
          eq(integrationActivityFacts.id, input.externalActivityId),
          eq(integrationActivityFacts.personId, personId),
          notExists(transaction.select({ id: successor.id }).from(successor).where(eq(successor.supersedesId, integrationActivityFacts.id)))
        ))
        .limit(1);
      if (!activity) {
        throw new NotFoundError("Current external activity was not found");
      }
      const sessionSuccessor = alias(workoutSessions, "linked_session_successor");
      const [alreadyLinked] = await transaction
        .select({ id: workoutSessions.id })
        .from(workoutSessions)
        .innerJoin(
          trainingWorkoutSessionActivityLinks,
          eq(trainingWorkoutSessionActivityLinks.sessionId, workoutSessions.id)
        )
        .where(and(
          eq(workoutSessions.personId, personId),
          eq(trainingWorkoutSessionActivityLinks.externalActivityId, input.externalActivityId),
          supersedesId === null ? undefined : ne(workoutSessions.id, supersedesId),
          notExists(transaction.select({ id: sessionSuccessor.id }).from(sessionSuccessor).where(eq(sessionSuccessor.supersedesId, workoutSessions.id)))
        ))
        .limit(1);
      if (alreadyLinked) {
        throw new ConflictError("External activity is already linked to a current WorkoutSession");
      }
    }
    const resolvedExercises = await this.resolveSessionExercises(
      transaction,
      personId,
      input.exercises
    );
    const sourceReference = await ensureSourceReference(
      transaction,
      personId,
      input.sourceReference
    );
    const occurredAt = new Date(input.occurredAt);
    const [session] = await transaction
      .insert(workoutSessions)
      .values({
        personId,
        occurredAt,
        temporalPrecision: "instant",
        localDate: deriveLocalDate(occurredAt, input.timezone),
        timezone: input.timezone,
        programVersionId: input.programVersionId,
        programWorkoutPosition: input.programWorkoutPosition ?? null,
        workoutName: input.workoutName,
        feeling: input.feeling,
        note: input.note,
        source: input.sourceReference.channel,
        sourceReferenceId: sourceReference.row.id,
        dedupeKey: input.dedupeKey,
        confidence:
          input.confidence === null ? null : input.confidence.toFixed(3),
        supersedesId,
        correctionReason
      })
      .onConflictDoNothing()
      .returning();
    if (!session) {
      await discardUnusedSourceReference(transaction, sourceReference);
      const [existing] = await transaction
        .select()
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.personId, personId),
            eq(workoutSessions.source, input.sourceReference.channel),
            eq(workoutSessions.dedupeKey, input.dedupeKey)
          )
        )
        .limit(1);
      if (!existing) {
        throw new Error("WorkoutSession conflict did not resolve");
      }
      return { row: existing, created: false };
    }
    if (input.externalActivityId != null) {
      await transaction.insert(trainingWorkoutSessionActivityLinks).values({
        sessionId: session.id,
        personId,
        externalActivityId: input.externalActivityId
      });
    }
    for (const [exerciseIndex, resolved] of resolvedExercises.entries()) {
      const [performed] = await transaction
        .insert(performedExercises)
        .values({
          sessionId: session.id,
          position: exerciseIndex + 1,
          exerciseId: resolved.exercise.id,
          exerciseVersionId: resolved.version.id,
          exerciseLabel: resolved.version.name,
          loadBasis: resolved.input.loadBasis,
          feeling: resolved.input.feeling,
          note: resolved.input.note
        })
        .returning();
      if (!performed) {
        throw new Error("PerformedExercise insert failed");
      }
      await transaction.insert(performedSets).values(
        resolved.input.sets.map((set, index) => ({
          performedExerciseId: performed.id,
          position: index + 1,
          weightKg: set.weightKg === null ? null : set.weightKg.toFixed(3),
          reps: set.reps,
          durationSeconds: set.durationSeconds ?? null,
          distanceMeters:
            set.distanceMeters == null ? null : set.distanceMeters.toFixed(3),
          rir: set.rir === null ? null : set.rir.toFixed(1)
        }))
      );
    }
    return { row: session, created: true };
  }

  private async serializeSession(
    transaction: DatabaseTransaction,
    session: WorkoutSessionRow,
    sourceReference?: SourceReferenceRow
  ): Promise<WorkoutSession> {
    const source =
      sourceReference ??
      (
        await transaction
          .select()
          .from(sourceReferences)
          .where(eq(sourceReferences.id, session.sourceReferenceId))
          .limit(1)
      )[0];
    if (!source) {
      throw new Error("WorkoutSession SourceReference was not found");
    }
    const [activityLink] = await transaction
      .select({ externalActivityId: trainingWorkoutSessionActivityLinks.externalActivityId })
      .from(trainingWorkoutSessionActivityLinks)
      .where(eq(trainingWorkoutSessionActivityLinks.sessionId, session.id))
      .limit(1);
    const exercises = await transaction
      .select()
      .from(performedExercises)
      .where(eq(performedExercises.sessionId, session.id))
      .orderBy(asc(performedExercises.position));
    const publicExercises = [];
    for (const exercise of exercises) {
      const sets = await transaction
        .select()
        .from(performedSets)
        .where(eq(performedSets.performedExerciseId, exercise.id))
        .orderBy(asc(performedSets.position));
      publicExercises.push({
        id: exercise.id,
        position: exercise.position,
        exerciseId: exercise.exerciseId,
        exerciseVersionId: exercise.exerciseVersionId,
        exerciseLabel: exercise.exerciseLabel,
        loadBasis: exercise.loadBasis,
        feeling: exercise.feeling,
        note: exercise.note,
        sets: sets.map((set) => ({
          id: set.id,
          position: set.position,
          weightKg: numberOrNull(set.weightKg),
          reps: set.reps,
          durationSeconds: set.durationSeconds,
          distanceMeters: numberOrNull(set.distanceMeters),
          rir: numberOrNull(set.rir)
        }))
      });
    }
    return {
      id: session.id,
      personId: session.personId,
      occurredAt: session.occurredAt?.toISOString() ?? null,
      temporalPrecision: session.temporalPrecision,
      localDate: session.localDate,
      timezone: session.timezone,
      programVersionId: session.programVersionId,
      programWorkoutPosition: session.programWorkoutPosition,
      externalActivityId: activityLink?.externalActivityId ?? null,
      workoutName: session.workoutName,
      feeling: session.feeling,
      note: session.note,
      exercises: publicExercises,
      sourceReference: toSourceReference(source),
      dedupeKey: session.dedupeKey,
      confidence: numberOrNull(session.confidence),
      supersedesId: session.supersedesId,
      correctionReason: session.correctionReason,
      createdAt: session.createdAt.toISOString()
    };
  }

  public async createWorkoutSession(
    personId: string,
    input: CreateWorkoutSession
  ): Promise<CreateWorkoutSessionResult> {
    return this.database.db.transaction(async (transaction) => {
      const result = await this.insertSession(
        transaction,
        personId,
        input,
        null,
        null
      );
      return {
        created: result.created,
        session: await this.serializeSession(transaction, result.row)
      };
    });
  }

  public async correctWorkoutSession(
    personId: string,
    id: string,
    input: CorrectWorkoutSession
  ): Promise<CreateWorkoutSessionResult> {
    return this.database.db.transaction(async (transaction) => {
      await lockPerson(transaction, personId);
      const [original] = await transaction
        .select()
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.id, id),
            eq(workoutSessions.personId, personId)
          )
        )
        .limit(1);
      if (!original) {
        throw new NotFoundError("WorkoutSession was not found");
      }
      const [replacement] = await transaction
        .select({ id: workoutSessions.id })
        .from(workoutSessions)
        .where(eq(workoutSessions.supersedesId, id))
        .limit(1);
      if (replacement) {
        const [deduplicated] = await transaction
          .select()
          .from(workoutSessions)
          .where(
            and(
              eq(workoutSessions.personId, personId),
              eq(workoutSessions.source, input.sourceReference.channel),
              eq(workoutSessions.dedupeKey, input.dedupeKey)
            )
          )
          .limit(1);
        if (deduplicated?.supersedesId === id) {
          return {
            created: false,
            session: await this.serializeSession(transaction, deduplicated)
          };
        }
        throw new ConflictError("WorkoutSession was already superseded");
      }
      const result = await this.insertSession(
        transaction,
        personId,
        input,
        id,
        input.correctionReason
      );
      if (!result.created && result.row.supersedesId !== id) {
        throw new ConflictError("dedupeKey belongs to another WorkoutSession");
      }
      return {
        created: result.created,
        session: await this.serializeSession(transaction, result.row)
      };
    });
  }

  public async findWorkoutSession(
    personId: string,
    id: string
  ): Promise<WorkoutSession | null> {
    return this.database.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.id, id),
            eq(workoutSessions.personId, personId)
          )
        )
        .limit(1);
      return row ? this.serializeSession(transaction, row) : null;
    });
  }

  public async listWorkoutSessions(
    personId: string,
    limit: number,
    localDate?: string
  ): Promise<WorkoutSessionList> {
    return this.database.db.transaction(async (transaction) => {
      const conditions = [
        eq(workoutSessions.personId, personId),
        notExists(
          this.database.db
            .select({ id: replacementSession.id })
            .from(replacementSession)
            .where(eq(replacementSession.supersedesId, workoutSessions.id))
        )
      ];
      if (localDate) {
        conditions.push(eq(workoutSessions.localDate, localDate));
      }
      const rows = await transaction
        .select()
        .from(workoutSessions)
        .where(and(...conditions))
        .orderBy(desc(workoutSessions.occurredAt), desc(workoutSessions.id))
        .limit(limit);
      return {
        items: await Promise.all(
          rows.map((row) => this.serializeSession(transaction, row))
        )
      };
    });
  }

  /** {@inheritDoc TrainingStore.listWorkoutSessionsForLocalDate} */
  public async listWorkoutSessionsForLocalDate(personId: string, localDate: string): Promise<readonly WorkoutSession[]> {
    return this.database.db.transaction(async (transaction) => {
      const successor = alias(workoutSessions, "daily_workout_successor");
      const rows = await transaction.select().from(workoutSessions).where(and(
        eq(workoutSessions.personId, personId),
        eq(workoutSessions.localDate, localDate),
        notExists(transaction.select({ id: successor.id }).from(successor).where(eq(successor.supersedesId, workoutSessions.id)))
      )).orderBy(desc(workoutSessions.occurredAt), desc(workoutSessions.id));
      return Promise.all(rows.map((row) => this.serializeSession(transaction, row)));
    });
  }

  /** {@inheritDoc TrainingStore.listWorkoutSessionsForLocalDateRange} */
  public async listWorkoutSessionsForLocalDateRange(personId: string, from: string, to: string): Promise<readonly WorkoutSession[]> {
    return this.database.db.transaction(async (transaction) => {
      const successor = alias(workoutSessions, "range_workout_successor");
      const rows = await transaction.select().from(workoutSessions).where(and(
        eq(workoutSessions.personId, personId),
        gte(workoutSessions.localDate, from),
        lte(workoutSessions.localDate, to),
        notExists(transaction.select({ id: successor.id }).from(successor).where(eq(successor.supersedesId, workoutSessions.id)))
      )).orderBy(desc(workoutSessions.localDate), desc(workoutSessions.occurredAt), desc(workoutSessions.id));
      return Promise.all(rows.map((row) => this.serializeSession(transaction, row)));
    });
  }

  /** {@inheritDoc TrainingStore.getDataCoverage} */
  public async getDataCoverage(personId: string, from: string, to: string, asOf: string): Promise<DataCoverageEvidence> {
    const sessionSuccessor = alias(workoutSessions, "coverage_workout_successor");
    const activitySuccessor = alias(integrationActivityFacts, "coverage_activity_successor");
    const currentSessions = and(
      eq(workoutSessions.personId, personId),
      isPersonContextEvidence(),
      lte(workoutSessions.localDate, asOf),
      notExists(this.database.db.select({ id: sessionSuccessor.id }).from(sessionSuccessor).where(eq(sessionSuccessor.supersedesId, workoutSessions.id)))
    );
    const currentActivities = and(
      eq(integrationActivityFacts.personId, personId),
      lte(integrationActivityFacts.localDate, asOf),
      notExists(this.database.db.select({ id: activitySuccessor.id }).from(activitySuccessor).where(eq(activitySuccessor.supersedesId, integrationActivityFacts.id)))
    );
    const [sessionBounds, activityBounds, sessionDays, activityDays] = await Promise.all([
      this.database.db.select({ firstDataDate: sql<string | null>`min(${workoutSessions.localDate})`, lastDataDate: sql<string | null>`max(${workoutSessions.localDate})` }).from(workoutSessions).innerJoin(sourceReferences, and(eq(workoutSessions.sourceReferenceId, sourceReferences.id), eq(workoutSessions.personId, sourceReferences.personId))).where(currentSessions),
      this.database.db.select({ firstDataDate: sql<string | null>`min(${integrationActivityFacts.localDate})`, lastDataDate: sql<string | null>`max(${integrationActivityFacts.localDate})` }).from(integrationActivityFacts).where(currentActivities),
      this.database.db.selectDistinct({ localDate: workoutSessions.localDate }).from(workoutSessions).innerJoin(sourceReferences, and(eq(workoutSessions.sourceReferenceId, sourceReferences.id), eq(workoutSessions.personId, sourceReferences.personId))).where(and(currentSessions, gte(workoutSessions.localDate, from), lte(workoutSessions.localDate, to))),
      this.database.db.selectDistinct({ localDate: integrationActivityFacts.localDate }).from(integrationActivityFacts).where(and(currentActivities, gte(integrationActivityFacts.localDate, from), lte(integrationActivityFacts.localDate, to)))
    ]);
    const firstDates = [sessionBounds[0]?.firstDataDate, activityBounds[0]?.firstDataDate].filter((value): value is string => value !== null && value !== undefined).sort();
    const lastDates = [sessionBounds[0]?.lastDataDate, activityBounds[0]?.lastDataDate].filter((value): value is string => value !== null && value !== undefined).sort();
    const dates = new Set([...sessionDays, ...activityDays].map((day) => day.localDate));
    return {
      firstDataDate: firstDates[0] ?? null,
      lastDataDate: lastDates.at(-1) ?? null,
      days: [...dates].map((localDate) => ({ localDate, usable: true }))
    };
  }

  public async workoutSessionHistory(
    personId: string,
    id: string
  ): Promise<WorkoutSessionHistory | null> {
    return this.database.db.transaction(async (transaction) => {
      const rows = await transaction
        .select()
        .from(workoutSessions)
        .where(eq(workoutSessions.personId, personId));
      const byId = new Map(rows.map((row) => [row.id, row]));
      let current = byId.get(id);
      if (!current) {
        return null;
      }
      while (current.supersedesId) {
        const parent = byId.get(current.supersedesId);
        if (!parent) {
          throw new Error("WorkoutSession correction chain is broken");
        }
        current = parent;
      }
      const chain: WorkoutSessionRow[] = [current];
      while (true) {
        const child = rows.find((row) => row.supersedesId === current?.id);
        if (!child) {
          break;
        }
        chain.push(child);
        current = child;
      }
      return {
        items: await Promise.all(
          chain.map((row) => this.serializeSession(transaction, row))
        )
      };
    });
  }

  public async personalRecords(personId: string): Promise<PersonalRecordList> {
    const result = await this.database.pool.query<{
      exercise_id: string;
      exercise_version_id: string;
      exercise_label: string;
      session_id: string;
      set_id: string;
      weight_kg: string;
      reps: number;
      occurred_at: Date;
    }>(
      `select distinct on (pe.exercise_id)
         pe.exercise_id,
         pe.exercise_version_id,
         pe.exercise_label,
         ws.id as session_id,
         ps.id as set_id,
         ps.weight_kg,
         ps.reps,
         ws.occurred_at
       from workout_sessions ws
       join performed_exercises pe on pe.session_id = ws.id
       join performed_sets ps on ps.performed_exercise_id = pe.id
      where ws.person_id = $1
        and ps.weight_kg is not null
        and not exists (
          select 1 from workout_sessions replacement
           where replacement.supersedes_id = ws.id
        )
      order by pe.exercise_id,
               ps.weight_kg desc,
               ps.reps desc,
               ws.occurred_at desc,
               ps.id desc`,
      [personId]
    );
    return {
      items: result.rows.map((row) => ({
        exerciseId: row.exercise_id,
        exerciseVersionId: row.exercise_version_id,
        exerciseLabel: row.exercise_label,
        sessionId: row.session_id,
        performedSetId: row.set_id,
        weightKg: Number(row.weight_kg),
        reps: row.reps,
        occurredAt: row.occurred_at.toISOString()
      }))
    };
  }

  private async progressionCandidatesInTransaction(
    transaction: DatabaseTransaction,
    personId: string
  ): Promise<ProgressionCandidateList> {
    const [program] = await transaction
      .select()
      .from(trainingPrograms)
      .where(
        and(
          eq(trainingPrograms.personId, personId),
          sql`${trainingPrograms.activeVersionId} IS NOT NULL`
        )
      )
      .limit(1);
    if (!program?.activeVersionId) {
      return { items: [] };
    }
    if (program.currentVersionId !== program.activeVersionId) {
      return { items: [] };
    }
    const version = await this.readProgramVersion(
      transaction,
      personId,
      program.activeVersionId
    );
    if (!version) {
      throw new Error("Active TrainingProgramVersion was not found");
    }
    const items: ProgressionCandidateList["items"] = [];
    for (const workout of version.workouts) {
      for (const prescription of workout.prescriptions) {
        if (
          prescription.targetWeightKg === null ||
          prescription.progressionIncrementKg === null
        ) {
          continue;
        }
        const [evidence] = await transaction
          .select({ session: workoutSessions, exercise: performedExercises })
          .from(workoutSessions)
          .innerJoin(
            performedExercises,
            eq(performedExercises.sessionId, workoutSessions.id)
          )
          .where(
            and(
              eq(workoutSessions.personId, personId),
              eq(workoutSessions.programVersionId, version.id),
              eq(workoutSessions.workoutName, workout.name),
              eq(
                performedExercises.exerciseVersionId,
                prescription.exerciseVersionId
              ),
              notExists(
                transaction
                  .select({ id: replacementSession.id })
                  .from(replacementSession)
                  .where(
                    eq(replacementSession.supersedesId, workoutSessions.id)
                  )
              )
            )
          )
          .orderBy(
            desc(workoutSessions.occurredAt),
            desc(workoutSessions.id),
            asc(performedExercises.position)
          )
          .limit(1);
        if (!evidence) {
          continue;
        }
        const sets = await transaction
          .select()
          .from(performedSets)
          .where(
            eq(performedSets.performedExerciseId, evidence.exercise.id)
          )
          .orderBy(asc(performedSets.position));
        const suggested = calculateProgressionWeight(
          prescription,
          sets.filter((set) => set.reps !== null).map((set) => ({
            reps: set.reps!,
            rir: numberOrNull(set.rir)
          }))
        );
        if (suggested !== null) {
          items.push({
            programId: program.id,
            programLockVersion: program.lockVersion,
            programVersionId: version.id,
            workoutPosition: workout.position,
            prescriptionPosition: prescription.position,
            exerciseId: prescription.exerciseId,
            exerciseVersionId: prescription.exerciseVersionId,
            exerciseLabel: prescription.exerciseLabel,
            currentTargetWeightKg: prescription.targetWeightKg,
            suggestedTargetWeightKg: suggested,
            evidenceSessionId: evidence.session.id
          });
        }
      }
    }
    return { items };
  }

  public progressionCandidates(
    personId: string
  ): Promise<ProgressionCandidateList> {
    return this.database.db.transaction((transaction) =>
      this.progressionCandidatesInTransaction(transaction, personId)
    );
  }

  public async acceptProgressionCandidate(
    personId: string,
    programId: string,
    input: AcceptProgressionCandidate
  ): Promise<TrainingProgram> {
    return this.database.db.transaction(async (transaction) => {
      await lockPerson(transaction, personId);
      const current = await this.readProgram(
        transaction,
        personId,
        programId
      );
      if (!current) {
        throw new NotFoundError("TrainingProgram was not found");
      }
      if (current.lockVersion !== input.expectedLockVersion) {
        throw new ConflictError("TrainingProgram changed concurrently");
      }
      if (
        current.activeVersionId !== input.programVersionId ||
        current.currentVersion.id !== input.programVersionId
      ) {
        throw new ConflictError(
          "TrainingProgram has changed or already has an inactive draft"
        );
      }
      const candidates = await this.progressionCandidatesInTransaction(
        transaction,
        personId
      );
      const candidate = candidates.items.find(
        (item) =>
          item.programId === programId &&
          item.programVersionId === input.programVersionId &&
          item.workoutPosition === input.workoutPosition &&
          item.prescriptionPosition === input.prescriptionPosition &&
          item.evidenceSessionId === input.evidenceSessionId
      );
      if (!candidate) {
        throw new ConflictError("Progression candidate is no longer valid");
      }
      const activeVersion = await this.readProgramVersion(
        transaction,
        personId,
        input.programVersionId
      );
      if (!activeVersion) {
        throw new ConflictError("Active TrainingProgramVersion changed");
      }
      const nextInput: CreateTrainingProgramVersion = {
        expectedLockVersion: input.expectedLockVersion,
        name: activeVersion.name,
        note: activeVersion.note,
        ...(activeVersion.cadence === null ? {} : { cadence: activeVersion.cadence }),
        workouts: activeVersion.workouts.map((workout) => ({
          name: workout.name,
          prescriptions: workout.prescriptions.map((prescription) => ({
            exerciseVersionId: prescription.exerciseVersionId,
            loadBasis: prescription.loadBasis,
            targetWeightKg:
              workout.position === input.workoutPosition &&
              prescription.position === input.prescriptionPosition
                ? candidate.suggestedTargetWeightKg
                : prescription.targetWeightKg,
            targetSets: prescription.targetSets,
            targetRepsMin: prescription.targetRepsMin,
            targetRepsMax: prescription.targetRepsMax,
            targetRir: prescription.targetRir,
            progressionIncrementKg: prescription.progressionIncrementKg,
            note: prescription.note
          }))
        }))
      };
      const version = await this.insertProgramVersionContents(
        transaction,
        personId,
        programId,
        current.currentVersion.version + 1,
        nextInput
      );
      const [updated] = await transaction
        .update(trainingPrograms)
        .set({
          currentVersionId: version.id,
          lockVersion: current.lockVersion + 1
        })
        .where(
          and(
            eq(trainingPrograms.id, programId),
            eq(trainingPrograms.personId, personId),
            eq(trainingPrograms.lockVersion, current.lockVersion)
          )
        )
        .returning();
      if (!updated) {
        throw new ConflictError("TrainingProgram changed concurrently");
      }
      return this.serializeProgram(transaction, updated);
    });
  }
}
