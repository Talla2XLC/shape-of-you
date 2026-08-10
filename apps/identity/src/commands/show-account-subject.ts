import { parseArgs } from "node:util";

import {
  IdentityAccountSubjectStore
} from "../authentication/account-subject-store.js";
import { createIdentityDatabase } from "../database/context.js";
import { formatIdentityAccountSubject } from "./account-subject-output.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Returns a required non-empty operator command value. */
function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Missing required option ${name}`);
  }
  return normalized;
}

/** Validates the exact account UUID accepted by the lookup command. */
function accountId(value: string | undefined): string {
  const normalized = required(value, "--account-id");
  if (!uuidPattern.test(normalized)) {
    throw new Error("--account-id must be a UUID");
  }
  return normalized;
}

/** Resolves and prints one public subject without loading unrelated secrets. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "account-id": { type: "string" }
    }
  });
  const databaseUrl = required(process.env.DATABASE_URL, "DATABASE_URL");
  const database = createIdentityDatabase(databaseUrl, 1);
  try {
    const store = new IdentityAccountSubjectStore(database.pool);
    const result = await store.findExact(accountId(values["account-id"]));
    process.stdout.write(formatIdentityAccountSubject(result));
  } finally {
    await database.pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Identity account subject lookup failed"}\n`
  );
  process.exitCode = 1;
});
