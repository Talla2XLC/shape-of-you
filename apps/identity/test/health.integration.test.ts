import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createIdentityServer } from "../src/app.js";

const servers = new Set<ReturnType<typeof createIdentityServer>>();

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
  servers.clear();
});

describe("Identity health endpoints", () => {
  let origin: string;
  let readinessError: Error | null;

  beforeEach(async () => {
    readinessError = null;
    const server = createIdentityServer({
      readiness: {
        check: async () => {
          if (readinessError) {
            throw readinessError;
          }
        }
      }
    });
    servers.add(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
  });

  it.each(["live", "ready"])("serves GET /%s", async (path) => {
    const response = await fetch(`${origin}/${path}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: path === "live" ? "alive" : "ready"
    });
  });

  it("keeps liveness up and returns 503 readiness without leaking errors", async () => {
    readinessError = new Error("database password must not leak");

    const liveResponse = await fetch(`${origin}/live`);
    const readyResponse = await fetch(`${origin}/ready`);

    expect(liveResponse.status).toBe(200);
    await expect(liveResponse.json()).resolves.toEqual({ status: "alive" });
    expect(readyResponse.status).toBe(503);
    await expect(readyResponse.json()).resolves.toEqual({
      status: "not_ready"
    });
  });

  it("returns a stable JSON 404", async () => {
    const response = await fetch(`${origin}/unknown`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "not_found",
      message: "Route not found"
    });
  });
});
