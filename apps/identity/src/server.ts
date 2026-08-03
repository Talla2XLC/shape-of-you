import { createIdentityServer } from "./app.js";
import { loadIdentityConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadIdentityConfig();
  const server = createIdentityServer();
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

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        clearTimeout(timeout);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.PORT, config.HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });

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
