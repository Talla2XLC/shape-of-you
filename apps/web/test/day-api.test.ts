import { afterEach, describe, expect, it, vi } from "vitest";

import { dayApi } from "../app/lib/day-api";

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
});

describe("daily browser API adapter", () => {
  it("uses same-origin requests and adds the readable CSRF value only to writes", async () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { cookie: "__Host-shape_of_you_api_csrf=csrf-value" }
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ localDate: "2026-08-12" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 201 }));
    globalThis.fetch = fetchMock;

    await dayApi.projection("2026-08-12", "Europe/Moscow");
    await dayApi.close("2026-08-12", "Europe/Moscow");

    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/v1/day-projections?");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "same-origin" });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/day-closures");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      credentials: "same-origin",
      headers: expect.objectContaining({ "x-csrf-token": "csrf-value" })
    });
  });
});
