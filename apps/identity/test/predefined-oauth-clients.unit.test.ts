import { describe, expect, it } from "vitest";

import { formatOAuthClientReconcileResult } from "../src/commands/oauth-client-reconcile-output.js";
import {
  assertOAuthClientIdIsOperatorManaged,
  isPredefinedOAuthClientId,
  parseChatGptRedirectUri,
  resolvePredefinedOAuthClients
} from "../src/oauth/predefined-clients.js";

describe("predefined OAuth clients", () => {
  const callback = "https://chatgpt.com/connector/oauth/42Qr-Z4hTGXh";

  it("resolves the reserved ChatGPT policy with its exact environment callback", () => {
    expect(resolvePredefinedOAuthClients(callback)).toEqual([
      {
        clientId: "shape-of-you-chatgpt-staging",
        displayName: "Shape of You ChatGPT Staging",
        redirectUris: [callback],
        allowedScopes: [
          "openid",
          "offline_access",
          "person:read",
          "weight:write",
          "body-measurement:write",
          "meal:write",
          "workout:write"
        ],
        refreshTokensEnabled: true
      }
    ]);
  });

  it.each([
    undefined,
    "http://chatgpt.com/connector/oauth/42Qr-Z4hTGXh",
    "https://example.com/connector/oauth/42Qr-Z4hTGXh",
    "https://chatgpt.com/connector/oauth/short",
    "https://chatgpt.com/connector/oauth/42Qr-Z4hTGXh?leak=value",
    "https://user@chatgpt.com/connector/oauth/42Qr-Z4hTGXh"
  ])("rejects an invalid callback without including it in the error", (value) => {
    expect(() => parseChatGptRedirectUri(value)).toThrow(
      /^Predefined ChatGPT OAuth redirect URI (is required|is invalid)$/
    );
  });

  it("reserves release-managed IDs from the general operator command", () => {
    expect(isPredefinedOAuthClientId("shape-of-you-chatgpt-staging")).toBe(true);
    expect(() =>
      assertOAuthClientIdIsOperatorManaged("shape-of-you-chatgpt-staging")
    ).toThrow("managed by deployment reconciliation");
    expect(() => assertOAuthClientIdIsOperatorManaged("operator-client")).not.toThrow();
  });

  it("fails closed for an unsupported manifest version", () => {
    expect(() =>
      resolvePredefinedOAuthClients(callback, { version: 2, clients: [] })
    ).toThrow("manifest version is unsupported");
  });

  it("formats only the client ID and lifecycle status", () => {
    expect(
      formatOAuthClientReconcileResult(
        "shape-of-you-chatgpt-staging",
        "unchanged"
      )
    ).toBe("OAuth client shape-of-you-chatgpt-staging: unchanged.");
    expect(formatOAuthClientReconcileResult("client", "created")).not.toContain(
      "chatgpt.com"
    );
  });
});
