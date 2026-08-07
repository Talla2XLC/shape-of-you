import { describe, expect, it, vi } from "vitest";

import { createIdentityApi, IdentityApiError } from "../app/lib/identity-api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("Identity API client", () => {
  it("sends enrollment authority only in the Authorization header", async () => {
    const token = "D".repeat(43);
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({ challengeId: "challenge", options: { challenge: "safe" } })
    );
    const api = createIdentityApi(fetcher);

    await api.registrationOptions({ bearer: token });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/v1/webauthn/registration/options");
    expect(url).not.toContain(token);
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${token}`);
    expect(init.credentials).toBe("same-origin");
  });

  it("adds the session-bound CSRF header to mutations", async () => {
    const csrf = "E".repeat(43);
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ id: "credential", label: "Phone" }));
    const api = createIdentityApi(fetcher);

    await api.renamePasskey("00000000-0000-4000-8000-000000000001", "Phone", csrf);

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("x-csrf-token")).toBe(csrf);
  });

  it("exposes only bounded status and code for rejected requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({ error: "invalid_origin", message: "sensitive backend detail" }, 403)
    );
    const api = createIdentityApi(fetcher);

    const error = await api.listSessions().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(IdentityApiError);
    expect(error).toMatchObject({ status: 403, code: "invalid_origin" });
    expect(String(error)).not.toContain("sensitive backend detail");
  });
});
