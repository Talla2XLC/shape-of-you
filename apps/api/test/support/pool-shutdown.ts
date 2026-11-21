import type { Pool, PoolClient } from "pg";

/**
 * Tracks clients from fixture creation and waits for their socket shutdown.
 * Call after stopping application work, before stopping its disposable database;
 * pg-pool.end() can resolve before removed clients emit their final end event.
 * Client and pool errors retain their normal handling and are never suppressed.
 * Rejects if client end events take over five seconds after pool.end() resolves.
 */
export function trackPoolShutdown(pool: Pool): () => Promise<void> {
  const pending = new Set<Promise<void>>();
  const connected = (client: PoolClient) => {
    const ended = new Promise<void>((resolve) => client.once("end", resolve));
    pending.add(ended);
    void ended.then(() => pending.delete(ended));
  };
  pool.on("connect", connected);
  return async () => {
    await pool.end();
    pool.off("connect", connected);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(pending),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("PostgreSQL test clients did not finish shutdown")), 5_000);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}
