import { AsyncLocalStorage } from "node:async_hooks";

/** Resolves the Person whose data is authorized for the current operation. */
export interface PersonContext {
  /**
   * Returns the authorized Person identity.
   *
   * Future authenticated adapters must verify a PersonAccessGrant before
   * returning an identifier.
   *
   * @returns Authorized Person UUID.
   */
  getPersonId(): string;
}

/**
 * Resolves the active Person from the current asynchronous operation.
 *
 * HTTP controllers may use the optional synthetic fallback in local/staging
 * compatibility mode. MCP handlers establish a real authorization context for
 * the lifetime of each verified tool invocation.
 */
export class RequestPersonContext implements PersonContext {
  private readonly storage = new AsyncLocalStorage<string>();

  public constructor(private readonly syntheticPersonId?: string) {}

  /** Runs one asynchronous operation as an explicitly authorized Person. */
  public run<T>(personId: string, operation: () => T): T {
    return this.storage.run(personId, operation);
  }

  /** {@inheritDoc PersonContext.getPersonId} */
  public getPersonId(): string {
    const personId = this.storage.getStore() ?? this.syntheticPersonId;
    if (!personId) {
      throw new Error("Authenticated Person context is required");
    }
    return personId;
  }
}

/**
 * Explicit synthetic-only Person context for tests and pre-real-data staging.
 */
export class SyntheticPersonContext implements PersonContext {
  public constructor(private readonly personId: string) {}

  /** {@inheritDoc PersonContext.getPersonId} */
  public getPersonId(): string {
    return this.personId;
  }
}
