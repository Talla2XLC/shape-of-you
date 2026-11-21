import { EventEmitter } from "node:events";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { trackPoolShutdown } from "./support/pool-shutdown.js";

describe("disposable PostgreSQL fixture shutdown", () => {
  it("waits for all client end events after the pool itself reports completion", async () => {
    const pool = Object.assign(new EventEmitter(), { end: vi.fn(async () => {}) });
    const close = trackPoolShutdown(pool as unknown as Pool);
    const first = new EventEmitter();
    const second = new EventEmitter();
    pool.emit("connect", first);
    pool.emit("connect", second);
    let finished = false;
    const closing = close().then(() => { finished = true; });
    await Promise.resolve();
    expect(pool.end).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    first.emit("end");
    await Promise.resolve();
    expect(finished).toBe(false);
    second.emit("end");
    await closing;
    expect(finished).toBe(true);
    expect(pool.listenerCount("connect")).toBe(0);
  });

  it("does not suppress pool shutdown failures", async () => {
    const failure = new Error("shutdown failed");
    const pool = Object.assign(new EventEmitter(), { end: vi.fn(async () => { throw failure; }) });
    await expect(trackPoolShutdown(pool as unknown as Pool)()).rejects.toBe(failure);
  });

  it("fails rather than stopping the database with an unclosed client", async () => {
    vi.useFakeTimers();
    try {
      const pool = Object.assign(new EventEmitter(), { end: vi.fn(async () => {}) });
      const close = trackPoolShutdown(pool as unknown as Pool);
      pool.emit("connect", new EventEmitter());
      const rejected = expect(close()).rejects.toThrow("did not finish shutdown");
      await vi.advanceTimersByTimeAsync(5_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});
