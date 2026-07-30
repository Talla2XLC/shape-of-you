import { DynamicModule, Global, Module } from "@nestjs/common";

import type { DatabaseContext } from "../database/context.js";
import { DatabaseLifecycle } from "../database/lifecycle.js";
import type { ReadinessProbe } from "../system/system.controller.js";
import { SystemModule } from "../system/system.module.js";
import type { WeightMeasurementStore } from "../storage/weight-measurement-repository.js";
import { WeightMeasurementModule } from "../weight-measurements/weight-measurement.module.js";
import {
  READINESS_PROBE,
  WEIGHT_MEASUREMENT_STORE
} from "./tokens.js";

/** Explicit runtime dependencies composed before Nest creates the module graph. */
export interface AppModuleOptions {
  /** Persistence boundary used by the WeightMeasurement module. */
  readonly store: WeightMeasurementStore;
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
          provide: WEIGHT_MEASUREMENT_STORE,
          useValue: options.store
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
        WeightMeasurementModule
      ]
    };
  }
}
