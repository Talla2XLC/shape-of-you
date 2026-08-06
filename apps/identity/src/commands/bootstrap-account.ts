import { loadIdentityConfig } from "../config.js";
import { IdentityAuthenticationService } from "../authentication/service.js";
import { SimpleWebAuthnAdapter } from "../authentication/webauthn-adapter.js";
import { createIdentityDatabase } from "../database/context.js";

function readDisplayName(arguments_: readonly string[]): string {
  const index = arguments_.indexOf("--display-name");
  const value = index >= 0 ? arguments_[index + 1]?.trim() : undefined;
  if (!value) {
    throw new Error("Usage: pnpm account:bootstrap -- --display-name \"Your name\"");
  }
  return value;
}

async function main(): Promise<void> {
  if (!process.stdout.isTTY) {
    throw new Error("Refusing to print an enrollment token outside an interactive terminal");
  }
  const config = loadIdentityConfig();
  const database = createIdentityDatabase(config.DATABASE_URL, 1);
  try {
    const service = new IdentityAuthenticationService(
      database.pool,
      new SimpleWebAuthnAdapter(),
      config
    );
    const result = await service.bootstrapAccount(readDisplayName(process.argv.slice(2)));
    process.stdout.write(
      `Account: ${result.accountId}\nEnrollment token (shown once): ${result.enrollmentToken}\nExpires: ${result.expiresAt.toISOString()}\n`
    );
  } finally {
    await database.pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Identity account bootstrap failed"}\n`
  );
  process.exitCode = 1;
});
