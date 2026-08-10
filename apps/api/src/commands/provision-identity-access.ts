import { parseArgs } from "node:util";

import { createDatabase } from "../database/context.js";
import { IdentityAccessProvisioningRepository } from "../storage/identity-access-provisioning-repository.js";
import { formatIdentityAccessProvisioning } from "./identity-access-output.js";

const syntheticPersonId = "00000000-0000-4000-8000-000000000001";

/** Returns a required non-empty operator command value. */
function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Missing required option ${name}`);
  }
  return normalized;
}

/** Validates and normalizes an exact issuer origin. */
function issuer(value: string | undefined): string {
  const input = required(value, "--issuer");
  const url = new URL(input);
  if (url.origin !== input || input.length > 512) {
    throw new Error("--issuer must be an exact origin without a trailing slash or path");
  }
  return url.origin;
}

/** Validates the opaque public Identity subject. */
function subject(value: string | undefined): string {
  const input = required(value, "--subject");
  if (input.length > 512) {
    throw new Error("--subject must contain at most 512 characters");
  }
  return input;
}

/** Creates the API-owned authorization principal for one Identity subject. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      issuer: { type: "string" },
      subject: { type: "string" }
    }
  });
  const databaseUrl = required(process.env.DATABASE_URL, "DATABASE_URL");
  const database = createDatabase({
    DATABASE_URL: databaseUrl,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: 3_000,
    LOG_LEVEL: "silent",
    PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: syntheticPersonId,
    SHUTDOWN_TIMEOUT_MS: 10_000
  });
  try {
    const repository = new IdentityAccessProvisioningRepository(database);
    const result = await repository.provisionOwnerAccess(
      issuer(values.issuer),
      subject(values.subject)
    );
    process.stdout.write(formatIdentityAccessProvisioning(result));
  } finally {
    await database.pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Identity access provisioning failed"}\n`
  );
  process.exitCode = 1;
});
