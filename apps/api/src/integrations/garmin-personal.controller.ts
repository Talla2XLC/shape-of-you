import { Body, Controller, Get, Header, HttpCode, Inject, Post, UseInterceptors } from "@nestjs/common";
import {
  CheckGarminPersonalKeySchema, ConnectGarminPersonalSchema, DisconnectIntegrationSchema,
  GarminPersonalConnectionSchema, GarminPersonalKeyCheckSchema,
  type CheckGarminPersonalKey, type ConnectGarminPersonal, type DisconnectIntegration
} from "@shape-of-you/contracts";
import { JsonSchemaPipe, JsonSchemaResponseInterceptor } from "../http/json-schema.js";
import { GarminPersonalService } from "./garmin-personal.service.js";

/** Authenticated personal-key linking; request secrets never enter URLs or responses. */
@Controller("v1/integrations/garmin-personal")
export class GarminPersonalController {
  public constructor(@Inject(GarminPersonalService) private readonly service: GarminPersonalService) {}

  /** Reads the authenticated Person's safe projection. */
  @Get()
  @Header("cache-control", "no-store")
  @UseInterceptors(new JsonSchemaResponseInterceptor(GarminPersonalConnectionSchema))
  public status() { return this.service.status(); }

  /** Verifies access without activating imports. */
  @HttpCode(200)
  @Post("check")
  @Header("cache-control", "no-store")
  @UseInterceptors(new JsonSchemaResponseInterceptor(GarminPersonalKeyCheckSchema))
  public check(@Body(new JsonSchemaPipe<CheckGarminPersonalKey>(CheckGarminPersonalKeySchema)) input: CheckGarminPersonalKey) {
    return this.service.check(input.apiKey);
  }

  /** Activates an explicitly consented key, including accounts without records. */
  @HttpCode(200)
  @Post("connect")
  @Header("cache-control", "no-store")
  @UseInterceptors(new JsonSchemaResponseInterceptor(GarminPersonalConnectionSchema))
  public connect(@Body(new JsonSchemaPipe<ConnectGarminPersonal>(ConnectGarminPersonalSchema)) input: ConnectGarminPersonal) {
    return this.service.connect(input);
  }

  /** Disconnect retains imported history and clears credentials locally. */
  @HttpCode(200)
  @Post("disconnect")
  @Header("cache-control", "no-store")
  @UseInterceptors(new JsonSchemaResponseInterceptor(GarminPersonalConnectionSchema))
  public disconnect(@Body(new JsonSchemaPipe<DisconnectIntegration>(DisconnectIntegrationSchema)) input: DisconnectIntegration) {
    return this.service.disconnect(input.reason);
  }

  /** Requests historical import separately from initial linking. */
  @HttpCode(200)
  @Post("historical-import")
  @Header("cache-control", "no-store")
  @UseInterceptors(new JsonSchemaResponseInterceptor(GarminPersonalConnectionSchema))
  public history() { return this.service.startHistoricalImport(); }
}
