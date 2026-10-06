import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { expect, test, type Page } from "@playwright/test";

import {
  IdentityAuthenticationError,
  identityCsrfCookieName,
  type OAuthBrowserSession
} from "../../src/authentication/service.js";
import {
  OAuthBrowserUi,
  type OAuthBrowserUiDependencies
} from "../../src/oauth/browser-ui.js";

const interactionCredential = "I".repeat(43);
const csrfToken = "C".repeat(43);
const session: OAuthBrowserSession = {
  accountId: "00000000-0000-4000-8000-000000000001",
  subject: "00000000-0000-4000-8000-000000000002",
  displayName: "Browser account",
  sessionId: "00000000-0000-4000-8000-000000000003",
  providerUid: "provider-session",
  authenticatedAt: new Date("2026-08-11T12:00:00.000Z"),
  acr: "urn:shape-of-you:acr:passkey",
  amr: ["passkey"]
};

interface BrowserFixture {
  readonly completionOrigin: string;
  readonly callbackOrigin: string;
  readonly callbackReferers: readonly string[];
  readonly close: () => Promise<void>;
  readonly decision: () => "allow" | "deny" | null;
  readonly origin: string;
  readonly submissionCount: () => number;
  readonly submissionOrigins: readonly string[];
  readonly verificationBodies: readonly Record<string, unknown>[];
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function startBrowserFixture(
  forceFreshPasskey = false,
  hasApplicationSession = true,
  chainedCallback = false,
  invalidReturnTo?: string
): Promise<BrowserFixture> {
  const completionServer = createServer((_request, response) => {
    response.end("<h1>App connected</h1>");
  });
  await listen(completionServer);
  const completionOrigin = `http://127.0.0.1:${(completionServer.address() as AddressInfo).port}`;
  const callbackReferers: string[] = [];
  const callbackServer = createServer((request, response) => {
    callbackReferers.push(request.headers.referer ?? "");
    if (chainedCallback) {
      response.writeHead(302, { location: `${completionOrigin}/complete` });
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<h1>Client callback</h1><p>${url.searchParams.toString()}</p>`);
  });
  await listen(callbackServer);
  const callbackOrigin = `http://127.0.0.1:${
    (callbackServer.address() as AddressInfo).port
  }`;

  const fixtureState: { browserUi?: OAuthBrowserUi } = {};
  let decision: "allow" | "deny" | null = null;
  let origin = "";
  let applicationSessionAvailable = hasApplicationSession;
  let submissionCount = 0;
  const submissionOrigins: string[] = [];
  const verificationBodies: Record<string, unknown>[] = [];
  const identityServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", origin || "http://localhost");
      if (request.method === "POST") submissionOrigins.push(request.headers.origin ?? "");
      if (url.pathname === `/oauth/authorize/${interactionCredential}`) {
        const callback = new URL("/client/callback", callbackOrigin);
        callback.searchParams.set(decision === "deny" ? "error" : "code",
          decision === "deny" ? "access_denied" : "browser-code");
        response.writeHead(303, { location: callback.toString() });
        response.end();
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/webauthn/authentication/options"
      ) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          challengeId: "00000000-0000-4000-8000-000000000010",
          options: { challenge: "Y2hhbGxlbmdl", allowCredentials: [] }
        }));
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/webauthn/authentication/verify"
      ) {
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        verificationBodies.push(
          JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
        );
        applicationSessionAvailable = true;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ csrfToken }));
        return;
      }
      if (await fixtureState.browserUi?.handle(request, response, url.pathname)) return;
      response.writeHead(404);
      response.end();
    } catch (error) {
      const status = error instanceof IdentityAuthenticationError ? error.statusCode : 500;
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify({
        error: "request_failed",
        message: error instanceof Error ? error.message : "Unknown fixture error"
      }));
    }
  });
  await listen(identityServer);
  origin = `http://localhost:${(identityServer.address() as AddressInfo).port}`;
  const authentication = {
    getOAuthBrowserSession: async () => {
      if (!applicationSessionAvailable) {
        throw new IdentityAuthenticationError(
          401,
          "authentication_required",
          "Authentication required"
        );
      }
      return session;
    },
    bindOAuthInteractionSession: async (input: { readonly csrfToken?: string }) => {
      submissionCount += 1;
      if (input.csrfToken !== csrfToken) {
        throw new IdentityAuthenticationError(401, "invalid_csrf", "CSRF token is invalid");
      }
      return session;
    }
  } as unknown as OAuthBrowserUiDependencies["authentication"];
  const runtime = {
    saveBrowserConsent: async (
      _request: unknown, _response: unknown,
      result: { readonly error?: string }
    ) => {
      decision = result.error === "access_denied" ? "deny" : "allow";
      return invalidReturnTo ?? `${origin}/oauth/authorize/${interactionCredential}`;
    },
    interactionDetails: async () => ({
      uid: interactionCredential,
      prompt: { name: forceFreshPasskey ? "login" : "consent" },
      params: {
        client_id: "browser-client",
        redirect_uri: `${callbackOrigin}/client/callback`,
        scope: "openid person:read",
        ...(forceFreshPasskey ? { prompt: "login", max_age: "0" } : {})
      }
    }),
    grantConsentScopes: async () => "00000000-0000-4000-8000-000000000004",
    finishInteraction: async (
      _request: unknown,
      response: {
        writeHead: (status: number, headers: Record<string, string>) => void;
        end: () => void;
      },
      result: { readonly consent?: unknown; readonly error?: string }
    ) => {
      decision = result.error === "access_denied" ? "deny" : "allow";
      const callback = new URL("/client/callback", callbackOrigin);
      if (decision === "deny") callback.searchParams.set("error", "access_denied");
      else callback.searchParams.set("code", "browser-code");
      response.writeHead(303, { location: callback.toString() });
      response.end();
    }
  } as unknown as OAuthBrowserUiDependencies["runtime"];
  fixtureState.browserUi = new OAuthBrowserUi({
    authentication,
    clients: {
      findProviderClient: async () => ({ client_name: "Browser client" }),
      isRefreshTokenEnabled: async () => true
    } as unknown as OAuthBrowserUiDependencies["clients"],
    publicOrigin: origin,
    resource: `${origin}/api/mcp`,
    runtime
  });
  return {
    completionOrigin,
    callbackOrigin,
    callbackReferers,
    close: () => Promise.all([close(identityServer), close(callbackServer), close(completionServer)]).then(() => undefined),
    decision: () => decision,
    origin,
    submissionCount: () => submissionCount,
    submissionOrigins,
    verificationBodies
  };
}

async function openConsent(page: Page, origin: string): Promise<void> {
  await page.context().addCookies([{
    name: identityCsrfCookieName,
    path: "/",
    secure: true,
    sameSite: "Lax",
    value: csrfToken,
    domain: "localhost"
  }]);
  await page.goto(`${origin}/oauth/interaction/${interactionCredential}`);
}

test("Allow posts the exact browser Origin once and reaches a CORS-free callback", async ({
  page
}) => {
  const fixture = await startBrowserFixture();
  try {
    await openConsent(page, fixture.origin);
    await expect(page.getByText("Keep this connection active")).toBeVisible();
    const duplicateGuard = await page.evaluate(() => {
      const form = document.querySelector<HTMLFormElement>("#consent")!;
      const first = form.dispatchEvent(new Event("submit", { cancelable: true }));
      const second = form.dispatchEvent(new Event("submit", { cancelable: true }));
      return { first, second };
    });
    expect(duplicateGuard).toEqual({ first: true, second: false });
    await page.reload();
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(page.getByRole("heading", { name: "Client callback" })).toBeVisible();
    await expect(page).toHaveURL(`${fixture.callbackOrigin}/client/callback?code=browser-code`);
    expect(fixture.submissionOrigins).toEqual([fixture.origin]);
    expect(fixture.submissionCount()).toBe(1);
    expect(fixture.decision()).toBe("allow");
    expect(fixture.callbackReferers).toEqual([""]);
  } finally {
    await fixture.close();
  }
});

test("Deny posts the exact browser Origin and returns cross-origin access_denied", async ({
  page
}) => {
  const fixture = await startBrowserFixture();
  try {
    await openConsent(page, fixture.origin);
    await page.getByRole("button", { name: "Deny" }).click();
    await expect(page.getByRole("heading", { name: "Client callback" })).toBeVisible();
    await expect(page).toHaveURL(
      `${fixture.callbackOrigin}/client/callback?error=access_denied`
    );
    expect(fixture.submissionOrigins).toEqual([fixture.origin]);
    expect(fixture.submissionCount()).toBe(1);
    expect(fixture.decision()).toBe("deny");
    expect(fixture.callbackReferers).toEqual([""]);
  } finally {
    await fixture.close();
  }
});

for (const action of ["Allow", "Deny"] as const) {
  test(`${action} reaches an app after a callback redirects to a third origin`, async ({ page }) => {
    const fixture = await startBrowserFixture(false, true, true);
    const cspErrors: string[] = [];
    page.on("console", (message) => {
      if (message.text().includes("form-action")) cspErrors.push(message.text());
    });
    try {
      await openConsent(page, fixture.origin);
      const handoffResponse = page.waitForResponse((response) =>
        response.request().method() === "POST" && response.url().endsWith("/consent"));
      await page.getByRole("button", { name: action }).click();
      const handoff = await handoffResponse;
      expect(handoff.status()).toBe(200);
      expect(handoff.headers()["cache-control"]).toBe("no-store");
      expect(handoff.headers()["referrer-policy"]).toBe("no-referrer");
      expect(handoff.headers()["content-security-policy"]).toContain("form-action 'self'");
      await expect(page.getByRole("heading", { name: "App connected" })).toBeVisible();
      await expect(page).toHaveURL(`${fixture.completionOrigin}/complete`);
      expect(fixture.submissionOrigins).toEqual([fixture.origin]);
      expect(fixture.submissionCount()).toBe(1);
      expect(fixture.decision()).toBe(action.toLowerCase());
      expect(fixture.callbackReferers).toEqual([""]);
      expect(cspErrors).toEqual([]);
    } finally {
      await fixture.close();
    }
  });
}

test("native consent without JavaScript offers a GET link through the chained callback", async ({ browser }) => {
  const fixture = await startBrowserFixture(false, true, true);
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await openConsent(page, fixture.origin);
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(page.getByText("Returning to your app…")).toBeVisible();
    await page.getByRole("link", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "App connected" })).toBeVisible();
    expect(fixture.submissionCount()).toBe(1);
    expect(fixture.callbackReferers).toEqual([""]);
  } finally {
    await context.close();
    await fixture.close();
  }
});

for (const returnTo of [
  "https://attacker.example.test/oauth/authorize/" + interactionCredential,
  "/oauth/authorize/" + interactionCredential + "?code=untrusted",
  "/oauth/authorize/" + interactionCredential + "#fragment",
  "/other/../oauth/authorize/" + interactionCredential,
  "/oauth/authorize/short",
  "javascript:alert(1)"
]) {
  test(`consent rejects an invalid provider resume target ${returnTo}`, async ({ page }) => {
    const fixture = await startBrowserFixture(false, true, false, returnTo);
    try {
      await openConsent(page, fixture.origin);
      const failedResponse = page.waitForResponse((response) =>
        response.request().method() === "POST" && response.url().endsWith("/consent"));
      await page.getByRole("button", { name: "Allow" }).click();
      expect((await failedResponse).status()).toBe(500);
      expect(fixture.callbackReferers).toEqual([]);
      expect(fixture.submissionCount()).toBe(1);
      expect(new URL(page.url()).origin).toBe(fixture.origin);
    } finally {
      await fixture.close();
    }
  });
}

test("prompt=login and max_age=0 ignores an existing session and requires a passkey", async ({
  page
}) => {
  const fixture = await startBrowserFixture(true);
  try {
    await openConsent(page, fixture.origin);
    await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue as/u })).toHaveCount(0);
  } finally {
    await fixture.close();
  }
});

test("consent without an application session offers passkey sign-in instead of returning JSON", async ({
  page
}) => {
  const fixture = await startBrowserFixture(false, false);
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "credentials", {
        configurable: true,
        value: {
          get: async () => ({
            id: "credential",
            rawId: new Uint8Array([1]).buffer,
            type: "public-key",
            response: {
              authenticatorData: new Uint8Array([2]).buffer,
              clientDataJSON: new Uint8Array([3]).buffer,
              signature: new Uint8Array([4]).buffer,
              userHandle: null
            },
            getClientExtensionResults: () => ({}),
            authenticatorAttachment: "platform"
          })
        }
      });
    });
    await openConsent(page, fixture.origin);
    await expect(page.getByRole("heading", { name: "Authorize access" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Authentication required");
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(page.getByRole("button", { name: "Allow" })).toBeVisible();
    expect(fixture.verificationBodies).toHaveLength(1);
    expect(fixture.verificationBodies[0]?.oauthInteractionCredential).toBe(
      interactionCredential
    );
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(page.getByRole("heading", { name: "Client callback" })).toBeVisible();
    expect(fixture.decision()).toBe("allow");
  } finally {
    await fixture.close();
  }
});
