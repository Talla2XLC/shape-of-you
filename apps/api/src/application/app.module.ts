import { DynamicModule, Global, Module } from "@nestjs/common";

import type { DatabaseContext } from "../database/context.js";
import { DatabaseLifecycle } from "../database/lifecycle.js";
import type { ReadinessProbe } from "../system/system.controller.js";
import type { PersonContext } from "./person-context.js";
import { SystemModule } from "../system/system.module.js";
import type { WeightMeasurementStore } from "../storage/weight-measurement-repository.js";
import type { BodyMeasurementSessionStore } from "../storage/body-measurement-session-repository.js";
import type { PhysicalGoalStore } from "../storage/physical-goal-repository.js";
import type { NutritionStore } from "../storage/nutrition-repository.js";
import type { TrainingStore } from "../storage/training-repository.js";
import type { RecoveryStore } from "../storage/recovery-repository.js";
import { BodyMeasurementSessionModule } from "../body-measurement-sessions/body-measurement-session.module.js";
import { PhysicalGoalModule } from "../physical-goals/physical-goal.module.js";
import { WeightMeasurementModule } from "../weight-measurements/weight-measurement.module.js";
import { NutritionModule } from "../nutrition/nutrition.module.js";
import { TrainingModule } from "../training/training.module.js";
import { RecoveryModule } from "../recovery/recovery.module.js";
import {
  PERSON_CONTEXT,
  BODY_MEASUREMENT_SESSION_STORE,
  PHYSICAL_GOAL_STORE,
  NUTRITION_STORE,
  TRAINING_STORE,
  RECOVERY_STORE,
  READINESS_PROBE,
  WEIGHT_MEASUREMENT_STORE
} from "./tokens.js";

/** Explicit runtime dependencies composed before Nest creates the module graph. */
export interface AppModuleOptions {
  /** Boundary that resolves the Person authorized for each operation. */
  readonly personContext: PersonContext;
  /** Persistence boundary used by the WeightMeasurement module. */
  readonly store: WeightMeasurementStore;
  /** Persistence boundary used by the BodyMeasurementSession module. */
  readonly bodyMeasurementSessionStore: BodyMeasurementSessionStore;
  /** Persistence boundary used by the PhysicalGoal module. */
  readonly physicalGoalStore: PhysicalGoalStore;
  /** Persistence boundary used by the Nutrition module. */
  readonly nutritionStore: NutritionStore;
  /** Persistence boundary used by the Training module. */
  readonly trainingStore: TrainingStore;
  /** Persistence boundary used by the Recovery module. */
  readonly recoveryStore: RecoveryStore;
  /** Probe that resolves only when required dependencies are ready. */
  readonly readinessProbe: ReadinessProbe;
  /** Database context available to the application, when configured. */
  readonly database: DatabaseContext | undefined;
  /** Whether application shutdown must close the supplied database context. */
  readonly ownsDatabase: boolean;
}

@Global()
@Module({})
class RuntimeDependenciesModule {
  public static register(options: AppModuleOptions): DynamicModule {
    return {
      module: RuntimeDependenciesModule,
      providers: [
        {
          provide: PERSON_CONTEXT,
          useValue: options.personContext
        },
        {
          provide: WEIGHT_MEASUREMENT_STORE,
          useValue: options.store
        },
        {
          provide: BODY_MEASUREMENT_SESSION_STORE,
          useValue: options.bodyMeasurementSessionStore
        },
        {
          provide: PHYSICAL_GOAL_STORE,
          useValue: options.physicalGoalStore
        },
        {
          provide: NUTRITION_STORE,
          useValue: options.nutritionStore
        },
        {
          provide: TRAINING_STORE,
          useValue: options.trainingStore
        },
        {
          provide: RECOVERY_STORE,
          useValue: options.recoveryStore
        },
        {
          provide: READINESS_PROBE,
          useValue: options.readinessProbe
        },
        {
          provide: DatabaseLifecycle,
          useValue: new DatabaseLifecycle(
            options.database,
            options.ownsDatabase
          )
        }
      ],
      exports: [
        PERSON_CONTEXT,
        BODY_MEASUREMENT_SESSION_STORE,
        PHYSICAL_GOAL_STORE,
        NUTRITION_STORE,
        TRAINING_STORE,
        RECOVERY_STORE,
        WEIGHT_MEASUREMENT_STORE,
        READINESS_PROBE,
        DatabaseLifecycle
      ]
    };
  }
}

/** Root Nest module for the single deployable backend application. */
@Module({})
export class AppModule {
  /**
   * Composes the root module with caller-selected infrastructure dependencies.
   *
   * @param options - Runtime dependencies and lifecycle ownership.
   * @returns Dynamic root module ready for Nest bootstrap.
   */
  public static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        RuntimeDependenciesModule.register(options),
        SystemModule,
        WeightMeasurementModule,
        BodyMeasurementSessionModule,
        PhysicalGoalModule,
        NutritionModule,
        TrainingModule,
        RecoveryModule
      ]
    };
  }
}
