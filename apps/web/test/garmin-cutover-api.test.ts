import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  garminCutoverApi,
  garminCutoverRequestMessage,
  IntegrationApiError,
  type GarminCutoverPreview
} from "../app/lib/integration-api";

const preview: GarminCutoverPreview = {
  expectedRevision: "revision-a", startsOn: "2026-11-21", timezone: "Europe/Moscow",
  startsAt: "2026-11-20T21:00:00.000Z", sourceDrainsUntil: "2026-12-04T21:00:00.000Z",
  sourceTailFromDate: "2026-11-07", capabilityVersion: "garmin-capabilities-v1",
  gaps: [{ capability: "recovery.hrv_rmssd", status: "unsupported", description: "Overnight HRV is not imported." }]
};

afterEach(() => vi.unstubAllGlobals());

describe("Garmin cutover browser contract", () => {
  it("sends schedule consent, the exact shown gap set and protected key in the body only", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"cutover":null}', { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("document", { cookie: "__Host-shape_of_you_api_csrf=csrf-value" });
    const apiKey = randomUUID();
    const input = { startsOn: preview.startsOn, expectedRevision: preview.expectedRevision, apiKey, consent: true as const, acceptedCoverageGaps: ["recovery.hrv_rmssd" as const], dedupeKey: randomUUID() };
    await garminCutoverApi.schedule(input);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/integrations/garmin-personal/cutover/schedule");
    expect(url).not.toContain(apiKey);
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
    expect(init.headers).toMatchObject({ "x-csrf-token": "csrf-value" });
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect(JSON.stringify(init.headers)).not.toContain(apiKey);
  });

  it("retries through the backend's saved key without requiring or sending a replacement", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"cutover":null}', { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("document", { cookie: "" });
    await garminCutoverApi.retry({ startsOn: preview.startsOn, expectedRevision: preview.expectedRevision, expectedVersion: 3, acceptedCoverageGaps: [], dedupeKey: randomUUID() });
    expect(fetch.mock.calls[0]![0]).toBe("/api/v1/integrations/garmin-personal/cutover/retry");
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).not.toHaveProperty("apiKey");
  });

  it("accepts only a controlled coverage_changed preview and discards raw diagnostic text", async () => {
    const unsafe = randomUUID();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "coverage_changed", message: unsafe,
      details: { apiKey: unsafe, preview: { ...preview, gaps: [{ ...preview.gaps[0], description: unsafe }] } }
    }), { status: 409 })));
    vi.stubGlobal("document", { cookie: "" });
    const error: unknown = await garminCutoverApi.schedule({ startsOn: preview.startsOn, expectedRevision: preview.expectedRevision, apiKey: unsafe, consent: true, acceptedCoverageGaps: [], dedupeKey: randomUUID() }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(IntegrationApiError);
    const safe = error as IntegrationApiError;
    expect(safe.cutoverPreview?.gaps[0]).toEqual({ capability: "recovery.hrv_rmssd", status: "unsupported", description: "Overnight HRV (RMSSD)" });
    expect(JSON.stringify(safe.cutoverPreview)).not.toContain(unsafe);
    expect(garminCutoverRequestMessage(safe)).toContain("updated limitations");
    expect(garminCutoverRequestMessage(safe)).not.toContain(unsafe);
  });

  it.each([
    { error: "CONFLICT", details: { preview } },
    { error: "coverage_changed", details: { preview: { ...preview, startsOn: "2026-02-30" } } },
    { error: "coverage_changed", details: { preview: { ...preview, gaps: [{ capability: "private_unknown_field", status: "unsupported", description: "untrusted" }] } } },
    { error: "coverage_changed", details: { preview: { ...preview, timezone: "untrusted-timezone" } } },
    { error: "coverage_changed", details: { preview: { ...preview, expectedRevision: "x".repeat(17_000) } } }
  ])("rejects malformed or unrelated safe-preview envelopes", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 409 })));
    vi.stubGlobal("document", { cookie: "" });
    const error: unknown = await garminCutoverApi.retry({ startsOn: preview.startsOn, expectedRevision: preview.expectedRevision, expectedVersion: 1, acceptedCoverageGaps: [], dedupeKey: randomUUID() }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(IntegrationApiError);
    expect((error as IntegrationApiError).cutoverPreview).toBeUndefined();
    expect(garminCutoverRequestMessage(error)).toContain("Refresh its status");
  });
});
