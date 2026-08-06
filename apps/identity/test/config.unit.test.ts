import { describe, expect, it } from "vitest";

import { loadIdentityConfig } from "../src/config.js";

describe("loadIdentityConfig", () => {
  it("applies safe local defaults", () => {
    expect(
      loadIdentityConfig({
        DATABASE_URL: "postgresql://identity:identity@127.0.0.1:5432/identity",
        IDENTITY_PUBLIC_ORIGIN: "http://identity.localhost",
        WEBAUTHN_RP_ID: "identity.localhost"
      })
    ).toEqual({
      NODE_ENV: "development",
      HOST: "0.0.0.0",
      PORT: 3_000,
      DATABASE_URL: "postgresql://identity:identity@127.0.0.1:5432/identity",
      DATABASE_POOL_MAX: 10,
      IDENTITY_PUBLIC_ORIGIN: "http://identity.localhost",
      WEBAUTHN_RP_ID: "identity.localhost",
      WEBAUTHN_RP_NAME: "Shape of You",
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
      loadIdentityConfig({
        DATABASE_URL: "https://example.test",
        IDENTITY_PUBLIC_ORIGIN: "http://identity.localhost",
        WEBAUTHN_RP_ID: "identity.localhost"
      })
    ).toThrow("Invalid Identity runtime configuration");
  });

  it("rejects an invalid port", () => {
    expect(() =>
      loadIdentityConfig({
        DATABASE_URL: "postgresql://identity:identity@127.0.0.1:5432/identity",
        IDENTITY_PUBLIC_ORIGIN: "http://identity.localhost",
        WEBAUTHN_RP_ID: "identity.localhost",
        PORT: "0"
      })
    ).toThrow("Invalid Identity runtime configuration");
  });

  it("requires the RP ID to match the exact public origin hostname", () => {
    expect(() =>
      loadIdentityConfig({
        DATABASE_URL: "postgresql://identity:identity@127.0.0.1:5432/identity",
        IDENTITY_PUBLIC_ORIGIN: "https://identity.example.test",
        WEBAUTHN_RP_ID: "example.test"
      })
    ).toThrow("WEBAUTHN_RP_ID");
  });

  it("requires HTTPS for the production Identity origin", () => {
    expect(() =>
      loadIdentityConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://identity:identity@127.0.0.1:5432/identity",
        IDENTITY_PUBLIC_ORIGIN: "http://identity.example.test",
        WEBAUTHN_RP_ID: "identity.example.test"
      })
    ).toThrow("must use https in production");
  });

  it("requires both TOTP key-ring settings when recovery is enabled", () => {
    expect(() =>
      loadIdentityConfig({
        DATABASE_URL: "postgresql://identity:identity@127.0.0.1:5432/identity",
        IDENTITY_PUBLIC_ORIGIN: "http://identity.localhost",
        WEBAUTHN_RP_ID: "identity.localhost",
        IDENTITY_TOTP_ACTIVE_KEY_ID: "v1"
      })
    ).toThrow("must be supplied together");
  });
});
