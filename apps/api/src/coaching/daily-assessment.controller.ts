import { Body, Controller, Get, Inject, Put, UseInterceptors } from "@nestjs/common";

import { DailyAssessmentResultSchema, PersonPreferencesSchema, UpdatePersonPreferencesSchema, type DailyAssessmentResult, type PersonPreferences, type UpdatePersonPreferences } from "@shape-of-you/contracts";

import { JsonSchemaPipe, JsonSchemaResponseInterceptor } from "../http/json-schema.js";
import { DailyAssessmentService } from "./daily-assessment.service.js";

/** Authenticated Person preferences and API-owned daily assessment transport. */
@Controller("v1/daily-assessment")
export class DailyAssessmentController {
  public constructor(@Inject(DailyAssessmentService) private readonly service: DailyAssessmentService) {}

  @Get()
  @UseInterceptors(new JsonSchemaResponseInterceptor(DailyAssessmentResultSchema))
  public read(): Promise<DailyAssessmentResult> { return this.service.read(); }

  @Get("preferences")
  @UseInterceptors(new JsonSchemaResponseInterceptor(PersonPreferencesSchema))
  public preferences(): Promise<PersonPreferences> { return this.service.preferences(); }

  @Put("preferences")
  @UseInterceptors(new JsonSchemaResponseInterceptor(PersonPreferencesSchema))
  public updatePreferences(@Body(new JsonSchemaPipe<UpdatePersonPreferences>(UpdatePersonPreferencesSchema)) input: UpdatePersonPreferences): Promise<PersonPreferences> {
    return this.service.updatePreferences(input);
  }
}

