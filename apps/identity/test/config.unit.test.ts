import { describe, expect, it } from "vitest";

import { loadIdentityConfig } from "../src/config.js";

describe("loadIdentityConfig", () => {
  it("applies safe local defaults", () => {
    expect(
      loadIdentityConfig({
        DATABASE_URL: "postgresql://identity:identity@127.0.0.1:5432/identity"
      })
    ).toEqual({
      NODE_ENV: "development",
      HOST: "0.0.0.0",
      PORT: 3_000,
      DATABASE_URL: "postgresql://identity:identity@127.0.0.1:5432/identity",
      DATABASE_POOL_MAX: 10,
      LOG_LEVEL: "info",
      SHUTDOWN_TIMEOUT_MS: 10_000
    });
  });

  it("requires an Identity-owned database URL", () => {
    expect(() => loadIdentityConfig({})).toThrow(
      "Invalid Identity runtime configuration"
    );
  });

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() =>
      loadIdentityConfig({ DATABASE_URL: "https://example.test" })
    ).toThrow("Invalid Identity runtime configuration");
  });

  it("rejects an invalid port", () => {
    expect(() =>
      loadIdentityConfig({
        DATABASE_URL: "postgresql://identity:identity@127.0.0.1:5432/identity",
        PORT: "0"
      })
    ).toThrow("Invalid Identity runtime configuration");
  });
});
