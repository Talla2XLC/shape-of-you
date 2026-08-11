import { loadIdentityConfig } from "../config.js";
import { createIdentityDatabase } from "../database/context.js";
import { OAuthClientStore } from "../oauth/client-store.js";
import { resolvePredefinedOAuthClients } from "../oauth/predefined-clients.js";
import { formatOAuthClientReconcileResult } from "./oauth-client-reconcile-output.js";

async function main(): Promise<void> {
  const config = loadIdentityConfig();
  const clients = resolvePredefinedOAuthClients(
    config.IDENTITY_CHATGPT_REDIRECT_URI
  );
  const database = createIdentityDatabase(config.DATABASE_URL, 1);
  try {
    const store = new OAuthClientStore(database.pool);
    for (const client of clients) {
      const status = await store.reconcilePublicClient(client);
      process.stdout.write(
        `${formatOAuthClientReconcileResult(client.clientId, status)}\n`
      );
    }
  } finally {
    await database.pool.end();
  }
}

main().catch(() => {
  process.stderr.write("Predefined OAuth client reconciliation failed.\n");
  process.exitCode = 1;
});
