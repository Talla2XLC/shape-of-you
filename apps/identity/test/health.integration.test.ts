import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createIdentityServer } from "../src/app.js";
import type { OAuthBrowserUi } from "../src/oauth/browser-ui.js";

const servers = new Set<ReturnType<typeof createIdentityServer>>();

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
  servers.clear();
  vi.restoreAllMocks();
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

  it("logs an unexpected request failure without credentials or error text", async () => {
    const credential = "A".repeat(43);
    const sensitiveMessage = "database password and OAuth token must not leak";
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const server = createIdentityServer({
      readiness: { check: async () => undefined },
      oauthBrowserUi: {
        handle: async () => {
          throw Object.assign(new Error(sensitiveMessage), {
            code: "SECRET_KEY",
            name: "PASSWORD"
          });
        }
      } as unknown as OAuthBrowserUi
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

    const response = await fetch(
      `http://127.0.0.1:${address.port}/oauth/interaction/${credential}/consent`
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "internal_error",
      message: "Internal server error"
    });
    const log = stderr.mock.calls.flatMap((call) => call).join("");
    expect(log).toContain('"message":"Identity request failed"');
    expect(log).toContain('"route":"/oauth/interaction/:credential/consent"');
    expect(log).toContain('"fingerprint":');
    expect(log).toContain('"errorName":"UnknownError"');
    expect(log).not.toContain(credential);
    expect(log).not.toContain(sensitiveMessage);
    expect(log).not.toContain("SECRET_KEY");
    expect(log).not.toContain("PASSWORD");
    stderr.mockRestore();
  });
});
