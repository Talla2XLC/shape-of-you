import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  type PipeTransform
} from "@nestjs/common";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { map, type Observable } from "rxjs";

type JsonSchema = Readonly<Record<string, unknown>>;

function compileSchema(schema: JsonSchema): ValidateFunction {
  const ajv = new Ajv({
    allErrors: true,
    coerceTypes: true,
    multipleOfPrecision: 6,
    strict: false,
    useDefaults: true
  });
  const installFormats = addFormats as unknown as (
    instance: Ajv
  ) => Ajv;
  installFormats(ajv);
  return ajv.compile(schema);
}

/**
 * Validates and normalizes one Nest transport value with a shared JSON Schema.
 */
@Injectable()
export class JsonSchemaPipe<T> implements PipeTransform<unknown, T> {
  private readonly validate: ValidateFunction;

  public constructor(schema: JsonSchema) {
    this.validate = compileSchema(schema);
  }

  /**
   * Validates a request body, query, or parameter object.
   *
   * @param value - Parsed transport value supplied by Nest.
   * @returns The validated value, including safe schema coercions/defaults.
   * @throws BadRequestException when the value violates the contract.
   */
  public transform(value: unknown): T {
    if (!this.validate(value)) {
      throw new BadRequestException("Request validation failed");
    }
    return value as T;
  }
}

/**
 * Rejects successful handler output that violates its shared response schema.
 */
@Injectable()
export class JsonSchemaResponseInterceptor
  implements NestInterceptor<unknown, unknown>
{
  private readonly validate: ValidateFunction;

  public constructor(schema: JsonSchema) {
    this.validate = compileSchema(schema);
  }

  /**
   * Validates emitted handler values before the HTTP adapter serializes them.
   *
   * @param _context - Current Nest execution context.
   * @param next - Downstream request handler.
   * @returns An observable that validates each emitted response.
   * @throws Error when application output violates the response contract.
   */
  public intercept(
    _context: ExecutionContext,
    next: CallHandler
  ): Observable<unknown> {
    return next.handle().pipe(
      map((value: unknown) => {
        if (!this.validate(value)) {
          throw new Error("Response validation failed");
        }
        return value;
      })
    );
  }
}
