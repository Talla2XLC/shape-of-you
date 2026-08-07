import { z } from "zod";

import { loadIdentityConfig } from "../config.js";
import { createIdentityDatabase } from "../database/context.js";
import { OAuthClientStore } from "../oauth/client-store.js";

const argumentsSchema = z.object({
  clientId: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  redirectUri: z.string().url(),
  scopes: z.array(z.string().min(1).max(200)).min(1)
});

function option(arguments_: readonly string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);
  return index >= 0 ? arguments_[index + 1]?.trim() : undefined;
}

function readArguments(arguments_: readonly string[]) {
  return argumentsSchema.parse({
    clientId: option(arguments_, "--client-id"),
    displayName: option(arguments_, "--display-name"),
    redirectUri: option(arguments_, "--redirect-uri"),
    scopes: option(arguments_, "--scopes")?.split(",").map((scope) => scope.trim())
  });
}

async function main(): Promise<void> {
  const input = readArguments(process.argv.slice(2));
  const config = loadIdentityConfig();
  const database = createIdentityDatabase(config.DATABASE_URL, 1);
  try {
    await new OAuthClientStore(database.pool).provisionPublicClient({
      clientId: input.clientId,
      displayName: input.displayName,
      redirectUris: [input.redirectUri],
      allowedScopes: input.scopes,
      refreshTokensEnabled: true
    });
    process.stdout.write(`OAuth client ${input.clientId} provisioned.\n`);
  } finally {
    await database.pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "OAuth client provisioning failed"}\n`
  );
  process.exitCode = 1;
});
