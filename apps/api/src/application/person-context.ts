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
 * Explicit synthetic-only Person context for tests and pre-real-data staging.
 */
export class SyntheticPersonContext implements PersonContext {
  public constructor(private readonly personId: string) {}

  /** {@inheritDoc PersonContext.getPersonId} */
  public getPersonId(): string {
    return this.personId;
  }
}
