import { randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

const initial = {
  provider: "garmin_personal", displayName: "Garmin", lifecycle: "active", recoveryConnectionId: randomUUID(),
  connectedAt: "2026-11-22T10:00:00.000Z", disconnectedAt: null, failureCode: null,
  lastAttemptAt: "2026-11-22T10:00:00.000Z", lastSuccessfulSyncAt: "2026-11-22T10:00:00.000Z", lastDataAt: "2026-11-22T10:00:00.000Z",
  sync: { state: "scheduled", nextAttemptAt: "2026-11-22T10:05:00.000Z" },
  historicalImport: { status: "completed", processedThroughDate: "2000-01-01", requestedAt: "2026-11-21T10:00:00.000Z",
    lastAttemptAt: null, completedAt: "2026-11-21T11:00:00.000Z", failureCode: null }
};
const json = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
async function session(page: Page) {
  await page.route("**/api/browser-auth/session", (route) => route.fulfill({ status: 204, body: "" }));
  await page.clock.install();
}

test("an older API projection never guesses manual sync availability during rollout", async ({ page }) => {
  await session(page);
  const older = Object.fromEntries(Object.entries(initial).filter(([key]) => key !== "sync"));
  await page.route(/\/api\/v1\/integrations\/garmin-personal$/u, (route) => json(route, older));
  await page.goto("/connections");
  await expect(page.getByRole("button", { name: "Sync now", exact: true })).toBeDisabled();
  await expect(page.locator("#garmin-sync-progress")).toContainText("temporarily unavailable");
});

test("Sync now sends one keyless request, shows real queue/worker/completion and survives reload", async ({ context, page }) => {
  await session(page);
  const csrf = randomBytes(32).toString("base64url");
  await context.addCookies([{ name: "__Host-shape_of_you_api_csrf", value: csrf, domain: "localhost", path: "/", secure: true, sameSite: "Lax" }]);
  let phase = "scheduled";
  const snapshot = () => ({ ...initial,
    ...(phase === "done" ? { lastAttemptAt: "2026-11-22T10:01:00.000Z", lastSuccessfulSyncAt: "2026-11-22T10:01:00.000Z" } : {}),
    sync: { state: phase === "done" ? "scheduled" : phase, nextAttemptAt: initial.sync.nextAttemptAt }
  });
  await page.route(/\/api\/v1\/integrations\/garmin-personal$/u, (route) => json(route, snapshot()));
  let requests = 0;
  await page.route("**/api/v1/integrations/garmin-personal/sync", (route) => {
    requests++;
    expect(route.request().method()).toBe("POST");
    expect(route.request().postData()).toBeNull();
    expect(route.request().headers()["x-csrf-token"]).toBe(csrf);
    phase = "queued";
    return json(route, snapshot(), 202);
  });
  await page.goto("/connections");
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sync requested…", exact: true })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("Waiting to sync");
  expect(requests).toBe(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Sync requested…", exact: true })).toBeDisabled();
  phase = "running";
  await page.clock.fastForward(5_000);
  await expect(page.getByRole("button", { name: "Syncing…", exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(tmpdir(), "task0185-sync-running-320.png"), fullPage: true });
  phase = "done";
  await page.clock.fastForward(5_000);
  await expect(page.getByRole("button", { name: "Sync now", exact: true })).toBeEnabled();
  expect(requests).toBe(1);
  await expect(page.locator(".garmin-sync-details")).toContainText("2026");
});

test("Sync now reports attempt failure and rejects stale polling without inventing success", async ({ page }) => {
  await session(page);
  let reads = 0;
  let queued = false;
  let finished = false;
  let stale: Route | undefined;
  await page.route(/\/api\/v1\/integrations\/garmin-personal$/u, (route) => {
    reads++;
    if (reads === 2) { stale = route; return; }
    return json(route, finished ? { ...initial, lifecycle: "degraded", failureCode: "provider_timeout", lastAttemptAt: "2026-11-22T10:01:00.000Z" }
      : queued ? { ...initial, sync: { ...initial.sync, state: "queued" } } : initial);
  });
  await page.route("**/api/v1/integrations/garmin-personal/sync", (route) => {
    queued = true;
    return json(route, { ...initial, sync: { ...initial.sync, state: "queued" } }, 202);
  });
  await page.goto("/connections");
  await expect(page.getByRole("button", { name: "Sync now", exact: true })).toBeEnabled();
  await page.clock.fastForward(30_000);
  await expect.poll(() => Boolean(stale)).toBe(true);
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Waiting to sync");
  const staleResponse = page.waitForResponse((response) => response.url().endsWith("/garmin-personal"));
  await json(stale!, initial);
  await (await staleResponse).finished();
  await page.clock.runFor(100);
  await expect(page.getByRole("button", { name: "Sync requested…", exact: true })).toBeDisabled();
  finished = true;
  await page.clock.fastForward(5_000);
  await expect(page.locator("#garmin-sync-progress")).toContainText("Sync did not complete");
  await expect(page.locator("main")).not.toContainText("Sync completed successfully");
});

test("Sync now confirms success only after a newer successful attempt and keeps uncertain errors safe", async ({ page }) => {
  await session(page);
  let done = false;
  await page.route(/\/api\/v1\/integrations\/garmin-personal$/u, (route) => json(route, done
    ? { ...initial, lastAttemptAt: "2026-11-22T10:01:00.000Z", lastSuccessfulSyncAt: "2026-11-22T10:01:00.000Z" } : initial));
  await page.route("**/api/v1/integrations/garmin-personal/sync", (route) => json(route, { ...initial, sync: { ...initial.sync, state: "queued" } }, 202));
  await page.goto("/connections");
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Waiting to sync");
  await expect(page.locator("#garmin-sync-progress")).not.toContainText("completed successfully");
  done = true;
  await page.clock.fastForward(5_000);
  await expect(page.locator("#garmin-sync-progress")).toHaveText("Sync completed successfully.");
  await page.route("**/api/v1/integrations/garmin-personal/sync", (route) => json(route, { message: "unsafe-provider-detail" }, 503));
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("could not be confirmed");
  await expect(page.locator("main")).not.toContainText("unsafe-provider-detail");
  await expect(page.locator("#garmin-sync-progress")).not.toContainText("completed successfully");
});
