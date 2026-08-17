import { parseArgs } from "node:util";

import { createDatabase } from "../database/context.js";
import { IdentityAccessProvisioningRepository } from "../storage/identity-access-provisioning-repository.js";

const syntheticPersonId = "00000000-0000-4000-8000-000000000001";
type Action = "ensure" | "inspect" | "restore" | "revoke";

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Missing required option ${name}`);
  return normalized;
}

function issuer(value: string | undefined): string {
  const input = required(value, "--issuer");
  const url = new URL(input);
  if (url.origin !== input || input.length > 512) {
    throw new Error("--issuer must be an exact origin without a trailing slash or path");
  }
  return url.origin;
}

function action(value: string | undefined): Action {
  if (!["ensure", "inspect", "restore", "revoke"].includes(value ?? "")) {
    throw new Error("--action must be ensure, inspect, restore, or revoke");
  }
  return value as Action;
}

async function readSubject(
  value: string | undefined,
  fromStdin: boolean | undefined
): Promise<string> {
  if (Boolean(value) === Boolean(fromStdin)) {
    throw new Error("Supply exactly one of --subject or --subject-stdin");
  }
  let input = value;
  if (fromStdin) {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;
      if (length > 513) throw new Error("Identity subject input is too large");
      chunks.push(buffer);
    }
    input = Buffer.concat(chunks).toString("utf8");
  }
  const normalized = required(input, fromStdin ? "stdin subject" : "--subject");
  if (normalized.length > 512) {
    throw new Error("Identity subject must contain at most 512 characters");
  }
  return normalized;
}

/** Runs one explicit API-owned Identity access lifecycle operation. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      action: { type: "string" },
      issuer: { type: "string" },
      quiet: { type: "boolean" },
      subject: { type: "string" },
      "subject-stdin": { type: "boolean" }
    }
  });
  const selectedAction = action(values.action);
  const exactIssuer = issuer(values.issuer);
  const exactSubject = await readSubject(values.subject, values["subject-stdin"]);
  const database = createDatabase({
    DATABASE_URL: required(process.env.DATABASE_URL, "DATABASE_URL"),
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
    if (selectedAction === "inspect") {
      const result = await repository.inspectOwnerAccess(exactIssuer, exactSubject);
      const message = `Identity access ${result.status}.\n`;
      (result.status === "active" ? process.stdout : process.stderr).write(message);
      if (result.status !== "active") process.exitCode = 3;
      return;
    }
    const result = selectedAction === "ensure"
      ? await repository.ensureSolePersonOwnerAccess(exactIssuer, exactSubject)
      : selectedAction === "restore"
        ? await repository.restoreOwnerAccess(exactIssuer, exactSubject)
        : await repository.revokeOwnerAccess(exactIssuer, exactSubject);
    process.stdout.write(
      values.quiet
        ? `Identity access ${result.status}.\n`
        : `Identity access ${result.status}.\nUser: ${result.userId}\nPerson: ${result.personId}\n`
    );
  } finally {
    await database.pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Identity access operation failed"}\n`
  );
  process.exitCode = 1;
});
