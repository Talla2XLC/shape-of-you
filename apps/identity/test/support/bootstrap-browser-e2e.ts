import { writeFile } from "node:fs/promises";

import { IdentityAuthenticationService } from "../../src/authentication/service.js";
import { SimpleWebAuthnAdapter } from "../../src/authentication/webauthn-adapter.js";
import { loadIdentityConfig } from "../../src/config.js";
import { createIdentityDatabase } from "../../src/database/context.js";

function outputPath(arguments_: readonly string[]): string {
  const index = arguments_.indexOf("--output");
  const value = index >= 0 ? arguments_[index + 1]?.trim() : undefined;
  if (!value) throw new Error("Missing required --output path");
  return value;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Browser E2E bootstrap is available only in NODE_ENV=test");
  }
  const config = loadIdentityConfig();
  const database = createIdentityDatabase(config.DATABASE_URL, 1);
  try {
    const result = await new IdentityAuthenticationService(
      database.pool,
      new SimpleWebAuthnAdapter(),
      config
    ).bootstrapAccount("Browser E2E account");
    await writeFile(
      outputPath(process.argv.slice(2)),
      JSON.stringify({
        oauthSubject: result.accountId,
        enrollmentToken: result.enrollmentToken
      }),
      { encoding: "utf8", flag: "wx", mode: 0o600 }
    );
  } finally {
    await database.pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Browser E2E bootstrap failed"}\n`
  );
  process.exitCode = 1;
});
