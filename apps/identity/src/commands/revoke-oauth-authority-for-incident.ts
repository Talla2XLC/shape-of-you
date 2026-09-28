import { loadIdentityConfig } from "../config.js";
import { createIdentityDatabase } from "../database/context.js";
import { revokeOAuthAuthorityForIncident } from "../oauth/incident-revocation.js";

async function main(): Promise<void> {
  if (
    process.argv.length !== 3 ||
    process.argv[2] !== "--confirm-global-revocation"
  ) {
    throw new Error("Explicit --confirm-global-revocation is required");
  }
  const config = loadIdentityConfig();
  if (config.IDENTITY_OAUTH_ISSUANCE_DISABLED !== "true") {
    throw new Error("OAuth issuance must be disabled before incident revocation");
  }
  const database = createIdentityDatabase(config.DATABASE_URL, 1);
  try {
    const result = await revokeOAuthAuthorityForIncident(database.pool);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await database.pool.end();
  }
}

main().catch(() => {
  process.stderr.write("Identity incident authority revocation failed.\n");
  process.exitCode = 1;
});
