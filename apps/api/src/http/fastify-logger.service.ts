import type { LoggerService } from "@nestjs/common";
import type { FastifyBaseLogger } from "fastify";

/** Adapts the Fastify Pino logger to the Nest logger contract. */
export class FastifyLoggerService implements LoggerService {
  public constructor(private readonly logger: FastifyBaseLogger) {}

  /** {@inheritDoc LoggerService.log} */
  public log(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.info(
      { message, optionalParams },
      "Nest application log"
    );
  }

  /** {@inheritDoc LoggerService.error} */
  public error(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error(
      { message, optionalParams },
      "Nest application error"
    );
  }

  /** {@inheritDoc LoggerService.warn} */
  public warn(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.warn(
      { message, optionalParams },
      "Nest application warning"
    );
  }

  /** {@inheritDoc LoggerService.debug} */
  public debug(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.debug(
      { message, optionalParams },
      "Nest application debug"
    );
  }

  /** {@inheritDoc LoggerService.verbose} */
  public verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.trace(
      { message, optionalParams },
      "Nest application trace"
    );
  }

  /** {@inheritDoc LoggerService.fatal} */
  public fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.fatal(
      { message, optionalParams },
      "Nest application fatal error"
    );
  }
}
