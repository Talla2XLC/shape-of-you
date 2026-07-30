import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  HttpException,
  Logger,
  type ExceptionFilter
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

import type { ErrorResponse } from "@shape-of-you/contracts";

import { ApplicationError } from "../domain/errors.js";

function errorResponse(
  statusCode: number,
  error: string,
  message: string
): ErrorResponse {
  return { statusCode, error, message };
}

/** Maps Nest, domain, and unknown failures to the stable public error shape. */
@Catch()
export class ApplicationExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApplicationExceptionFilter.name);

  /**
   * Writes the stable error response for one failed HTTP request.
   *
   * @param exception - Thrown application or framework failure.
   * @param host - Nest arguments host containing the Fastify reply.
   */
  public catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (exception instanceof ApplicationError) {
      void reply
        .code(exception.statusCode)
        .send(
          errorResponse(
            exception.statusCode,
            exception.code,
            exception.message
          )
        );
      return;
    }

    if (exception instanceof BadRequestException) {
      void reply
        .code(400)
        .send(
          errorResponse(400, "VALIDATION_ERROR", "Request validation failed")
        );
      return;
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const code = statusCode === 404 ? "NOT_FOUND" : "HTTP_ERROR";
      void reply
        .code(statusCode)
        .send(errorResponse(statusCode, code, exception.message));
      return;
    }

    this.logger.error(
      "Unhandled request error",
      exception instanceof Error ? exception.stack : undefined
    );
    void reply
      .code(500)
      .send(
        errorResponse(500, "INTERNAL_SERVER_ERROR", "Internal server error")
      );
  }
}
