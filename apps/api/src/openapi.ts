import {
  AcceptProgressionCandidateSchema,
  ActivateTrainingProgramVersionSchema,
  BodyMeasurementSessionHistorySchema,
  BodyMeasurementSessionIdParamsSchema,
  BodyMeasurementSessionListSchema,
  BodyMeasurementSessionSchema,
  BrandSchema,
  CatalogIdParamsSchema,
  CorrectBodyMeasurementSessionSchema,
  CorrectMealSchema,
  CorrectWorkoutSessionSchema,
  CreateBodyMeasurementSessionSchema,
  CreateBrandSchema,
  CreateBrandVersionSchema,
  CreateFoodSchema,
  CreateFoodVersionSchema,
  CreateIngredientSchema,
  CreateIngredientVersionSchema,
  CreateMealSchema,
  CreatePhysicalGoalSchema,
  CreatePhysicalGoalVersionSchema,
  CorrectWeightMeasurementSchema,
  CreateWeightMeasurementSchema,
  CreateExerciseSchema,
  CreateExerciseVersionSchema,
  CreateTrainingProgramSchema,
  CreateTrainingProgramVersionSchema,
  CreateWorkoutSessionSchema,
  ErrorResponseSchema,
  FoodOverlaySchema,
  FoodSchema,
  HealthResponseSchema,
  IngredientSchema,
  ListBodyMeasurementSessionsQuerySchema,
  ListPhysicalGoalsQuerySchema,
  ListMealsQuerySchema,
  ListWeightMeasurementsQuerySchema,
  ListWorkoutSessionsQuerySchema,
  PhysicalGoalHistorySchema,
  PhysicalGoalIdParamsSchema,
  PhysicalGoalListSchema,
  PhysicalGoalSchema,
  PhysicalGoalTransitionSchema,
  PhysicalGoalVersionParamsSchema,
  DailyNutritionTotalsQuerySchema,
  DailyNutritionTotalsSchema,
  MealHistorySchema,
  MealIdParamsSchema,
  MealListSchema,
  MealSchema,
  ReadinessResponseSchema,
  ExerciseOverlaySchema,
  ExerciseSchema,
  PersonalRecordListSchema,
  ProgressionCandidateListSchema,
  TrainingIdParamsSchema,
  TrainingProgramSchema,
  TrainingVersionParamsSchema,
  UpsertExerciseOverlaySchema,
  WeightMeasurementHistorySchema,
  WeightMeasurementIdParamsSchema,
  WeightMeasurementListSchema,
  WeightMeasurementSchema,
  WorkoutSessionHistorySchema,
  WorkoutSessionListSchema,
  WorkoutSessionSchema,
  UpsertFoodOverlaySchema,
  CorrectRecoveryObservationSchema,
  CreateRecoveryAssessmentSchema,
  CreateRecoveryConnectionSchema,
  CreateRecoveryObservationSchema,
  GrantRecoveryConsentSchema,
  ListRecoveryAssessmentsQuerySchema,
  ListRecoveryObservationsQuerySchema,
  RecoveryAssessmentListSchema,
  RecoveryAssessmentSchema,
  RecoveryConnectionSchema,
  RecoveryConsentSchema,
  RecoveryIdParamsSchema,
  RecoveryObservationHistorySchema,
  RecoveryObservationListSchema,
  RecoveryObservationSchema,
  RevokeRecoveryConsentSchema,
  CoachingRecommendationHistorySchema,
  CoachingRecommendationIdParamsSchema,
  CoachingRecommendationListSchema,
  CoachingRecommendationSchema,
  CreateCoachingRecommendationDecisionSchema,
  CreateTrainingAdjustmentRecommendationSchema,
  ListCoachingRecommendationsQuerySchema,
  ClarifyIntakeItemSchema,
  CreateIntakeRequestSchema,
  DecideIntakeItemSchema,
  IntakeItemParamsSchema,
  IntakeRequestIdParamsSchema,
  IntakeRequestSchema,
  CloseDaySchema,
  DailyProjectionQuerySchema,
  DailyProjectionSchema,
  DayClosureHistorySchema,
  DayClosureSchema,
  ReopenDaySchema,
  ProgressOverviewQuerySchema,
  ProgressOverviewSchema
} from "@shape-of-you/contracts";

function schemaParameter(
  name: string,
  location: "path" | "query",
  required: boolean,
  schema: object
): object {
  return { name, in: location, required, schema };
}

function bodyMeasurementPaths(): Record<string, object> {
  return {
    "/v1/body-measurement-sessions": {
      post: {
        tags: ["body-measurements"],
        summary: "Create an immutable body measurement session",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: CreateBodyMeasurementSessionSchema
            }
          }
        },
        responses: {
          "200": {
            description: "Existing session for the dedupe key",
            content: {
              "application/json": {
                schema: BodyMeasurementSessionSchema
              }
            }
          },
          "201": {
            description: "Session created",
            content: {
              "application/json": {
                schema: BodyMeasurementSessionSchema
              }
            }
          },
          "400": {
            description: "Invalid request",
            content: {
              "application/json": { schema: ErrorResponseSchema }
            }
          }
        }
      },
      get: {
        tags: ["body-measurements"],
        summary: "List current body measurement sessions",
        parameters: [
          schemaParameter(
            "limit",
            "query",
            false,
            ListBodyMeasurementSessionsQuerySchema.properties.limit
          ),
          schemaParameter(
            "cursor",
            "query",
            false,
            ListBodyMeasurementSessionsQuerySchema.properties.cursor
          ),
          schemaParameter(
            "metric",
            "query",
            false,
            ListBodyMeasurementSessionsQuerySchema.properties.metric
          )
        ],
        responses: {
          "200": {
            description: "Stable session page",
            content: {
              "application/json": {
                schema: BodyMeasurementSessionListSchema
              }
            }
          }
        }
      }
    },
    "/v1/body-measurement-sessions/{id}": {
      get: {
        tags: ["body-measurements"],
        summary: "Read a body measurement session",
        parameters: [
          schemaParameter(
            "id",
            "path",
            true,
            BodyMeasurementSessionIdParamsSchema.properties.id
          )
        ],
        responses: {
          "200": {
            description: "Session found",
            content: {
              "application/json": {
                schema: BodyMeasurementSessionSchema
              }
            }
          },
          "404": {
            description: "Session not found",
            content: {
              "application/json": { schema: ErrorResponseSchema }
            }
          }
        }
      }
    },
    "/v1/body-measurement-sessions/{id}/corrections": {
      post: {
        tags: ["body-measurements"],
        summary: "Append a full body session correction",
        parameters: [
          schemaParameter(
            "id",
            "path",
            true,
            BodyMeasurementSessionIdParamsSchema.properties.id
          )
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: CorrectBodyMeasurementSessionSchema
            }
          }
        },
        responses: {
          "200": {
            description: "Existing idempotent correction",
            content: {
              "application/json": {
                schema: BodyMeasurementSessionSchema
              }
            }
          },
          "201": {
            description: "Correction appended",
            content: {
              "application/json": {
                schema: BodyMeasurementSessionSchema
              }
            }
          },
          "409": {
            description: "Session already superseded",
            content: {
              "application/json": { schema: ErrorResponseSchema }
            }
          }
        }
      }
    },
    "/v1/body-measurement-sessions/{id}/history": {
      get: {
        tags: ["body-measurements"],
        summary: "Read the complete body session correction chain",
        parameters: [
          schemaParameter(
            "id",
            "path",
            true,
            BodyMeasurementSessionIdParamsSchema.properties.id
          )
        ],
        responses: {
          "200": {
            description: "Original-to-current session chain",
            content: {
              "application/json": {
                schema: BodyMeasurementSessionHistorySchema
              }
            }
          }
        }
      }
    }
  };
}

function physicalGoalPaths(): Record<string, object> {
  const goalResponse = {
    description: "PhysicalGoal aggregate",
    content: {
      "application/json": { schema: PhysicalGoalSchema }
    }
  };
  const transitionBody = {
    required: true,
    content: {
      "application/json": { schema: PhysicalGoalTransitionSchema }
    }
  };
  return {
    "/v1/physical-goals": {
      post: {
        tags: ["physical-goals"],
        summary: "Create a goal and first draft version",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: CreatePhysicalGoalSchema }
          }
        },
        responses: { "200": goalResponse, "201": goalResponse }
      },
      get: {
        tags: ["physical-goals"],
        summary: "List goals by lifecycle status",
        parameters: [
          schemaParameter(
            "status",
            "query",
            false,
            ListPhysicalGoalsQuerySchema.properties.status
          )
        ],
        responses: {
          "200": {
            description: "Goal list",
            content: {
              "application/json": { schema: PhysicalGoalListSchema }
            }
          }
        }
      }
    },
    "/v1/physical-goals/{id}": {
      get: {
        tags: ["physical-goals"],
        summary: "Read one PhysicalGoal",
        parameters: [
          schemaParameter(
            "id",
            "path",
            true,
            PhysicalGoalIdParamsSchema.properties.id
          )
        ],
        responses: { "200": goalResponse }
      }
    },
    "/v1/physical-goals/{id}/versions": {
      post: {
        tags: ["physical-goals"],
        summary: "Append an immutable draft version",
        parameters: [
          schemaParameter(
            "id",
            "path",
            true,
            PhysicalGoalIdParamsSchema.properties.id
          )
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: CreatePhysicalGoalVersionSchema
            }
          }
        },
        responses: { "200": goalResponse, "201": goalResponse }
      }
    },
    "/v1/physical-goals/{id}/versions/{version}/activate": {
      post: {
        tags: ["physical-goals"],
        summary: "Activate one immutable version",
        parameters: [
          schemaParameter(
            "id",
            "path",
            true,
            PhysicalGoalVersionParamsSchema.properties.id
          ),
          schemaParameter(
            "version",
            "path",
            true,
            PhysicalGoalVersionParamsSchema.properties.version
          )
        ],
        requestBody: transitionBody,
        responses: { "200": goalResponse }
      }
    },
    "/v1/physical-goals/{id}/complete": {
      post: {
        tags: ["physical-goals"],
        summary: "Complete an active goal",
        parameters: [
          schemaParameter(
            "id",
            "path",
            true,
            PhysicalGoalIdParamsSchema.properties.id
          )
        ],
        requestBody: transitionBody,
        responses: { "200": goalResponse }
      }
    },
    "/v1/physical-goals/{id}/cancel": {
      post: {
        tags: ["physical-goals"],
        summary: "Cancel a draft or active goal",
        parameters: [
          schemaParameter(
            "id",
            "path",
            true,
            PhysicalGoalIdParamsSchema.properties.id
          )
        ],
        requestBody: transitionBody,
        responses: { "200": goalResponse }
      }
    },
    "/v1/physical-goals/{id}/history": {
      get: {
        tags: ["physical-goals"],
        summary: "Read every immutable goal version",
        parameters: [
          schemaParameter(
            "id",
            "path",
            true,
            PhysicalGoalIdParamsSchema.properties.id
          )
        ],
        responses: {
          "200": {
            description: "Goal and immutable versions",
            content: {
              "application/json": { schema: PhysicalGoalHistorySchema }
            }
          }
        }
      }
    }
  };
}

function nutritionCatalogPaths(): Record<string, object> {
  const idParameter = schemaParameter(
    "id",
    "path",
    true,
    CatalogIdParamsSchema.properties.id
  );
  const operation = (
    summary: string,
    requestSchema: object,
    responseSchema: object
  ) => ({
    tags: ["nutrition-catalog"],
    summary,
    requestBody: {
      required: true,
      content: { "application/json": { schema: requestSchema } }
    },
    responses: {
      "200": {
        description: "Catalog entry updated",
        content: { "application/json": { schema: responseSchema } }
      },
      "201": {
        description: "Catalog entry created",
        content: { "application/json": { schema: responseSchema } }
      }
    }
  });
  const read = (summary: string, responseSchema: object) => ({
    tags: ["nutrition-catalog"],
    summary,
    parameters: [idParameter],
    responses: {
      "200": {
        description: "Accessible catalog entry",
        content: { "application/json": { schema: responseSchema } }
      },
      "404": {
        description: "Catalog entry is absent or inaccessible",
        content: { "application/json": { schema: ErrorResponseSchema } }
      }
    }
  });
  return {
    "/v1/nutrition/catalog/brands": {
      post: operation("Create Brand", CreateBrandSchema, BrandSchema)
    },
    "/v1/nutrition/catalog/brands/{id}": {
      get: read("Read Brand", BrandSchema)
    },
    "/v1/nutrition/catalog/brands/{id}/versions": {
      post: {
        ...operation(
          "Append immutable Brand version",
          CreateBrandVersionSchema,
          BrandSchema
        ),
        parameters: [idParameter]
      }
    },
    "/v1/nutrition/catalog/ingredients": {
      post: operation(
        "Create Ingredient",
        CreateIngredientSchema,
        IngredientSchema
      )
    },
    "/v1/nutrition/catalog/ingredients/{id}": {
      get: read("Read Ingredient", IngredientSchema)
    },
    "/v1/nutrition/catalog/ingredients/{id}/versions": {
      post: {
        ...operation(
          "Append immutable Ingredient version",
          CreateIngredientVersionSchema,
          IngredientSchema
        ),
        parameters: [idParameter]
      }
    },
    "/v1/nutrition/catalog/foods": {
      post: operation("Create Food", CreateFoodSchema, FoodSchema)
    },
    "/v1/nutrition/catalog/foods/{id}": {
      get: read("Read Food", FoodSchema)
    },
    "/v1/nutrition/catalog/foods/{id}/versions": {
      post: {
        ...operation(
          "Append immutable Food version",
          CreateFoodVersionSchema,
          FoodSchema
        ),
        parameters: [idParameter]
      }
    },
    "/v1/nutrition/catalog/foods/{id}/overlay": {
      put: {
        ...operation(
          "Replace Person-owned Food preferences",
          UpsertFoodOverlaySchema,
          FoodOverlaySchema
        ),
        parameters: [idParameter]
      }
    }
  };
}

function mealPaths(): Record<string, object> {
  const mealIdParameter = schemaParameter(
    "id",
    "path",
    true,
    MealIdParamsSchema.properties.id
  );
  return {
    "/v1/nutrition/meals": {
      post: {
        tags: ["nutrition-meals"],
        summary: "Create an immutable Meal snapshot",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: CreateMealSchema }
          }
        },
        responses: {
          "200": {
            description: "Existing Meal for the dedupe key",
            content: { "application/json": { schema: MealSchema } }
          },
          "201": {
            description: "Meal created",
            content: { "application/json": { schema: MealSchema } }
          }
        }
      },
      get: {
        tags: ["nutrition-meals"],
        summary: "List current Meal snapshots",
        parameters: [
          schemaParameter(
            "limit",
            "query",
            false,
            ListMealsQuerySchema.properties.limit
          ),
          schemaParameter(
            "cursor",
            "query",
            false,
            ListMealsQuerySchema.properties.cursor
          ),
          schemaParameter(
            "localDate",
            "query",
            false,
            ListMealsQuerySchema.properties.localDate
          )
        ],
        responses: {
          "200": {
            description: "Current Meal page",
            content: { "application/json": { schema: MealListSchema } }
          }
        }
      }
    },
    "/v1/nutrition/meals/{id}": {
      get: {
        tags: ["nutrition-meals"],
        summary: "Read one Meal snapshot",
        parameters: [mealIdParameter],
        responses: {
          "200": {
            description: "Meal found",
            content: { "application/json": { schema: MealSchema } }
          },
          "404": {
            description: "Meal not found",
            content: { "application/json": { schema: ErrorResponseSchema } }
          }
        }
      }
    },
    "/v1/nutrition/meals/{id}/corrections": {
      post: {
        tags: ["nutrition-meals"],
        summary: "Append a full Meal correction",
        parameters: [mealIdParameter],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: CorrectMealSchema }
          }
        },
        responses: {
          "200": {
            description: "Existing idempotent correction",
            content: { "application/json": { schema: MealSchema } }
          },
          "201": {
            description: "Correction appended",
            content: { "application/json": { schema: MealSchema } }
          }
        }
      }
    },
    "/v1/nutrition/meals/{id}/history": {
      get: {
        tags: ["nutrition-meals"],
        summary: "Read the complete Meal correction chain",
        parameters: [mealIdParameter],
        responses: {
          "200": {
            description: "Original-to-current Meal chain",
            content: {
              "application/json": { schema: MealHistorySchema }
            }
          }
        }
      }
    },
    "/v1/nutrition/daily-totals": {
      get: {
        tags: ["nutrition-meals"],
        summary: "Calculate current daily nutrition totals",
        parameters: [
          schemaParameter(
            "localDate",
            "query",
            true,
            DailyNutritionTotalsQuerySchema.properties.localDate
          )
        ],
        responses: {
          "200": {
            description: "Daily totals",
            content: {
              "application/json": {
                schema: DailyNutritionTotalsSchema
              }
            }
          }
        }
      }
    }
  };
}

function trainingPaths(): Record<string, object> {
  const idParameter = schemaParameter(
    "id",
    "path",
    true,
    TrainingIdParamsSchema.properties.id
  );
  const versionIdParameter = schemaParameter(
    "versionId",
    "path",
    true,
    TrainingVersionParamsSchema.properties.versionId
  );
  const response = (schema: object, description: string): object => ({
    description,
    content: { "application/json": { schema } }
  });
  const request = (schema: object): object => ({
    required: true,
    content: { "application/json": { schema } }
  });

  return {
    "/v1/training/catalog/exercises": {
      post: {
        tags: ["training-catalog"],
        summary: "Create an Exercise and its first immutable revision",
        requestBody: request(CreateExerciseSchema),
        responses: {
          "201": response(ExerciseSchema, "Exercise created"),
          "400": response(ErrorResponseSchema, "Invalid request")
        }
      }
    },
    "/v1/training/catalog/exercises/{id}": {
      get: {
        tags: ["training-catalog"],
        summary: "Read an accessible Exercise",
        parameters: [idParameter],
        responses: {
          "200": response(ExerciseSchema, "Exercise found"),
          "404": response(ErrorResponseSchema, "Exercise not found")
        }
      }
    },
    "/v1/training/catalog/exercises/{id}/versions": {
      post: {
        tags: ["training-catalog"],
        summary: "Append and select an immutable Exercise revision",
        parameters: [idParameter],
        requestBody: request(CreateExerciseVersionSchema),
        responses: {
          "200": response(ExerciseSchema, "Exercise revision appended"),
          "409": response(ErrorResponseSchema, "Optimistic-lock conflict")
        }
      }
    },
    "/v1/training/catalog/exercises/{id}/overlay": {
      put: {
        tags: ["training-catalog"],
        summary: "Replace a Person-owned Exercise overlay",
        parameters: [idParameter],
        requestBody: request(UpsertExerciseOverlaySchema),
        responses: {
          "200": response(ExerciseOverlaySchema, "Overlay replaced")
        }
      }
    },
    "/v1/training/programs": {
      post: {
        tags: ["training-programs"],
        summary: "Create a program with its first inactive version",
        requestBody: request(CreateTrainingProgramSchema),
        responses: {
          "201": response(TrainingProgramSchema, "Program created")
        }
      }
    },
    "/v1/training/programs/active": {
      get: {
        tags: ["training-programs"],
        summary: "Read the single explicitly active program",
        responses: {
          "200": response(TrainingProgramSchema, "Active program"),
          "404": response(ErrorResponseSchema, "No active program")
        }
      }
    },
    "/v1/training/programs/{id}": {
      get: {
        tags: ["training-programs"],
        summary: "Read one Person-owned program",
        parameters: [idParameter],
        responses: {
          "200": response(TrainingProgramSchema, "Program found")
        }
      }
    },
    "/v1/training/programs/{id}/versions": {
      post: {
        tags: ["training-programs"],
        summary: "Append one immutable inactive program version",
        parameters: [idParameter],
        requestBody: request(CreateTrainingProgramVersionSchema),
        responses: {
          "200": response(TrainingProgramSchema, "Program version appended")
        }
      }
    },
    "/v1/training/programs/{id}/versions/{versionId}/activate": {
      post: {
        tags: ["training-programs"],
        summary: "Explicitly activate one program version",
        parameters: [idParameter, versionIdParameter],
        requestBody: request(ActivateTrainingProgramVersionSchema),
        responses: {
          "200": response(TrainingProgramSchema, "Program version activated"),
          "409": response(ErrorResponseSchema, "Optimistic-lock conflict")
        }
      }
    },
    "/v1/training/programs/{id}/progression-candidates/accept": {
      post: {
        tags: ["training-progression"],
        summary: "Accept a still-valid suggestion as an inactive version",
        parameters: [idParameter],
        requestBody: request(AcceptProgressionCandidateSchema),
        responses: {
          "200": response(TrainingProgramSchema, "Draft version created"),
          "409": response(ErrorResponseSchema, "Candidate is stale")
        }
      }
    },
    "/v1/training/sessions": {
      post: {
        tags: ["training-sessions"],
        summary: "Create an immutable WorkoutSession",
        requestBody: request(CreateWorkoutSessionSchema),
        responses: {
          "200": response(WorkoutSessionSchema, "Existing idempotent session"),
          "201": response(WorkoutSessionSchema, "Session created")
        }
      },
      get: {
        tags: ["training-sessions"],
        summary: "List bounded current WorkoutSessions",
        parameters: [
          schemaParameter(
            "limit",
            "query",
            false,
            ListWorkoutSessionsQuerySchema.properties.limit
          ),
          schemaParameter(
            "localDate",
            "query",
            false,
            ListWorkoutSessionsQuerySchema.properties.localDate
          )
        ],
        responses: {
          "200": response(WorkoutSessionListSchema, "Current sessions")
        }
      }
    },
    "/v1/training/sessions/{id}": {
      get: {
        tags: ["training-sessions"],
        summary: "Read one immutable WorkoutSession",
        parameters: [idParameter],
        responses: {
          "200": response(WorkoutSessionSchema, "Session found")
        }
      }
    },
    "/v1/training/sessions/{id}/corrections": {
      post: {
        tags: ["training-sessions"],
        summary: "Append a full immutable session replacement",
        parameters: [idParameter],
        requestBody: request(CorrectWorkoutSessionSchema),
        responses: {
          "200": response(WorkoutSessionSchema, "Existing correction"),
          "201": response(WorkoutSessionSchema, "Correction appended"),
          "409": response(ErrorResponseSchema, "Session already superseded")
        }
      }
    },
    "/v1/training/sessions/{id}/history": {
      get: {
        tags: ["training-sessions"],
        summary: "Read a complete session correction chain",
        parameters: [idParameter],
        responses: {
          "200": response(WorkoutSessionHistorySchema, "Correction chain")
        }
      }
    },
    "/v1/training/personal-records": {
      get: {
        tags: ["training-projections"],
        summary: "Calculate current strength records",
        responses: {
          "200": response(PersonalRecordListSchema, "Current records")
        }
      }
    },
    "/v1/training/progression-candidates": {
      get: {
        tags: ["training-progression"],
        summary: "Calculate eligible progression suggestions",
        responses: {
          "200": response(
            ProgressionCandidateListSchema,
            "Current progression candidates"
          )
        }
      }
    }
  };
}

function recoveryPaths(): Record<string, object> {
  const idParameter = schemaParameter("id", "path", true, RecoveryIdParamsSchema.properties.id);
  const response = (schema: object, description: string): object => ({
    description,
    content: { "application/json": { schema } }
  });
  const request = (schema: object): object => ({
    required: true,
    content: { "application/json": { schema } }
  });
  return {
    "/v1/recovery/connections": {
      post: {
        tags: ["recovery-consent"],
        summary: "Create a Person-owned logical device connection",
        requestBody: request(CreateRecoveryConnectionSchema),
        responses: { "201": response(RecoveryConnectionSchema, "Connection created") }
      }
    },
    "/v1/recovery/connections/{id}/consents": {
      post: {
        tags: ["recovery-consent"],
        summary: "Grant explicit typed device-data consent",
        parameters: [idParameter],
        requestBody: request(GrantRecoveryConsentSchema),
        responses: { "201": response(RecoveryConsentSchema, "Consent granted") }
      }
    },
    "/v1/recovery/consents/{id}/revoke": {
      post: {
        tags: ["recovery-consent"],
        summary: "Revoke future device ingestion",
        parameters: [idParameter],
        requestBody: request(RevokeRecoveryConsentSchema),
        responses: { "200": response(RecoveryConsentSchema, "Consent revoked") }
      }
    },
    "/v1/recovery/observations": {
      post: {
        tags: ["recovery-observations"],
        summary: "Create an immutable typed Recovery observation",
        requestBody: request(CreateRecoveryObservationSchema),
        responses: {
          "200": response(RecoveryObservationSchema, "Existing idempotent observation"),
          "201": response(RecoveryObservationSchema, "Observation created")
        }
      },
      get: {
        tags: ["recovery-observations"],
        summary: "List current Recovery observations",
        parameters: [
          schemaParameter("limit", "query", false, ListRecoveryObservationsQuerySchema.properties.limit),
          schemaParameter("kind", "query", false, ListRecoveryObservationsQuerySchema.properties.kind),
          schemaParameter("localDate", "query", false, ListRecoveryObservationsQuerySchema.properties.localDate)
        ],
        responses: { "200": response(RecoveryObservationListSchema, "Current observations") }
      }
    },
    "/v1/recovery/observations/{id}": {
      get: {
        tags: ["recovery-observations"],
        summary: "Read one immutable Recovery observation",
        parameters: [idParameter],
        responses: { "200": response(RecoveryObservationSchema, "Observation found") }
      }
    },
    "/v1/recovery/observations/{id}/corrections": {
      post: {
        tags: ["recovery-observations"],
        summary: "Append a full immutable observation replacement",
        parameters: [idParameter],
        requestBody: request(CorrectRecoveryObservationSchema),
        responses: {
          "200": response(RecoveryObservationSchema, "Existing correction"),
          "201": response(RecoveryObservationSchema, "Correction appended")
        }
      }
    },
    "/v1/recovery/observations/{id}/history": {
      get: {
        tags: ["recovery-observations"],
        summary: "Read the observation correction chain",
        parameters: [idParameter],
        responses: { "200": response(RecoveryObservationHistorySchema, "Correction chain") }
      }
    },
    "/v1/recovery/assessments": {
      post: {
        tags: ["recovery-assessments"],
        summary: "Create a deterministic policy-pinned assessment",
        requestBody: request(CreateRecoveryAssessmentSchema),
        responses: {
          "200": response(RecoveryAssessmentSchema, "Existing idempotent assessment"),
          "201": response(RecoveryAssessmentSchema, "Assessment created")
        }
      },
      get: {
        tags: ["recovery-assessments"],
        summary: "List immutable Recovery assessments",
        parameters: [schemaParameter("limit", "query", false, ListRecoveryAssessmentsQuerySchema.properties.limit)],
        responses: { "200": response(RecoveryAssessmentListSchema, "Assessments") }
      }
    },
    "/v1/recovery/assessments/{id}": {
      get: {
        tags: ["recovery-assessments"],
        summary: "Read one immutable Recovery assessment",
        parameters: [idParameter],
        responses: { "200": response(RecoveryAssessmentSchema, "Assessment found") }
      }
    }
  };
}

function coachingPaths(): Record<string, object> {
  const idParameter = schemaParameter(
    "id",
    "path",
    true,
    CoachingRecommendationIdParamsSchema.properties.id
  );
  const response = (schema: object, description: string): object => ({
    description,
    content: { "application/json": { schema } }
  });
  const request = (schema: object): object => ({
    required: true,
    content: { "application/json": { schema } }
  });
  return {
    "/v1/coaching/recommendations/training-adjustments": {
      post: {
        tags: ["coaching-recommendations"],
        summary: "Evaluate one typed Training adjustment recommendation",
        requestBody: request(CreateTrainingAdjustmentRecommendationSchema),
        responses: {
          "200": response(CoachingRecommendationSchema, "Existing idempotent recommendation"),
          "201": response(CoachingRecommendationSchema, "Recommendation created")
        }
      }
    },
    "/v1/coaching/recommendations": {
      get: {
        tags: ["coaching-recommendations"],
        summary: "List recommendation projections",
        parameters: [
          schemaParameter("limit", "query", false, ListCoachingRecommendationsQuerySchema.properties.limit),
          schemaParameter("state", "query", false, ListCoachingRecommendationsQuerySchema.properties.state)
        ],
        responses: { "200": response(CoachingRecommendationListSchema, "Recommendations") }
      }
    },
    "/v1/coaching/recommendations/{id}": {
      get: {
        tags: ["coaching-recommendations"],
        summary: "Read one recommendation projection",
        parameters: [idParameter],
        responses: { "200": response(CoachingRecommendationSchema, "Recommendation found") }
      }
    },
    "/v1/coaching/recommendations/{id}/history": {
      get: {
        tags: ["coaching-recommendations"],
        summary: "Read immutable recommendation and decision history",
        parameters: [idParameter],
        responses: { "200": response(CoachingRecommendationHistorySchema, "Recommendation history") }
      }
    },
    "/v1/coaching/recommendations/{id}/decisions": {
      post: {
        tags: ["coaching-decisions"],
        summary: "Record one explicit terminal recommendation decision",
        parameters: [idParameter],
        requestBody: request(CreateCoachingRecommendationDecisionSchema),
        responses: {
          "200": response(CoachingRecommendationSchema, "Existing idempotent decision"),
          "201": response(CoachingRecommendationSchema, "Decision recorded"),
          "409": response(ErrorResponseSchema, "Decision conflicts or recommendation expired")
        }
      }
    }
  };
}

function dayClosurePaths(): Record<string, object> {
  return {
    "/v1/day-projections": {
      get: {
        tags: ["day-closures"],
        summary: "Read a live or closed Person-local daily projection",
        parameters: [
          schemaParameter("localDate", "query", true, DailyProjectionQuerySchema.properties.localDate),
          schemaParameter("timezone", "query", true, DailyProjectionQuerySchema.properties.timezone)
        ],
        responses: {
          "200": { description: "Daily projection", content: { "application/json": { schema: DailyProjectionSchema } } },
          "400": { description: "Invalid date or timezone", content: { "application/json": { schema: ErrorResponseSchema } } },
          "409": { description: "Closed day was recorded in a different timezone", content: { "application/json": { schema: ErrorResponseSchema } } }
        }
      }
    },
    "/v1/day-closures": {
      post: {
        tags: ["day-closures"],
        summary: "Close an open day with an immutable snapshot",
        requestBody: { required: true, content: { "application/json": { schema: CloseDaySchema } } },
        responses: {
          "200": { description: "Existing idempotent closure", content: { "application/json": { schema: DayClosureSchema } } },
          "201": { description: "Closure created", content: { "application/json": { schema: DayClosureSchema } } },
          "400": { description: "Invalid request", content: { "application/json": { schema: ErrorResponseSchema } } },
          "409": { description: "Already closed or source state changed", content: { "application/json": { schema: ErrorResponseSchema } } }
        }
      }
    },
    "/v1/day-closures/{localDate}/reopen": {
      post: {
        tags: ["day-closures"],
        summary: "Reopen a day without mutating its prior closure",
        parameters: [schemaParameter("localDate", "path", true, { type: "string", format: "date" })],
        requestBody: { required: true, content: { "application/json": { schema: ReopenDaySchema } } },
        responses: {
          "200": { description: "Closure superseded", content: { "application/json": { schema: DayClosureSchema } } },
          "400": { description: "Invalid request", content: { "application/json": { schema: ErrorResponseSchema } } },
          "409": { description: "No active closure", content: { "application/json": { schema: ErrorResponseSchema } } }
        }
      }
    },
    "/v1/day-closures/history": {
      get: {
        tags: ["day-closures"],
        summary: "List closure versions for a Person-local date",
        parameters: [
          schemaParameter("localDate", "query", true, DailyProjectionQuerySchema.properties.localDate),
          schemaParameter("timezone", "query", true, DailyProjectionQuerySchema.properties.timezone)
        ],
        responses: {
          "200": { description: "Append-only closure history", content: { "application/json": { schema: DayClosureHistorySchema } } },
          "400": { description: "Invalid date or timezone", content: { "application/json": { schema: ErrorResponseSchema } } },
          "409": { description: "Closure history was recorded in a different timezone", content: { "application/json": { schema: ErrorResponseSchema } } }
        }
      }
    }
  };
}

function progressOverviewPaths(): Record<string, object> {
  return {
    "/v1/progress-overview": {
      get: {
        tags: ["progress-overview"],
        summary: "Read a bounded sparse progress overview",
        parameters: [
          schemaParameter("from", "query", true, ProgressOverviewQuerySchema.properties.from),
          schemaParameter("to", "query", true, ProgressOverviewQuerySchema.properties.to),
          schemaParameter("timezone", "query", true, ProgressOverviewQuerySchema.properties.timezone)
        ],
        responses: {
          "200": { description: "Progress overview", content: { "application/json": { schema: ProgressOverviewSchema } } },
          "400": { description: "Invalid or unbounded range", content: { "application/json": { schema: ErrorResponseSchema } } }
        }
      }
    }
  };
}

function intakePaths(): Record<string, object> {
  const response = (schema: object, description: string): object => ({
    description,
    content: { "application/json": { schema } }
  });
  const request = (schema: object): object => ({
    required: true,
    content: { "application/json": { schema } }
  });
  const requestId = schemaParameter(
    "id",
    "path",
    true,
    IntakeRequestIdParamsSchema.properties.id
  );
  const itemId = schemaParameter(
    "itemId",
    "path",
    true,
    IntakeItemParamsSchema.properties.itemId
  );
  return {
    "/v1/intake/requests": {
      post: {
        tags: ["intake"],
        summary: "Durably accept one natural-language message",
        requestBody: request(CreateIntakeRequestSchema),
        responses: {
          "202": response(IntakeRequestSchema, "Message queued for parsing")
        }
      }
    },
    "/v1/intake/requests/{id}": {
      get: {
        tags: ["intake"],
        summary: "Read current Intake progress",
        parameters: [requestId],
        responses: {
          "200": response(IntakeRequestSchema, "Current Intake projection"),
          "404": response(ErrorResponseSchema, "Request not found")
        }
      }
    },
    "/v1/intake/requests/{id}/items/{itemId}/clarification": {
      post: {
        tags: ["intake"],
        summary: "Submit one clarification answer",
        parameters: [requestId, itemId],
        requestBody: request(ClarifyIntakeItemSchema),
        responses: {
          "202": response(IntakeRequestSchema, "Clarification queued"),
          "409": response(ErrorResponseSchema, "Item state conflicts")
        }
      }
    },
    "/v1/intake/requests/{id}/items/{itemId}/decision": {
      post: {
        tags: ["intake"],
        summary: "Confirm or reject one parsed item",
        parameters: [requestId, itemId],
        requestBody: request(DecideIntakeItemSchema),
        responses: {
          "202": response(IntakeRequestSchema, "Decision accepted"),
          "409": response(ErrorResponseSchema, "Item state conflicts")
        }
      }
    }
  };
}

/**
 * Builds the public OpenAPI document from the shared runtime schemas.
 *
 * @returns OpenAPI 3.1 document for the current API surface.
 */
export function createOpenApiDocument(): object {
  return {
    openapi: "3.1.0",
    info: {
      title: "Shape of You API",
      description: "Initial modular backend API",
      version: "0.1.0"
    },
    paths: {
      "/health": {
        get: {
          tags: ["system"],
          summary: "Process liveness",
          responses: {
            "200": {
              description: "Process is alive",
              content: {
                "application/json": { schema: HealthResponseSchema }
              }
            }
          }
        }
      },
      "/ready": {
        get: {
          tags: ["system"],
          summary: "PostgreSQL readiness",
          responses: {
            "200": {
              description: "Dependencies are ready",
              content: {
                "application/json": { schema: ReadinessResponseSchema }
              }
            },
            "503": {
              description: "A required dependency is unavailable",
              content: {
                "application/json": { schema: ReadinessResponseSchema }
              }
            }
          }
        }
      },
      "/v1/weight-measurements": {
        post: {
          tags: ["weight-measurements"],
          summary: "Create an immutable weight measurement",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: CreateWeightMeasurementSchema }
            }
          },
          responses: {
            "200": {
              description: "Existing measurement for the dedupe key",
              content: {
                "application/json": { schema: WeightMeasurementSchema }
              }
            },
            "201": {
              description: "Measurement created",
              content: {
                "application/json": { schema: WeightMeasurementSchema }
              }
            },
            "400": {
              description: "Invalid request",
              content: {
                "application/json": { schema: ErrorResponseSchema }
              }
            }
          }
        },
        get: {
          tags: ["weight-measurements"],
          summary: "List weight measurements in stable descending order",
          parameters: [
            schemaParameter(
              "limit",
              "query",
              false,
              ListWeightMeasurementsQuerySchema.properties.limit
            ),
            schemaParameter(
              "cursor",
              "query",
              false,
              ListWeightMeasurementsQuerySchema.properties.cursor
            )
          ],
          responses: {
            "200": {
              description: "One stable page",
              content: {
                "application/json": { schema: WeightMeasurementListSchema }
              }
            },
            "400": {
              description: "Invalid request",
              content: {
                "application/json": { schema: ErrorResponseSchema }
              }
            }
          }
        }
      },
      "/v1/weight-measurements/{id}": {
        get: {
          tags: ["weight-measurements"],
          summary: "Read a weight measurement by id",
          parameters: [
            schemaParameter(
              "id",
              "path",
              true,
              WeightMeasurementIdParamsSchema.properties.id
            )
          ],
          responses: {
            "200": {
              description: "Measurement found",
              content: {
                "application/json": { schema: WeightMeasurementSchema }
              }
            },
            "400": {
              description: "Invalid identifier",
              content: {
                "application/json": { schema: ErrorResponseSchema }
              }
            },
            "404": {
              description: "Measurement not found",
              content: {
                "application/json": { schema: ErrorResponseSchema }
              }
            }
          }
        }
      },
      "/v1/weight-measurements/{id}/corrections": {
        post: {
          tags: ["weight-measurements"],
          summary: "Append an immutable correction",
          parameters: [
            schemaParameter(
              "id",
              "path",
              true,
              WeightMeasurementIdParamsSchema.properties.id
            )
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: CorrectWeightMeasurementSchema
              }
            }
          },
          responses: {
            "200": {
              description: "Existing idempotent correction",
              content: {
                "application/json": { schema: WeightMeasurementSchema }
              }
            },
            "201": {
              description: "Correction appended",
              content: {
                "application/json": { schema: WeightMeasurementSchema }
              }
            },
            "404": {
              description: "Measurement not found",
              content: {
                "application/json": { schema: ErrorResponseSchema }
              }
            },
            "409": {
              description: "Measurement was already superseded",
              content: {
                "application/json": { schema: ErrorResponseSchema }
              }
            }
          }
        }
      },
      "/v1/weight-measurements/{id}/history": {
        get: {
          tags: ["weight-measurements"],
          summary: "Read the complete correction chain",
          parameters: [
            schemaParameter(
              "id",
              "path",
              true,
              WeightMeasurementIdParamsSchema.properties.id
            )
          ],
          responses: {
            "200": {
              description: "Original-to-current correction chain",
              content: {
                "application/json": {
                  schema: WeightMeasurementHistorySchema
                }
              }
            },
            "404": {
              description: "Measurement not found",
              content: {
                "application/json": { schema: ErrorResponseSchema }
              }
            }
          }
        }
      },
      ...bodyMeasurementPaths(),
      ...physicalGoalPaths(),
      ...nutritionCatalogPaths(),
      ...mealPaths(),
      ...trainingPaths(),
      ...recoveryPaths(),
      ...coachingPaths(),
      ...dayClosurePaths(),
      ...progressOverviewPaths(),
      ...intakePaths()
    }
  };
}
