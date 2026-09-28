import { describe, expect, it } from "vitest";

import { loadConfig, parseIdentityOAuthDeniedKids } from "@shape-of-you/config";

const baseEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://shape_of_you:password@localhost:5432/shape_of_you",
  PERSON_CONTEXT_MODE: "synthetic",
  SYNTHETIC_PERSON_ID: "00000000-0000-4000-8000-000000000001"
};

describe("Intervals.icu runtime configuration", () => {
  it("allows the complete provider group to be absent", () => {
    expect(loadConfig(baseEnvironment).INTERVALS_ICU_CLIENT_ID).toBeUndefined();
  });

  it("accepts the complete provider group without a separate enable flag", () => {
    const config = loadConfig({
      ...baseEnvironment,
      INTERVALS_ICU_CLIENT_ID: "shape-of-you",
      INTERVALS_ICU_CLIENT_SECRET: "test-client-secret",
      INTERVALS_ICU_REDIRECT_URI: "https://shape-of-you.test/api/integrations/intervals-icu/callback",
      INTEGRATION_ENCRYPTION_KEY_RING: "test-v1:dGVzdC1rZXk",
      INTEGRATION_ENCRYPTION_ACTIVE_KEY_ID: "test-v1"
    });

    expect(config.INTERVALS_ICU_CLIENT_ID).toBe("shape-of-you");
    expect("INTERVALS_ICU_ENABLED" in config).toBe(false);
  });

  it("rejects a partial provider group", () => {
    expect(() => loadConfig({
      ...baseEnvironment,
      INTERVALS_ICU_CLIENT_ID: "shape-of-you"
    })).toThrow("must be supplied together");
  });

  it("rejects a non-HTTPS provider callback", () => {
    expect(() => loadConfig({
      ...baseEnvironment,
      INTERVALS_ICU_CLIENT_ID: "shape-of-you",
      INTERVALS_ICU_CLIENT_SECRET: "test-client-secret",
      INTERVALS_ICU_REDIRECT_URI: "http://shape-of-you.test/api/integrations/intervals-icu/callback",
      INTEGRATION_ENCRYPTION_KEY_RING: "test-v1:dGVzdC1rZXk",
      INTEGRATION_ENCRYPTION_ACTIVE_KEY_ID: "test-v1"
    })).toThrow("must use HTTPS");
  });
});

describe("Identity OAuth emergency deny policy", () => {
  it("accepts an absent or versioned policy", () => {
    expect([...parseIdentityOAuthDeniedKids(undefined)]).toEqual([]);
    expect([...parseIdentityOAuthDeniedKids(
      '{"version":1,"kids":["staging-v1","staging-v2"]}'
    )]).toEqual(["staging-v1", "staging-v2"]);
    expect(loadConfig({
      ...baseEnvironment,
      IDENTITY_OAUTH_DENIED_KIDS: '{"version":1,"kids":["staging-v1"]}'
    }).IDENTITY_OAUTH_DENIED_KIDS).toContain("staging-v1");
  });

  it("fails configuration for malformed, duplicate, or unsupported policies", () => {
    for (const policy of [
      "",
      '{"version":2,"kids":[]}',
      '{"version":1,"kids":["same","same"]}',
      '{"version":1,"kids":["unsafe kid"]}',
      '{"version":1,"kids":[],"extra":true}'
    ]) {
      expect(() => loadConfig({
        ...baseEnvironment,
        IDENTITY_OAUTH_DENIED_KIDS: policy
      })).toThrow("denied-kid policy");
    }
  });
});
