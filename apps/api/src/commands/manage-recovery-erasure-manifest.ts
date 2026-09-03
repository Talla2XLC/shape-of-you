import { parseArgs } from "node:util";

import { createDatabase } from "../database/context.js";
import {
  assertRecoveryErasureManifestComplete,
  exportRecoveryErasureManifest,
  readPrivateRecoveryErasureManifest,
  writePrivateRecoveryErasureManifest
} from "../recovery/recovery-erasure-manifest.js";
import { RecoveryRepository } from "../storage/recovery-repository.js";

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Missing required option ${name}`);
  return normalized;
}

function database() {
  return createDatabase({
    DATABASE_URL: required(process.env.DATABASE_URL, "DATABASE_URL"),
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: 3_000,
    LOG_LEVEL: "silent",
    PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: "00000000-0000-4000-8000-000000000001",
    SHUTDOWN_TIMEOUT_MS: 10_000
  });
}

/** Exports an immutable manifest or applies a complete manifest to an isolated restore. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      action: { type: "string" },
      output: { type: "string" },
      manifest: { type: "string" },
      "required-through": { type: "string" }
    }
  });
  if (values.action !== "export" && values.action !== "apply") {
    throw new Error("--action must be export or apply");
  }
  const context = database();
  try {
    if (values.action === "export") {
      if (values.manifest || values["required-through"]) {
        throw new Error("Export accepts only --output");
      }
      const manifest = await exportRecoveryErasureManifest(context.pool);
      await writePrivateRecoveryErasureManifest(
        required(values.output, "--output"),
        manifest
      );
      process.stdout.write(`Recovery erasure manifest exported (${manifest.markers.length} markers).\n`);
      return;
    }
    if (values.output) throw new Error("Apply does not accept --output");
    const manifest = await readPrivateRecoveryErasureManifest(
      required(values.manifest, "--manifest")
    );
    assertRecoveryErasureManifestComplete(
      manifest,
      required(values["required-through"], "--required-through")
    );
    const repository = new RecoveryRepository(context);
    for (const marker of manifest.markers) {
      await repository.replayErasureMarker(marker);
    }
    process.stdout.write(`Recovery erasure manifest applied (${manifest.markers.length} markers).\n`);
  } finally {
    await context.pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Recovery erasure manifest operation failed"}\n`
  );
  process.exitCode = 1;
});
