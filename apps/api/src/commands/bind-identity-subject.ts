import { parseArgs } from "node:util";

import { createDatabase } from "../database/context.js";
import { IdentitySubjectMappingRepository } from "../storage/identity-subject-mapping-repository.js";

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Missing required option ${name}`);
  }
  return normalized;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      issuer: { type: "string" },
      subject: { type: "string" },
      "user-id": { type: "string" }
    }
  });
  const databaseUrl = required(process.env.DATABASE_URL, "DATABASE_URL");
  const issuerInput = required(values.issuer, "--issuer");
  const issuerUrl = new URL(issuerInput);
  if (issuerUrl.origin !== issuerInput) {
    throw new Error("--issuer must be an exact origin without a trailing slash or path");
  }
  const issuer = issuerUrl.origin;
  const subject = required(values.subject, "--subject");
  const userId = required(values["user-id"], "--user-id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(userId)) {
    throw new Error("--user-id must be a UUID");
  }

  const database = createDatabase({
    DATABASE_URL: databaseUrl,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: 3_000,
    LOG_LEVEL: "silent",
    PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: userId,
    SHUTDOWN_TIMEOUT_MS: 10_000
  });
  try {
    const outcome = await new IdentitySubjectMappingRepository(database).bind(
      issuer,
      subject,
      userId
    );
    process.stdout.write(`Identity subject binding ${outcome}.\n`);
  } finally {
    await database.pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Identity subject binding failed"}\n`
  );
  process.exitCode = 1;
});
