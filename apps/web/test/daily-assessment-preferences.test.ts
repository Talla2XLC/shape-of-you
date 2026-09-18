import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureDailyAssessmentTimezone } from "../app/lib/daily-assessment-preferences";

describe("daily assessment timezone bootstrap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("retries a transient failure, then persists once and does not write again", async () => {
    vi.stubGlobal("document", {
      cookie: "__Host-shape_of_you_api_csrf=csrf-value"
    });
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation((() => ({
      resolvedOptions: () => ({ timeZone: "Europe/Belgrade" }),
      format: () => ""
    }) as Intl.DateTimeFormat) as typeof Intl.DateTimeFormat);
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timezone: null,
        updatedAt: "2026-09-18T00:00:00.000Z"
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timezone: "Europe/Belgrade",
        updatedAt: "2026-09-18T00:00:01.000Z"
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", request);

    await ensureDailyAssessmentTimezone();
    await ensureDailyAssessmentTimezone();
    await ensureDailyAssessmentTimezone();

    expect(request).toHaveBeenNthCalledWith(2,
      "/api/v1/daily-assessment/preferences",
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" })
    );
    expect(request).toHaveBeenNthCalledWith(3,
      "/api/v1/daily-assessment/preferences",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ timezone: "Europe/Belgrade", ifTimezoneUnset: true }),
        headers: expect.objectContaining({ "x-csrf-token": "csrf-value" })
      })
    );
    expect(request).toHaveBeenCalledTimes(3);
  });
});
