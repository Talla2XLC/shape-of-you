import { Controller, Get, Header, Inject, Query, UseInterceptors } from "@nestjs/common";
import {
  BodyCompositionObservationListSchema, ConnectedDailyFitnessSummaryListSchema,
  ConnectedNutritionDayQuerySchema, ConnectedNutritionDayResultSchema, ConnectedProviderDateQuerySchema,
  type ConnectedNutritionDayQuery, type ConnectedProviderDateQuery
} from "@shape-of-you/contracts";
import { JsonSchemaPipe, JsonSchemaResponseInterceptor } from "../http/json-schema.js";
import { ConnectedProviderDataService } from "./connected-provider-data.service.js";

/** Person-authenticated reads of typed source facts; requests never carry a Person identifier. */
@Controller("v1/connected-data")
export class ConnectedProviderDataController {
  public constructor(@Inject(ConnectedProviderDataService) private readonly service: ConnectedProviderDataService) {}

  /** Reads fitness day summaries without adding activity calories a second time. */
  @Get("fitness") @Header("cache-control", "no-store")
  @UseInterceptors(new JsonSchemaResponseInterceptor(ConnectedDailyFitnessSummaryListSchema))
  public fitness(@Query(new JsonSchemaPipe<ConnectedProviderDateQuery>(ConnectedProviderDateQuerySchema, true)) query: ConnectedProviderDateQuery) {
    return this.service.fitness(query);
  }

  /** Reads provider intake alongside, rather than added to, the Meal ledger. */
  @Get("nutrition") @Header("cache-control", "no-store")
  @UseInterceptors(new JsonSchemaResponseInterceptor(ConnectedNutritionDayResultSchema))
  public nutrition(@Query(new JsonSchemaPipe<ConnectedNutritionDayQuery>(ConnectedNutritionDayQuerySchema, true)) query: ConnectedNutritionDayQuery) {
    return this.service.nutrition(query.localDate);
  }

  /** Lists measured body composition; imported zero and unavailable data remain distinct. */
  @Get("body-composition") @Header("cache-control", "no-store")
  @UseInterceptors(new JsonSchemaResponseInterceptor(BodyCompositionObservationListSchema))
  public bodyComposition(@Query(new JsonSchemaPipe<ConnectedProviderDateQuery>(ConnectedProviderDateQuerySchema, true)) query: ConnectedProviderDateQuery) {
    return this.service.bodyComposition(query);
  }
}
