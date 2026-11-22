import { randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

const disconnected = {
  provider: "garmin_personal", displayName: "Garmin", recoveryConnectionId: null,
  lifecycle: "disconnected", failureCode: null, lastAttemptAt: null,
  lastSuccessfulSyncAt: null, lastDataAt: null, connectedAt: null, disconnectedAt: null,
  historicalImport: { status: "not_requested", processedThroughDate: null, requestedAt: null, lastAttemptAt: null, completedAt: null, failureCode: null }
};

async function session(page: Page): Promise<void> {
  await page.route("**/api/browser-auth/session", (route) => route.fulfill({ status: 204, body: "" }));
}

for (const lifecycle of ["active", "degraded"] as const) {
  test(`Garmin-only ${lifecycle} connection has a readable responsive layout and no legacy requests`, async ({ page }) => {
    await session(page);
    await page.clock.install();
    const legacyRequests: string[] = [];
    page.on("request", (request) => {
      if (/garmin-intervals|\/cutover/u.test(request.url())) legacyRequests.push(request.url());
    });
    await page.route(/\/api\/v1\/integrations\/garmin-personal$/u, (route) => json(route, {
      ...disconnected, lifecycle, recoveryConnectionId: randomUUID(),
      failureCode: lifecycle === "degraded" ? "authorization_required" : null,
      connectedAt: "2026-11-21T12:00:00.000Z", lastSuccessfulSyncAt: "2026-11-21T12:30:00.000Z",
      lastAttemptAt: "2026-11-21T12:35:00.000Z", lastDataAt: "2026-11-21T12:25:00.000Z"
    }));
    await page.goto("/connections");
    const card = page.getByRole("article", { name: "Garmin", exact: true });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connections");
    await expect(card.getByRole("status")).toContainText(lifecycle === "active" ? "syncs automatically" : "Update your Garmin API key");
    await expect(page.locator("main")).not.toContainText(/Intervals|transition|cutover/iu);
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await page.evaluate(() => {
        const header = document.querySelector(".site-header")!.getBoundingClientRect();
        const heading = document.querySelector(".connections-heading")!.getBoundingClientRect();
        const card = document.querySelector(".garmin-connection")!.getBoundingClientRect();
        const details = document.querySelector(".garmin-sync-details")!.getBoundingClientRect();
        const status = document.querySelector("[role=status]")!.getBoundingClientRect();
        return { topGap: heading.top - header.bottom, cardGap: card.top - heading.bottom,
          detailsGap: details.top - status.bottom, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(layout.topGap).toBeGreaterThanOrEqual(24);
      expect(layout.topGap).toBeLessThanOrEqual(40);
      expect(layout.cardGap).toBeGreaterThanOrEqual(24);
      expect(layout.detailsGap).toBeGreaterThanOrEqual(16);
      expect(layout.overflow).toBe(false);
      await page.screenshot({ path: join(tmpdir(), `task0184-connections-${lifecycle}-${width}.png`), fullPage: true });
    }
    await page.clock.fastForward(30_000);
    expect(legacyRequests).toEqual([]);
    await page.route("**/api/browser-auth/recovery-erasure/start", (route) => json(route, { authorizationUrl: "/confirm-erasure" }));
    await card.getByRole("button", { name: "Delete Garmin imported data…" }).click();
    await expect(page).toHaveURL(/\/confirm-erasure$/u);
  });
}

test("a new user connects an empty Garmin account with one submit and no browser persistence", async ({ context, page }) => {
  await session(page);
  const csrf = randomBytes(32).toString("base64url");
  const apiKey = randomBytes(32).toString("base64url");
  await context.addCookies([{ name: "__Host-shape_of_you_api_csrf", value: csrf, domain: "localhost", path: "/", secure: true, sameSite: "Lax" }]);
  let connected = false;
  const active = { ...disconnected, lifecycle: "active", recoveryConnectionId: randomUUID(), connectedAt: "2026-11-20T12:00:00.000Z", sync: { state: "queued", nextAttemptAt: "2026-11-20T12:00:00.000Z" } };
  await page.route(/\/api\/v1\/integrations\/garmin-personal$/u, (route) => json(route, connected ? active : disconnected));
  let submissions = 0;
  await page.route("**/api/v1/integrations/garmin-personal/connect", async (route) => {
    submissions++;
    expect(route.request().headers()["x-csrf-token"]).toBe(csrf);
    expect(route.request().postDataJSON()).toEqual({ apiKey, consent: true });
    expect(route.request().url()).not.toContain(apiKey);
    connected = true;
    await json(route, active);
  });
  await page.route("**/api/v1/integrations/garmin-personal/historical-import", async (route) => {
    expect(route.request().headers()["x-csrf-token"]).toBe(csrf);
    expect(route.request().postData()).toBeNull();
    await json(route, { ...active, historicalImport: { ...active.historicalImport, status: "running" } });
  });
  await page.route("**/api/v1/integrations/garmin-personal/disconnect", async (route) => {
    expect(route.request().headers()["x-csrf-token"]).toBe(csrf);
    expect(route.request().postDataJSON()).toEqual({ reason: "user requested disconnect" });
    connected = false;
    await json(route, { ...disconnected, recoveryConnectionId: active.recoveryConnectionId, connectedAt: active.connectedAt });
  });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/connections");
  const card = page.getByRole("article", { name: "Garmin", exact: true });
  const field = card.getByLabel("Garmin personal API key");
  await expect(field).toHaveAttribute("type", "password");
  await expect(field).toHaveAttribute("autocomplete", "off");
  await expect(card.getByRole("link", { name: "Create a personal API key in Garmin" })).toHaveAttribute("rel", "noreferrer noopener");
  await expect(page.locator("main")).not.toContainText(/Intervals|transition|cutover/iu);
  await page.screenshot({ path: join(tmpdir(), "task0184-connections-new-user-320.png"), fullPage: true });
  await field.fill(apiKey);
  await card.getByRole("button", { name: "Connect Garmin", exact: true }).click();
  await expect(card.getByRole("status")).toHaveText("Connected. Waiting to sync with Garmin…");
  expect(submissions).toBe(1);
  await card.getByRole("button", { name: "Update Garmin key", exact: true }).click();
  await expect(field).toHaveValue("");
  await field.fill(apiKey);
  await card.getByRole("button", { name: "Cancel", exact: true }).click();
  await card.getByRole("button", { name: "Update Garmin key", exact: true }).click();
  await expect(field).toHaveValue("");
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.locator("body").innerText()).not.toContain(apiKey);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await card.getByRole("button", { name: "Cancel", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "Import Garmin history…", exact: true }).click();
  await expect(card.getByRole("button", { name: "Importing Garmin history…", exact: true })).toBeDisabled();
  await card.getByRole("button", { name: "Disconnect Garmin", exact: true }).click();
  await expect(card.getByText("Garmin is not connected.", { exact: true })).toBeVisible();
  await expect(card.getByLabel("Garmin personal API key")).toHaveValue("");
  await expect(card.getByRole("button", { name: "Delete Garmin imported data…", exact: true })).toBeVisible();
});

test("Garmin key rejection stays safe and offers retry without an extra verification step", async ({ page }) => {
  await session(page);
  await page.route(/\/api\/v1\/integrations\/garmin-personal$/u, (route) => json(route, disconnected));
  const apiKey = randomBytes(32).toString("base64url");
  await page.route("**/api/v1/integrations/garmin-personal/connect", (route) => json(route, { message: apiKey }, 409));
  await page.goto("/connections");
  const card = page.getByRole("article", { name: "Garmin", exact: true });
  await card.getByLabel("Garmin personal API key").fill(apiKey);
  await card.getByRole("button", { name: "Connect Garmin", exact: true }).click();
  await expect(card.getByRole("alert")).toContainText("retained history");
  await expect(card.getByRole("alert")).not.toContainText(apiKey);
  await expect(card.getByRole("button", { name: "Connect Garmin", exact: true })).toBeEnabled();
  await card.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(card.getByLabel("Garmin personal API key")).toHaveValue("");
});

test("delayed Garmin polling cannot overwrite newer connect or disconnect results", async ({ page }) => {
  await session(page);
  await page.clock.install();
  const active = { ...disconnected, lifecycle: "active", recoveryConnectionId: randomUUID(), connectedAt: "2026-11-20T12:00:00.000Z" };
  let reads = 0;
  const delayed: Route[] = [];
  await page.route(/\/api\/v1\/integrations\/garmin-personal$/u, (route) => {
    reads++;
    if (reads === 1) return json(route, disconnected);
    delayed.push(route);
  });
  await page.route("**/api/v1/integrations/garmin-personal/connect", (route) => json(route, active));
  await page.route("**/api/v1/integrations/garmin-personal/disconnect", (route) => json(route, {
    ...disconnected, recoveryConnectionId: active.recoveryConnectionId, connectedAt: active.connectedAt
  }));
  await page.goto("/connections");
  const card = page.getByRole("article", { name: "Garmin", exact: true });
  await expect(card.getByLabel("Garmin personal API key")).toBeVisible();

  await page.clock.fastForward(30_000);
  await expect.poll(() => delayed.length).toBe(1);
  await card.getByLabel("Garmin personal API key").fill(randomBytes(32).toString("base64url"));
  await card.getByRole("button", { name: "Connect Garmin", exact: true }).click();
  await expect(card.getByRole("status")).toHaveText("Connected, no data yet.");
  const staleConnectResponse = page.waitForResponse((response) => response.url().endsWith("/garmin-personal"));
  await json(delayed.shift()!, disconnected);
  await (await staleConnectResponse).finished();
  await page.clock.runFor(100);
  await expect(card.getByRole("status")).toHaveText("Connected, no data yet.");
  await expect(card.getByRole("button", { name: "Connect Garmin", exact: true })).toHaveCount(0);

  await page.clock.fastForward(30_000);
  await expect.poll(() => delayed.length).toBe(1);
  await card.getByRole("button", { name: "Disconnect Garmin", exact: true }).click();
  await expect(card.getByText("Garmin is not connected.", { exact: true })).toBeVisible();
  const staleDisconnectResponse = page.waitForResponse((response) => response.url().endsWith("/garmin-personal"));
  await json(delayed.shift()!, active);
  await (await staleDisconnectResponse).finished();
  await page.clock.runFor(100);
  await expect(card.getByText("Garmin is not connected.", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Disconnect Garmin", exact: true })).toHaveCount(0);
  await expect(card.getByLabel("Garmin personal API key")).toHaveValue("");
});
