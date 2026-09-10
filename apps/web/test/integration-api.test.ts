import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";

import {
  IntegrationApiError,
  integrationApi,
  integrationAuthorizationResultMessage,
  integrationFailureReason
} from "../app/lib/integration-api";

afterEach(() => vi.unstubAllGlobals());

describe("integration API", () => {
  it("keeps tokens out of JavaScript and sends CSRF on mutations", async () => {
    const status = { provider: "intervals_icu", displayName: "Garmin via Intervals.icu", recoveryConnectionId: null, lifecycle: "unavailable", failureCode: null, lastAttemptAt: null, lastSuccessfulSyncAt: null, lastDataAt: null, connectedAt: null, disconnectedAt: null };
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(status), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authorizationUrl: "https://intervals.icu/oauth/authorize" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("document", { cookie: `__Host-shape_of_you_api_csrf=${"C".repeat(43)}` });

    await integrationApi.status();
    await integrationApi.start();

    expect(fetch.mock.calls[0]?.[0]).toBe("/api/v1/integrations/garmin-intervals");
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect((fetch.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({ "x-csrf-token": "C".repeat(43) });
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("access_token");
  });

  it("bounds provider-facing failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("provider secret body", { status: 502 })));
    vi.stubGlobal("document", { cookie: "" });
    await expect(integrationApi.status()).rejects.toEqual(new IntegrationApiError(502));
  });

  it("maps degraded status to bounded safe copy", () => {
    expect(integrationFailureReason("provider_timeout")).toBe("Intervals.icu did not respond in time.");
    expect(integrationFailureReason("authorization_required")).not.toContain("token");
    expect(integrationFailureReason(null)).toBeNull();
  });

  it("maps an OAuth callback failure without exposing provider details", () => {
    expect(integrationAuthorizationResultMessage("authorization_failed")).toBe(
      "Intervals.icu authorization could not be completed. Please try again."
    );
    expect(integrationAuthorizationResultMessage("connected")).toBeNull();
    expect(integrationAuthorizationResultMessage(["authorization_failed"])).toBeNull();
  });

  it("renders last attempt and the mapped degraded reason on the Connections page", async () => {
    const page = await readFile(new URL("../app/pages/connections.vue", import.meta.url), "utf8");
    expect(page).toContain("Last attempt:");
    expect(page).toContain("integrationFailureReason(status.failureCode)");
    expect(page).toContain("integrationAuthorizationResultMessage(route.query.provider)");
    expect(page).toContain("window.history.replaceState");
  });
});
