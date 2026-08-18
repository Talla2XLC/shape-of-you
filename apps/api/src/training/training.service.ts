import { Inject, Injectable } from "@nestjs/common";

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
  ListWorkoutSessionsQuery,
  PersonalRecordList,
  ProgressionCandidateList,
  TrainingProgram,
  UpsertExerciseOverlay,
  WorkoutSession,
  WorkoutSessionHistory,
  WorkoutSessionList
} from "@shape-of-you/contracts";

import type { PersonContext } from "../application/person-context.js";
import { PERSON_CONTEXT, TRAINING_STORE } from "../application/tokens.js";
import { NotFoundError } from "../domain/errors.js";
import type {
  CreateWorkoutSessionResult,
  TrainingStore
} from "../storage/training-repository.js";

/** Application boundary for Training reference data, plans, facts, and projections. */
@Injectable()
export class TrainingService {
  public constructor(
    @Inject(TRAINING_STORE)
    private readonly store: TrainingStore,
    @Inject(PERSON_CONTEXT)
    private readonly personContext: PersonContext
  ) {}

  /** Creates a shared or Person-private Exercise with its first revision. */
  public createExercise(input: CreateExercise): Promise<Exercise> {
    return this.store.createExercise(this.personContext.getPersonId(), input);
  }

  /** Appends and selects one immutable Exercise revision. */
  public addExerciseVersion(
    id: string,
    input: CreateExerciseVersion
  ): Promise<Exercise> {
    return this.store.appendExerciseVersion(
      this.personContext.getPersonId(),
      id,
      input
    );
  }

  /** Reads one accessible Exercise. */
  public async findExercise(id: string): Promise<Exercise> {
    const exercise = await this.store.findExercise(
      this.personContext.getPersonId(),
      id
    );
    if (!exercise) {
      throw new NotFoundError("Training Exercise was not found");
    }
    return exercise;
  }

  /** Replaces the active Person's overlay for one Exercise. */
  public upsertExerciseOverlay(
    id: string,
    input: UpsertExerciseOverlay
  ): Promise<ExerciseOverlay> {
    return this.store.upsertExerciseOverlay(
      this.personContext.getPersonId(),
      id,
      input
    );
  }

  /** Creates a Person-owned program with its first immutable draft version. */
  public createProgram(input: CreateTrainingProgram): Promise<TrainingProgram> {
    return this.store.createProgram(this.personContext.getPersonId(), input);
  }

  /** Appends one immutable draft version without activating it. */
  public addProgramVersion(
    id: string,
    input: CreateTrainingProgramVersion
  ): Promise<TrainingProgram> {
    return this.store.appendProgramVersion(
      this.personContext.getPersonId(),
      id,
      input
    );
  }

  /** Explicitly activates one version and deactivates any previous program. */
  public activateProgramVersion(
    id: string,
    versionId: string,
    input: ActivateTrainingProgramVersion
  ): Promise<TrainingProgram> {
    return this.store.activateProgramVersion(
      this.personContext.getPersonId(),
      id,
      versionId,
      input
    );
  }

  /** Reads one Person-owned training program. */
  public async findProgram(id: string): Promise<TrainingProgram> {
    const program = await this.store.findProgram(
      this.personContext.getPersonId(),
      id
    );
    if (!program) {
      throw new NotFoundError("TrainingProgram was not found");
    }
    return program;
  }

  /** Reads the active Person's single explicitly activated program. */
  public async findActiveProgram(): Promise<TrainingProgram> {
    const program = await this.store.findActiveProgram(
      this.personContext.getPersonId()
    );
    if (!program) {
      throw new NotFoundError("Active TrainingProgram was not found");
    }
    return program;
  }

  /** Creates one idempotent immutable WorkoutSession fact. */
  public createWorkoutSession(
    input: CreateWorkoutSession
  ): Promise<CreateWorkoutSessionResult> {
    return this.store.createWorkoutSession(
      this.personContext.getPersonId(),
      input
    );
  }

  /** Appends an idempotent full replacement for one WorkoutSession. */
  public correctWorkoutSession(
    id: string,
    input: CorrectWorkoutSession
  ): Promise<CreateWorkoutSessionResult> {
    return this.store.correctWorkoutSession(
      this.personContext.getPersonId(),
      id,
      input
    );
  }

  /** Reads one immutable WorkoutSession by UUID. */
  public async findWorkoutSession(id: string): Promise<WorkoutSession> {
    const session = await this.store.findWorkoutSession(
      this.personContext.getPersonId(),
      id
    );
    if (!session) {
      throw new NotFoundError("WorkoutSession was not found");
    }
    return session;
  }

  /** Lists bounded current WorkoutSession facts. */
  public listWorkoutSessions(
    query: ListWorkoutSessionsQuery
  ): Promise<WorkoutSessionList> {
    return this.store.listWorkoutSessions(
      this.personContext.getPersonId(),
      query.limit ?? 50,
      query.localDate
    );
  }

  /** Reads all current workout sessions for a single local date for a coordinating projection. */
  public listWorkoutSessionsForLocalDate(localDate: string): Promise<readonly WorkoutSession[]> {
    return this.store.listWorkoutSessionsForLocalDate(this.personContext.getPersonId(), localDate);
  }

  /** Reads current workout-session facts across an inclusive Person-local date range. */
  public listWorkoutSessionsForLocalDateRange(from: string, to: string): Promise<readonly WorkoutSession[]> {
    return this.store.listWorkoutSessionsForLocalDateRange(this.personContext.getPersonId(), from, to);
  }

  /** Reads the complete append-only correction chain for one session. */
  public async workoutSessionHistory(
    id: string
  ): Promise<WorkoutSessionHistory> {
    const history = await this.store.workoutSessionHistory(
      this.personContext.getPersonId(),
      id
    );
    if (!history) {
      throw new NotFoundError("WorkoutSession was not found");
    }
    return history;
  }

  /** Calculates one current strength record per Exercise identity. */
  public personalRecords(): Promise<PersonalRecordList> {
    return this.store.personalRecords(this.personContext.getPersonId());
  }

  /** Calculates eligible progression suggestions without mutating a program. */
  public progressionCandidates(): Promise<ProgressionCandidateList> {
    return this.store.progressionCandidates(
      this.personContext.getPersonId()
    );
  }

  /** Accepts a still-valid candidate as a new inactive program draft. */
  public acceptProgressionCandidate(
    programId: string,
    input: AcceptProgressionCandidate
  ): Promise<TrainingProgram> {
    return this.store.acceptProgressionCandidate(
      this.personContext.getPersonId(),
      programId,
      input
    );
  }
}
