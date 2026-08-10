import type { Pool } from "pg";

/** Public Identity account reference used for API subject provisioning. */
export interface IdentityAccountSubject {
  readonly accountId: string;
  readonly subject: string;
}

/** Stable failure raised when an exact Identity account does not exist. */
export class IdentityAccountSubjectNotFoundError extends Error {
  public constructor() {
    super("Identity account was not found");
    this.name = "IdentityAccountSubjectNotFoundError";
  }
}

/** Reads public account subjects from the Identity-owned database. */
export class IdentityAccountSubjectStore {
  public constructor(private readonly pool: Pool) {}

  /**
   * Resolves one exact account id to its immutable public subject.
   *
   * @param accountId Exact Identity-owned account UUID.
   * @returns The account id and its public OAuth subject.
   * @throws {IdentityAccountSubjectNotFoundError} When the account is unknown.
   */
  public async findExact(accountId: string): Promise<IdentityAccountSubject> {
    const result = await this.pool.query<{ id: string; subject: string }>(
      `select id, subject
         from identity_accounts
        where id = $1
        limit 1`,
      [accountId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new IdentityAccountSubjectNotFoundError();
    }
    return { accountId: row.id, subject: row.subject };
  }
}
