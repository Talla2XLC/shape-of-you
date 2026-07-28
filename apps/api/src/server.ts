import { loadConfig } from "@shape-of-you/config";

import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({ config });
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    app.log.info({ signal }, "graceful shutdown started");

    const timeout = new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error("graceful shutdown timed out")),
        config.SHUTDOWN_TIMEOUT_MS
      ).unref();
    });

    try {
      await Promise.race([app.close(), timeout]);
      app.log.info("graceful shutdown completed");
    } catch (error) {
      app.log.error({ err: error }, "graceful shutdown failed");
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await app.listen({
    host: config.HOST,
    port: config.PORT
  });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      level: "fatal",
      message: "API startup failed",
      error: error instanceof Error ? error.message : "unknown error"
    })}\n`
  );
  process.exitCode = 1;
});
