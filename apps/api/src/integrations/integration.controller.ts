import { Body, Controller, Get, Inject, Post, UseInterceptors } from "@nestjs/common";
import type { FastifyInstance } from "fastify";
import {
  DisconnectIntegrationSchema,
  GarminIntervalsConnectionSchema,
  IntegrationAuthorizationStartSchema,
  StartGarminIntervalsAuthorizationSchema,
  type DisconnectIntegration,
  type GarminIntervalsConnection,
  type IntegrationAuthorizationStart,
  type StartGarminIntervalsAuthorization
} from "@shape-of-you/contracts";

import { JsonSchemaPipe, JsonSchemaResponseInterceptor } from "../http/json-schema.js";
import { IntegrationService } from "./integration.service.js";

/** Authenticated browser API for Garmin through Intervals.icu. */
@Controller("v1/integrations/garmin-intervals")
export class IntegrationController {
  public constructor(@Inject(IntegrationService) private readonly service: IntegrationService) {}

  @Get()
  @UseInterceptors(new JsonSchemaResponseInterceptor(GarminIntervalsConnectionSchema))
  public status(): Promise<GarminIntervalsConnection> { return this.service.status(); }

  @Post("authorization")
  @UseInterceptors(new JsonSchemaResponseInterceptor(IntegrationAuthorizationStartSchema))
  public start(@Body(new JsonSchemaPipe<StartGarminIntervalsAuthorization>(StartGarminIntervalsAuthorizationSchema)) input: StartGarminIntervalsAuthorization): Promise<IntegrationAuthorizationStart> {
    return this.service.start(input);
  }

  @Post("disconnect")
  @UseInterceptors(new JsonSchemaResponseInterceptor(GarminIntervalsConnectionSchema))
  public disconnect(@Body(new JsonSchemaPipe<DisconnectIntegration>(DisconnectIntegrationSchema)) input: DisconnectIntegration): Promise<GarminIntervalsConnection> {
    return this.service.disconnect(input);
  }
}

/** Registers the exact OAuth callback with request logging disabled for its code query. */
export function registerIntegrationCallback(fastify: FastifyInstance, service: IntegrationService): void {
  fastify.get("/integrations/intervals-icu/callback", { logLevel: "silent" }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const state = typeof query.state === "string" && query.state.length <= 256 ? query.state : null;
    const code = typeof query.code === "string" && query.code.length <= 4096 ? query.code : null;
    try {
      if (!state) throw new Error("Provider authorization state is missing");
      if (!code || typeof query.error === "string") {
        await service.denyAuthorization(state);
        throw new Error("Provider authorization was denied");
      }
      const returnTo = await service.completeAuthorization(state, code);
      reply.header("cache-control", "no-store");
      reply.header("referrer-policy", "no-referrer");
      reply.redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}provider=connected`);
    } catch {
      reply.header("cache-control", "no-store");
      reply.header("referrer-policy", "no-referrer");
      reply.redirect("/connections?provider=authorization_failed");
    }
  });
}
