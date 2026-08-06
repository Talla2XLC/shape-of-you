import { createIdentityServer } from "./app.js";
import { IdentityAuthenticationService } from "./authentication/service.js";
import { SimpleWebAuthnAdapter } from "./authentication/webauthn-adapter.js";
import { loadIdentityConfig } from "./config.js";
import {
  checkIdentityDatabaseReadiness,
  createIdentityDatabase
} from "./database/context.js";

async function main(): Promise<void> {
  const config = loadIdentityConfig();
  const database = createIdentityDatabase(
    config.DATABASE_URL,
    config.DATABASE_POOL_MAX
  );
  const server = createIdentityServer({
    readiness: {
      check: async () => checkIdentityDatabaseReadiness(database)
    },
    authentication: new IdentityAuthenticationService(
      database.pool,
      new SimpleWebAuthnAdapter(),
      config
    ),
    publicOrigin: config.IDENTITY_PUBLIC_ORIGIN
  });
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stdout.write(
      `${JSON.stringify({ level: "info", message: "Identity graceful shutdown started", signal })}\n`
    );

    const timeout = setTimeout(() => {
      process.stderr.write(
        `${JSON.stringify({ level: "error", message: "Identity graceful shutdown timed out" })}\n`
      );
      process.exitCode = 1;
      server.closeAllConnections();
    }, config.SHUTDOWN_TIMEOUT_MS);
    timeout.unref();

    try {
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        }),
        database.pool.end()
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };

  const requestShutdown = (signal: NodeJS.Signals): void => {
    void shutdown(signal).catch((error: unknown) => {
      process.stderr.write(
        `${JSON.stringify({
          level: "error",
          message: "Identity graceful shutdown failed",
          error: error instanceof Error ? error.message : "unknown error"
        })}\n`
      );
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", () => {
    requestShutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    requestShutdown("SIGTERM");
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.PORT, config.HOST, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await database.pool.end();
    throw error;
  }

  process.stdout.write(
    `${JSON.stringify({
      level: "info",
      message: "Identity listening",
      host: config.HOST,
      port: config.PORT
    })}\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      level: "fatal",
      message: "Identity startup failed",
      error: error instanceof Error ? error.message : "unknown error"
    })}\n`
  );
  process.exitCode = 1;
});
