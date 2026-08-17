import { describe, expect, it, vi } from "vitest";

import {
  BrowserSessionProbeError,
  createBrowserAuth,
  returnRoute
} from "../app/lib/browser-auth";

describe("browser authorization adapter", () => {
  it("reports only 204 or 401 as session presence", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const auth = createBrowserAuth(fetcher);

    await expect(auth.hasSession()).resolves.toBe(true);
    await expect(auth.hasSession()).resolves.toBe(false);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/browser-auth/session",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" })
    );
  });

  it("fails closed on an unexpected session response", async () => {
    const auth = createBrowserAuth(async () => new Response(null, { status: 503 }));
    await expect(auth.hasSession()).rejects.toBeInstanceOf(BrowserSessionProbeError);
  });

  it("builds an encoded sign-in route and removes fragments", () => {
    const auth = createBrowserAuth(async () => new Response(null, { status: 204 }));
    expect(returnRoute("/day?date=2026-08-17#private")).toBe("/day?date=2026-08-17");
    expect(returnRoute("https://evil.example.test")).toBe("/day");
    expect(auth.signInUrl("/day?date=2026-08-17")).toBe(
      "/api/browser-auth/sign-in?returnTo=%2Fday%3Fdate%3D2026-08-17"
    );
  });
});
