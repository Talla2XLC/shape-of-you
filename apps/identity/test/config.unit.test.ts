import { describe, expect, it } from "vitest";

import { loadIdentityConfig } from "../src/config.js";

describe("loadIdentityConfig", () => {
  it("applies safe local defaults", () => {
    expect(loadIdentityConfig({})).toEqual({
      NODE_ENV: "development",
      HOST: "0.0.0.0",
      PORT: 3_000,
      LOG_LEVEL: "info",
      SHUTDOWN_TIMEOUT_MS: 10_000
    });
  });

  it("rejects an invalid port", () => {
    expect(() => loadIdentityConfig({ PORT: "0" })).toThrow(
      "Invalid Identity runtime configuration"
    );
  });
});
