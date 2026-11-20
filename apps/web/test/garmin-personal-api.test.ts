import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  garminPersonalApi,
  garminPersonalFailureReason,
  garminPersonalRequestMessage,
  IntegrationApiError
} from "../app/lib/integration-api";

afterEach(() => vi.unstubAllGlobals());

describe("direct Garmin browser API", () => {
  it("sends a personal key only in the protected connect body with explicit consent", async () => {
    const apiKey = randomBytes(32).toString("base64url");
    const csrf = randomBytes(32).toString("base64url");
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("document", { cookie: `__Host-shape_of_you_api_csrf=${csrf}` });

    await garminPersonalApi.connect(apiKey);

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/integrations/garmin-personal/connect");
    expect(url).not.toContain(apiKey);
    expect(init).toMatchObject({ method: "POST", cache: "no-store", credentials: "same-origin" });
    expect(init.headers).toMatchObject({ "x-csrf-token": csrf });
    expect(JSON.parse(init.body as string)).toEqual({ apiKey, consent: true });
    expect(JSON.stringify(init.headers)).not.toContain(apiKey);
  });

  it("reads status and performs disconnect/history without sending a key", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("document", { cookie: "" });
    await garminPersonalApi.status();
    await garminPersonalApi.disconnect();
    await garminPersonalApi.startHistoricalImport();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/integrations/garmin-personal",
      "/api/v1/integrations/garmin-personal/disconnect",
      "/api/v1/integrations/garmin-personal/historical-import"
    ]);
    expect(JSON.parse(fetch.mock.calls[1]![1].body as string)).toEqual({ reason: "user requested disconnect" });
    expect(fetch.mock.calls[2]![1].body).toBeUndefined();
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("apiKey");
  });

  it("keeps the optional check separate from activation and consent", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"verified":true}', { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("document", { cookie: "" });
    const apiKey = randomBytes(32).toString("base64url");
    await expect(garminPersonalApi.check(apiKey)).resolves.toEqual({ verified: true });
    expect(fetch.mock.calls).toHaveLength(1);
    expect(fetch.mock.calls[0]![0]).toBe("/api/v1/integrations/garmin-personal/check");
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({ apiKey });
  });

  it("never reads or displays a rejected provider response body", async () => {
    const unsafe = randomBytes(32).toString("base64url");
    vi.stubGlobal("document", { cookie: "" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(unsafe, { status: 409 })));
    const error = await garminPersonalApi.connect(unsafe).catch((value: unknown) => value);
    expect(error).toEqual(new IntegrationApiError(409));
    expect(garminPersonalRequestMessage(error)).toContain("Existing Intervals imports or retained history");
    expect(garminPersonalRequestMessage(error)).not.toContain(unsafe);
    expect(garminPersonalRequestMessage(new Error(unsafe))).not.toContain(unsafe);
    expect(garminPersonalRequestMessage(new IntegrationApiError(503))).toContain("could not be confirmed");
    expect(garminPersonalFailureReason("authorization_required")).toContain("Update your Garmin API key");
    expect(garminPersonalFailureReason(null)).toBeNull();
  });
});
