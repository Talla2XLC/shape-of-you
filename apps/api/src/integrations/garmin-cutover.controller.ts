import { Body, Controller, Get, Header, HttpCode, Inject, Post, UseInterceptors } from "@nestjs/common";
import {
  CancelGarminCutoverSchema, GarminCutoverPreviewSchema, GarminCutoverStatusSchema,
  PreviewGarminCutoverSchema, RetryGarminCutoverSchema, ScheduleGarminCutoverSchema,
  type CancelGarminCutover, type PreviewGarminCutover, type RetryGarminCutover, type ScheduleGarminCutover
} from "@shape-of-you/contracts";
import { JsonSchemaPipe, JsonSchemaResponseInterceptor } from "../http/json-schema.js";
import { GarminCutoverService } from "./garmin-cutover.service.js";

/** Person-authenticated, CSRF-protected future cutover commands; never receives a Person ID from input. */
@Controller("v1/integrations/garmin-personal/cutover")
export class GarminCutoverController {
  public constructor(@Inject(GarminCutoverService) private readonly service: GarminCutoverService) {}

  /** Reads safe local state, without performing a provider refresh. */
  @Get()
  @Header("cache-control", "no-store")
  @UseInterceptors(new JsonSchemaResponseInterceptor(GarminCutoverStatusSchema))
  public status() { return this.service.status(); }

  /** Computes a safe future boundary before the key enters the normal site form. */
  @Post("preview") @HttpCode(200)
  @Header("cache-control", "no-store")
  @UseInterceptors(new JsonSchemaResponseInterceptor(GarminCutoverPreviewSchema))
  public preview(@Body(new JsonSchemaPipe<PreviewGarminCutover>(PreviewGarminCutoverSchema)) input: PreviewGarminCutover) {
    return this.service.preview(input);
  }

  /** Verifies and encrypts one explicitly consented pending key. */
  @Post("schedule") @HttpCode(200)
  @Header("cache-control", "no-store")
  @UseInterceptors(new JsonSchemaResponseInterceptor(GarminCutoverStatusSchema))
  public schedule(@Body(new JsonSchemaPipe<ScheduleGarminCutover>(ScheduleGarminCutoverSchema)) input: ScheduleGarminCutover) {
    return this.service.schedule(input);
  }

  /** Reuses the backend-owned encrypted key unless access is being replaced. */
  @Post("retry") @HttpCode(200)
  @Header("cache-control", "no-store")
  @UseInterceptors(new JsonSchemaResponseInterceptor(GarminCutoverStatusSchema))
  public retry(@Body(new JsonSchemaPipe<RetryGarminCutover>(RetryGarminCutoverSchema)) input: RetryGarminCutover) {
    return this.service.retry(input);
  }

  /** Cancels a version-fenced plan without enabling a previous writer. */
  @Post("cancel") @HttpCode(200)
  @Header("cache-control", "no-store")
  @UseInterceptors(new JsonSchemaResponseInterceptor(GarminCutoverStatusSchema))
  public cancel(@Body(new JsonSchemaPipe<CancelGarminCutover>(CancelGarminCutoverSchema)) input: CancelGarminCutover) {
    return this.service.cancel(input);
  }
}
