import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseInterceptors
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

import {
  AcceptProgressionCandidateSchema,
  ActivateTrainingProgramVersionSchema,
  CorrectWorkoutSessionSchema,
  CreateExerciseSchema,
  CreateExerciseVersionSchema,
  CreateTrainingProgramSchema,
  CreateTrainingProgramVersionSchema,
  CreateWorkoutSessionSchema,
  ExerciseOverlaySchema,
  ExerciseSchema,
  ListWorkoutSessionsQuerySchema,
  PersonalRecordListSchema,
  ProgressionCandidateListSchema,
  TrainingIdParamsSchema,
  TrainingProgramSchema,
  TrainingVersionParamsSchema,
  UpsertExerciseOverlaySchema,
  WorkoutSessionHistorySchema,
  WorkoutSessionListSchema,
  WorkoutSessionSchema,
  type AcceptProgressionCandidate,
  type ActivateTrainingProgramVersion,
  type CorrectWorkoutSession,
  type CreateExercise,
  type CreateExerciseVersion,
  type CreateTrainingProgram,
  type CreateTrainingProgramVersion,
  type CreateWorkoutSession,
  type Exercise,
  type ExerciseOverlay,
  type ListWorkoutSessionsQuery,
  type PersonalRecordList,
  type ProgressionCandidateList,
  type TrainingIdParams,
  type TrainingProgram,
  type TrainingVersionParams,
  type UpsertExerciseOverlay,
  type WorkoutSession,
  type WorkoutSessionHistory,
  type WorkoutSessionList
} from "@shape-of-you/contracts";

import {
  JsonSchemaPipe,
  JsonSchemaResponseInterceptor
} from "../http/json-schema.js";
import { TrainingService } from "./training.service.js";

/** HTTP transport for shared and Person-private Exercise definitions. */
@Controller("v1/training/catalog/exercises")
export class TrainingCatalogController {
  public constructor(
    @Inject(TrainingService) private readonly service: TrainingService
  ) {}

  /** Creates an Exercise and its first immutable revision. */
  @Post()
  @UseInterceptors(new JsonSchemaResponseInterceptor(ExerciseSchema))
  public async create(
    @Body(new JsonSchemaPipe<CreateExercise>(CreateExerciseSchema))
    input: CreateExercise,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<Exercise> {
    void reply.code(201);
    return this.service.createExercise(input);
  }

  /** Appends and selects one immutable Exercise revision. */
  @Post(":id/versions")
  @UseInterceptors(new JsonSchemaResponseInterceptor(ExerciseSchema))
  public addVersion(
    @Param(new JsonSchemaPipe<TrainingIdParams>(TrainingIdParamsSchema, true))
    params: TrainingIdParams,
    @Body(
      new JsonSchemaPipe<CreateExerciseVersion>(CreateExerciseVersionSchema)
    )
    input: CreateExerciseVersion
  ): Promise<Exercise> {
    return this.service.addExerciseVersion(params.id, input);
  }

  /** Reads one accessible Exercise. */
  @Get(":id")
  @UseInterceptors(new JsonSchemaResponseInterceptor(ExerciseSchema))
  public find(
    @Param(new JsonSchemaPipe<TrainingIdParams>(TrainingIdParamsSchema, true))
    params: TrainingIdParams
  ): Promise<Exercise> {
    return this.service.findExercise(params.id);
  }

  /** Replaces the active Person's overlay for one Exercise. */
  @Put(":id/overlay")
  @UseInterceptors(new JsonSchemaResponseInterceptor(ExerciseOverlaySchema))
  public upsertOverlay(
    @Param(new JsonSchemaPipe<TrainingIdParams>(TrainingIdParamsSchema, true))
    params: TrainingIdParams,
    @Body(
      new JsonSchemaPipe<UpsertExerciseOverlay>(UpsertExerciseOverlaySchema)
    )
    input: UpsertExerciseOverlay
  ): Promise<ExerciseOverlay> {
    return this.service.upsertExerciseOverlay(params.id, input);
  }
}

/** HTTP transport for Person-owned immutable training-program versions. */
@Controller("v1/training/programs")
export class TrainingProgramController {
  public constructor(
    @Inject(TrainingService) private readonly service: TrainingService
  ) {}

  /** Creates a program and its first inactive draft version. */
  @Post()
  @UseInterceptors(new JsonSchemaResponseInterceptor(TrainingProgramSchema))
  public async create(
    @Body(
      new JsonSchemaPipe<CreateTrainingProgram>(CreateTrainingProgramSchema)
    )
    input: CreateTrainingProgram,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<TrainingProgram> {
    void reply.code(201);
    return this.service.createProgram(input);
  }

  /** Reads the active Person's single explicitly activated program. */
  @Get("active")
  @UseInterceptors(new JsonSchemaResponseInterceptor(TrainingProgramSchema))
  public active(): Promise<TrainingProgram> {
    return this.service.findActiveProgram();
  }

  /** Reads one Person-owned program. */
  @Get(":id")
  @UseInterceptors(new JsonSchemaResponseInterceptor(TrainingProgramSchema))
  public find(
    @Param(new JsonSchemaPipe<TrainingIdParams>(TrainingIdParamsSchema, true))
    params: TrainingIdParams
  ): Promise<TrainingProgram> {
    return this.service.findProgram(params.id);
  }

  /** Appends one immutable inactive program version. */
  @Post(":id/versions")
  @UseInterceptors(new JsonSchemaResponseInterceptor(TrainingProgramSchema))
  public addVersion(
    @Param(new JsonSchemaPipe<TrainingIdParams>(TrainingIdParamsSchema, true))
    params: TrainingIdParams,
    @Body(
      new JsonSchemaPipe<CreateTrainingProgramVersion>(
        CreateTrainingProgramVersionSchema
      )
    )
    input: CreateTrainingProgramVersion
  ): Promise<TrainingProgram> {
    return this.service.addProgramVersion(params.id, input);
  }

  /** Explicitly activates one immutable program version. */
  @Post(":id/versions/:versionId/activate")
  @UseInterceptors(new JsonSchemaResponseInterceptor(TrainingProgramSchema))
  public activate(
    @Param(
      new JsonSchemaPipe<TrainingVersionParams>(
        TrainingVersionParamsSchema,
        true
      )
    )
    params: TrainingVersionParams,
    @Body(
      new JsonSchemaPipe<ActivateTrainingProgramVersion>(
        ActivateTrainingProgramVersionSchema
      )
    )
    input: ActivateTrainingProgramVersion
  ): Promise<TrainingProgram> {
    return this.service.activateProgramVersion(
      params.id,
      params.versionId,
      input
    );
  }

  /** Accepts a current progression suggestion as a new inactive draft. */
  @Post(":id/progression-candidates/accept")
  @UseInterceptors(new JsonSchemaResponseInterceptor(TrainingProgramSchema))
  public acceptProgression(
    @Param(new JsonSchemaPipe<TrainingIdParams>(TrainingIdParamsSchema, true))
    params: TrainingIdParams,
    @Body(
      new JsonSchemaPipe<AcceptProgressionCandidate>(
        AcceptProgressionCandidateSchema
      )
    )
    input: AcceptProgressionCandidate
  ): Promise<TrainingProgram> {
    return this.service.acceptProgressionCandidate(params.id, input);
  }
}

/** HTTP transport for WorkoutSession facts and Training projections. */
@Controller("v1/training")
export class WorkoutSessionController {
  public constructor(
    @Inject(TrainingService) private readonly service: TrainingService
  ) {}

  /** Creates one idempotent immutable WorkoutSession. */
  @Post("sessions")
  @UseInterceptors(new JsonSchemaResponseInterceptor(WorkoutSessionSchema))
  public async create(
    @Body(
      new JsonSchemaPipe<CreateWorkoutSession>(CreateWorkoutSessionSchema)
    )
    input: CreateWorkoutSession,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<WorkoutSession> {
    const result = await this.service.createWorkoutSession(input);
    void reply.code(result.created ? 201 : 200);
    return result.session;
  }

  /** Lists current sessions with an optional local-date filter. */
  @Get("sessions")
  @UseInterceptors(new JsonSchemaResponseInterceptor(WorkoutSessionListSchema))
  public list(
    @Query(
      new JsonSchemaPipe<ListWorkoutSessionsQuery>(
        ListWorkoutSessionsQuerySchema,
        true
      )
    )
    query: ListWorkoutSessionsQuery
  ): Promise<WorkoutSessionList> {
    return this.service.listWorkoutSessions(query);
  }

  /** Reads one immutable WorkoutSession. */
  @Get("sessions/:id")
  @UseInterceptors(new JsonSchemaResponseInterceptor(WorkoutSessionSchema))
  public find(
    @Param(new JsonSchemaPipe<TrainingIdParams>(TrainingIdParamsSchema, true))
    params: TrainingIdParams
  ): Promise<WorkoutSession> {
    return this.service.findWorkoutSession(params.id);
  }

  /** Appends a full immutable replacement for one session. */
  @Post("sessions/:id/corrections")
  @UseInterceptors(new JsonSchemaResponseInterceptor(WorkoutSessionSchema))
  public async correct(
    @Param(new JsonSchemaPipe<TrainingIdParams>(TrainingIdParamsSchema, true))
    params: TrainingIdParams,
    @Body(
      new JsonSchemaPipe<CorrectWorkoutSession>(CorrectWorkoutSessionSchema)
    )
    input: CorrectWorkoutSession,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<WorkoutSession> {
    const result = await this.service.correctWorkoutSession(params.id, input);
    void reply.code(result.created ? 201 : 200);
    return result.session;
  }

  /** Reads the complete append-only session correction chain. */
  @Get("sessions/:id/history")
  @UseInterceptors(
    new JsonSchemaResponseInterceptor(WorkoutSessionHistorySchema)
  )
  public history(
    @Param(new JsonSchemaPipe<TrainingIdParams>(TrainingIdParamsSchema, true))
    params: TrainingIdParams
  ): Promise<WorkoutSessionHistory> {
    return this.service.workoutSessionHistory(params.id);
  }

  /** Calculates current strength records from non-superseded sets. */
  @Get("personal-records")
  @UseInterceptors(new JsonSchemaResponseInterceptor(PersonalRecordListSchema))
  public personalRecords(): Promise<PersonalRecordList> {
    return this.service.personalRecords();
  }

  /** Calculates eligible progression suggestions without mutation. */
  @Get("progression-candidates")
  @UseInterceptors(
    new JsonSchemaResponseInterceptor(ProgressionCandidateListSchema)
  )
  public progressionCandidates(): Promise<ProgressionCandidateList> {
    return this.service.progressionCandidates();
  }
}
