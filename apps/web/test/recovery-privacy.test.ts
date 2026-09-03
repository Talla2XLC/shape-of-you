import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RecoveryPrivacyApiError,
  recoveryPrivacyApi
} from "../app/lib/recovery-privacy";

afterEach(() => vi.unstubAllGlobals());

describe("Recovery privacy API", () => {
  it("keeps reads same-origin and binds mutations to the API CSRF cookie", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authorizationUrl: "/fresh" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("document", {
      cookie: `other=value; __Host-shape_of_you_api_csrf=${"A".repeat(43)}`
    });

    await recoveryPrivacyApi.listConnections();
    await recoveryPrivacyApi.startErasure("00000000-0000-4000-8000-000000000094");

    expect(fetch.mock.calls[0]?.[0]).toBe("/api/v1/recovery/connections");
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      credentials: "same-origin"
    });
    expect((fetch.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({
      "x-csrf-token": "A".repeat(43)
    });
  });

  it("turns server failures into a bounded UI error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private detail", { status: 403 })));
    vi.stubGlobal("document", { cookie: "" });

    await expect(recoveryPrivacyApi.listConnections()).rejects.toEqual(
      new RecoveryPrivacyApiError(403)
    );
  });
});
