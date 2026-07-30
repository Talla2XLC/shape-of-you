import {
  Controller,
  Get,
  Inject,
  Logger,
  Res,
  UseInterceptors
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

import {
  HealthResponseSchema,
  ReadinessResponseSchema,
  type HealthResponse,
  type ReadinessResponse
} from "@shape-of-you/contracts";

import { READINESS_PROBE } from "../application/tokens.js";
import { JsonSchemaResponseInterceptor } from "../http/json-schema.js";
import { createOpenApiDocument } from "../openapi.js";

/** Probe that resolves when required dependencies are ready for API traffic. */
export type ReadinessProbe = () => Promise<void>;

/** Serves process health, dependency readiness, and the public API document. */
@Controller()
export class SystemController {
  private readonly logger = new Logger(SystemController.name);

  public constructor(
    @Inject(READINESS_PROBE)
    private readonly readinessProbe: ReadinessProbe
  ) {}

  /** Returns process liveness independently of external dependencies. */
  @Get("health")
  @UseInterceptors(new JsonSchemaResponseInterceptor(HealthResponseSchema))
  public health(): HealthResponse {
    return { status: "ok" };
  }

  /** Returns PostgreSQL readiness and an HTTP 503 while it is unavailable. */
  @Get("ready")
  @UseInterceptors(new JsonSchemaResponseInterceptor(ReadinessResponseSchema))
  public async ready(
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ReadinessResponse> {
    try {
      await this.readinessProbe();
      return { status: "ready", database: "up" };
    } catch (error) {
      this.logger.warn(
        `Readiness probe failed: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
      void reply.code(503);
      return { status: "not_ready", database: "down" };
    }
  }

  /** Returns the OpenAPI document derived from shared runtime schemas. */
  @Get("openapi.json")
  public openApi(): object {
    return createOpenApiDocument();
  }
}
