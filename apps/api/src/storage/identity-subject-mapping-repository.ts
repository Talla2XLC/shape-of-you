import { and, eq } from "drizzle-orm";

import type { DatabaseContext } from "../database/context.js";
import {
  identitySubjectMappings,
  personAccessGrants,
  persons,
  users
} from "../database/schema.js";

export type PersonAccessRole = "owner" | "editor" | "viewer" | "coach";

/** API-owned authorization target resolved from an external OAuth subject. */
export interface AuthorizedPerson {
  readonly personId: string;
  readonly roles: readonly PersonAccessRole[];
}

/** Persistence boundary for Identity subject bindings and active Person grants. */
export class IdentitySubjectMappingRepository {
  public constructor(private readonly database: DatabaseContext) {}

  /** Resolves all active grants for one active API User and active Person. */
  public async resolveAuthorizedPersons(
    issuer: string,
    subject: string
  ): Promise<readonly AuthorizedPerson[]> {
    const rows = await this.database.db
      .select({
        personId: personAccessGrants.personId,
        role: personAccessGrants.role
      })
      .from(identitySubjectMappings)
      .innerJoin(users, eq(users.id, identitySubjectMappings.userId))
      .innerJoin(
        personAccessGrants,
        eq(personAccessGrants.userId, identitySubjectMappings.userId)
      )
      .innerJoin(persons, eq(persons.id, personAccessGrants.personId))
      .where(
        and(
          eq(identitySubjectMappings.issuer, issuer),
          eq(identitySubjectMappings.subject, subject),
          eq(users.status, "active"),
          eq(personAccessGrants.status, "active"),
          eq(persons.status, "active")
        )
      );

    const grouped = new Map<string, PersonAccessRole[]>();
    for (const row of rows) {
      const roles = grouped.get(row.personId) ?? [];
      roles.push(row.role);
      grouped.set(row.personId, roles);
    }
    return [...grouped].map(([personId, roles]) => ({ personId, roles }));
  }

  /** Creates an idempotent exact `(issuer, subject) -> User` binding. */
  public async bind(
    issuer: string,
    subject: string,
    userId: string
  ): Promise<"created" | "existing"> {
    const inserted = await this.database.db
      .insert(identitySubjectMappings)
      .values({ issuer, subject, userId })
      .onConflictDoNothing({
        target: [identitySubjectMappings.issuer, identitySubjectMappings.subject]
      })
      .returning({ id: identitySubjectMappings.id });
    if (inserted.length === 1) {
      return "created";
    }

    const existing = await this.database.db
      .select({ userId: identitySubjectMappings.userId })
      .from(identitySubjectMappings)
      .where(
        and(
          eq(identitySubjectMappings.issuer, issuer),
          eq(identitySubjectMappings.subject, subject)
        )
      )
      .limit(1);
    if (existing[0]?.userId !== userId) {
      throw new Error("Identity subject is already bound to another API User");
    }
    return "existing";
  }
}
