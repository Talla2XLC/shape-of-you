import { afterEach, describe, expect, it, vi } from "vitest";

import { dayApi } from "../app/lib/day-api";

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
});

describe("daily browser API adapter", () => {
  it("uses a same-origin read for the current daily projection", async () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { cookie: "__Host-shape_of_you_api_csrf=csrf-value" }
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ localDate: "2026-08-12" }), { status: 200 }));
    globalThis.fetch = fetchMock;

    await dayApi.projection("2026-08-12", "Europe/Moscow");

    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/v1/day-projections?");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "same-origin" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
