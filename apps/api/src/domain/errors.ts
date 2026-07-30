/** Base error carrying the stable HTTP status and public application code. */
export class ApplicationError extends Error {
  public constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

/** Indicates that input violates a domain or cursor validation rule. */
export class DomainValidationError extends ApplicationError {
  public constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
    this.name = "DomainValidationError";
  }
}

/** Indicates that a requested domain resource does not exist. */
export class NotFoundError extends ApplicationError {
  public constructor(message: string) {
    super(message, 404, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

/** Indicates that a command conflicts with the current immutable fact graph. */
export class ConflictError extends ApplicationError {
  public constructor(message: string) {
    super(message, 409, "CONFLICT");
    this.name = "ConflictError";
  }
}
