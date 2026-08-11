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
  readonly callbackOrigin: string;
  readonly callbackReferers: readonly string[];
  readonly close: () => Promise<void>;
  readonly decision: () => "allow" | "deny" | null;
  readonly origin: string;
  readonly submissionCount: () => number;
  readonly submissionOrigins: readonly string[];
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

async function startBrowserFixture(): Promise<BrowserFixture> {
  const callbackReferers: string[] = [];
  const callbackServer = createServer((request, response) => {
    callbackReferers.push(request.headers.referer ?? "");
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
  let submissionCount = 0;
  const submissionOrigins: string[] = [];
  const identityServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", origin || "http://localhost");
      if (request.method === "POST") submissionOrigins.push(request.headers.origin ?? "");
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
    getOAuthBrowserSession: async () => session,
    bindOAuthInteractionSession: async (input: { readonly csrfToken?: string }) => {
      submissionCount += 1;
      if (input.csrfToken !== csrfToken) {
        throw new IdentityAuthenticationError(401, "invalid_csrf", "CSRF token is invalid");
      }
      return session;
    }
  } as unknown as OAuthBrowserUiDependencies["authentication"];
  const runtime = {
    interactionDetails: async () => ({
      uid: interactionCredential,
      prompt: { name: "consent" },
      params: {
        client_id: "browser-client",
        redirect_uri: `${callbackOrigin}/client/callback`,
        scope: "openid person:read"
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
      findProviderClient: async () => ({ client_name: "Browser client" })
    } as unknown as OAuthBrowserUiDependencies["clients"],
    publicOrigin: origin,
    resource: `${origin}/api/mcp`,
    runtime
  });
  return {
    callbackOrigin,
    callbackReferers,
    close: () => Promise.all([close(identityServer), close(callbackServer)]).then(() => undefined),
    decision: () => decision,
    origin,
    submissionCount: () => submissionCount,
    submissionOrigins
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
