import { randomUUID } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

const emptyHistory = { status: "not_requested", processedThroughDate: null, requestedAt: null, lastAttemptAt: null, completedAt: null, failureCode: null };
const preview = {
  expectedRevision: "revision-a", startsOn: "2026-11-21", timezone: "Europe/Moscow",
  startsAt: "2026-11-20T21:00:00.000Z", sourceDrainsUntil: "2026-12-04T21:00:00.000Z",
  sourceTailFromDate: "2026-11-07", capabilityVersion: "garmin-mapping-v1",
  gaps: [
    { capability: "recovery.hrv_rmssd", status: "unsupported", description: "not imported" },
    { capability: "recovery.sleep_score", status: "unsupported", description: "not imported" },
    { capability: "training.normalized_load", status: "unsupported", description: "not imported" }
  ]
};

function transition(state = "scheduled", version = 1) {
  return {
    id: "90000000-0000-4000-8000-000000000001", version, state,
    startsOn: preview.startsOn, timezone: preview.timezone, startsAt: preview.startsAt,
    sourceDrainsUntil: preview.sourceDrainsUntil, capabilityVersion: preview.capabilityVersion,
    acceptedCoverageGaps: preview.gaps.map((gap) => gap.capability),
    failureCode: state === "failed" ? "authorization_required" : null,
    sourceRevocationUnconfirmed: false, lastAttemptAt: null
  };
}

async function sourceSession(page: Page): Promise<void> {
  await page.route("**/api/browser-auth/session", (route) => route.fulfill({ status: 204, body: "" }));
  const shared = { recoveryConnectionId: null, failureCode: null, lastAttemptAt: null, lastSuccessfulSyncAt: null, lastDataAt: null, connectedAt: null, disconnectedAt: null, historicalImport: emptyHistory };
  await page.route(/\/api\/v1\/integrations\/garmin-intervals$/u, (route) => json(route, {
    ...shared, provider: "intervals_icu", displayName: "Garmin via Intervals.icu", lifecycle: "active", recoveryConnectionId: randomUUID()
  }));
  await page.route(/\/api\/v1\/integrations\/garmin-personal$/u, (route) => json(route, {
    ...shared, provider: "garmin_personal", displayName: "Garmin", lifecycle: "disconnected"
  }));
  await page.route("**/api/v1/integrations/garmin-personal/cutover/preview", (route) => json(route, preview));
}

test("transition requires every shown waiver and retains the key only in memory when coverage changes", async ({ context, page }) => {
  await sourceSession(page);
  const csrf = randomUUID();
  const apiKey = randomUUID();
  await context.addCookies([{ name: "__Host-shape_of_you_api_csrf", value: csrf, domain: "localhost", path: "/", secure: true, sameSite: "Lax" }]);
  let current: ReturnType<typeof transition> | null = null;
  await page.route(/\/api\/v1\/integrations\/garmin-personal\/cutover$/u, (route) => json(route, { cutover: current }));
  let schedules = 0;
  const updated = { ...preview, expectedRevision: "revision-b", gaps: [...preview.gaps, { capability: "training.original_fit", status: "unverified", description: apiKey }] };
  await page.route("**/api/v1/integrations/garmin-personal/cutover/schedule", async (route) => {
    schedules++;
    const body = route.request().postDataJSON();
    expect(route.request().headers()["x-csrf-token"]).toBe(csrf);
    expect(body.apiKey).toBe(apiKey);
    expect(body.consent).toBe(true);
    expect(typeof body.dedupeKey).toBe("string");
    if (schedules === 1) {
      expect(body.acceptedCoverageGaps).toEqual(preview.gaps.map((gap) => gap.capability));
      await json(route, { statusCode: 409, error: "coverage_changed", message: apiKey, details: { preview: updated } }, 409);
    } else {
      expect(body.expectedRevision).toBe("revision-b");
      expect(body.acceptedCoverageGaps).toEqual(updated.gaps.map((gap) => gap.capability));
      current = { ...transition(), acceptedCoverageGaps: body.acceptedCoverageGaps };
      await json(route, { cutover: current });
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/connections");
  const card = page.getByRole("article", { name: "Switch from Intervals to Garmin" });
  await card.getByRole("button", { name: "Plan transition", exact: true }).click();
  await expect(card.getByLabel("Start using direct Garmin data on")).toHaveValue(preview.startsOn);
  await expect(card).toContainText("14 calendar days");
  await expect(card).toContainText("calendar-date labels");
  const keyField = card.getByLabel("Garmin key for the transition");
  await keyField.fill(apiKey);
  const schedule = card.getByRole("button", { name: "Schedule transition", exact: true });
  await expect(schedule).toBeDisabled();
  for (const checkbox of await card.getByRole("checkbox").all()) {
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
  }
  await schedule.click();
  await expect(card.getByRole("alert")).toContainText("updated limitations");
  await expect(card.getByRole("alert")).not.toContainText(apiKey);
  await expect(keyField).toHaveValue(apiKey);
  await expect(card).toContainText("Original training details (FIT)");
  await expect(schedule).toBeDisabled();
  for (const checkbox of await card.getByRole("checkbox").all()) {
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
  }
  await schedule.click();
  await expect(card).toContainText("Scheduled for 2026-11-21");
  await expect(keyField).toHaveCount(0);
  expect(schedules).toBe(2);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.locator("body").innerText()).not.toContain(apiKey);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("failed transition retries the encrypted saved key without repaste, then can be cancelled before activation", async ({ page }) => {
  await sourceSession(page);
  let current = transition("failed", 3);
  await page.route(/\/api\/v1\/integrations\/garmin-personal$/u, (route) => json(route, {
    provider: "garmin_personal", displayName: "Garmin", recoveryConnectionId: randomUUID(),
    lifecycle: current.state === "cancelled" ? "disconnected" : "connecting", failureCode: null,
    lastAttemptAt: null, lastSuccessfulSyncAt: null, lastDataAt: null,
    connectedAt: null, disconnectedAt: null, historicalImport: emptyHistory
  }));
  await page.route(/\/api\/v1\/integrations\/garmin-personal\/cutover$/u, (route) => json(route, { cutover: current }));
  await page.route("**/api/v1/integrations/garmin-personal/cutover/retry", async (route) => {
    const body = route.request().postDataJSON();
    expect(body).not.toHaveProperty("apiKey");
    expect(body.expectedVersion).toBe(3);
    current = transition("scheduled", 4);
    await json(route, { cutover: current });
  });
  await page.route("**/api/v1/integrations/garmin-personal/cutover/cancel", async (route) => {
    expect(route.request().postDataJSON().expectedVersion).toBe(4);
    current = transition("cancelled", 5);
    await json(route, { cutover: current });
  });
  await page.goto("/connections");
  const card = page.getByRole("article", { name: "Switch from Intervals to Garmin" });
  const direct = page.getByRole("article", { name: "Garmin", exact: true });
  await expect(direct).toContainText("Garmin access is prepared.");
  await expect(direct.getByLabel("Garmin personal API key")).toHaveCount(0);
  await card.getByRole("button", { name: "Review retry", exact: true }).click();
  await expect(card.getByText("The saved Garmin key will be checked again.", { exact: false })).toBeVisible();
  await expect(card.getByLabel("Garmin key for the transition")).toHaveCount(0);
  for (const checkbox of await card.getByRole("checkbox").all()) await checkbox.check();
  await card.getByRole("button", { name: "Retry transition", exact: true }).click();
  await expect(card).toContainText("Scheduled for 2026-11-21");
  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "Cancel transition", exact: true }).click();
  await expect(card).toContainText("Transition cancelled.");
  await expect(card.getByLabel("Garmin key for the transition")).toHaveCount(0);
  await expect(direct.getByLabel("Garmin personal API key")).toBeVisible();
});

test("an uncertain schedule is checked through status instead of blindly submitting again", async ({ page }) => {
  await sourceSession(page);
  let current: ReturnType<typeof transition> | null = null;
  let schedules = 0;
  await page.route(/\/api\/v1\/integrations\/garmin-personal\/cutover$/u, (route) => json(route, { cutover: current }));
  await page.route("**/api/v1/integrations/garmin-personal/cutover/schedule", async (route) => {
    schedules++;
    current = transition();
    await route.abort();
  });
  await page.goto("/connections");
  const card = page.getByRole("article", { name: "Switch from Intervals to Garmin" });
  await card.getByRole("button", { name: "Plan transition", exact: true }).click();
  await card.getByLabel("Garmin key for the transition").fill(randomUUID());
  for (const checkbox of await card.getByRole("checkbox").all()) await checkbox.check();
  await card.getByRole("button", { name: "Schedule transition", exact: true }).click();
  await expect(card.getByRole("alert")).toContainText("could not be confirmed");
  await expect(card.getByRole("button", { name: "Schedule transition", exact: true })).toBeDisabled();
  await card.getByRole("button", { name: "Refresh transition status", exact: true }).click();
  await expect(card).toContainText("Scheduled for 2026-11-21");
  await expect(card.getByLabel("Garmin key for the transition")).toHaveCount(0);
  expect(schedules).toBe(1);
});

test("history shows the Garmin date scope and never offers retry for a stopped source job", async ({ page }) => {
  await sourceSession(page);
  const shared = { recoveryConnectionId: randomUUID(), failureCode: null, lastAttemptAt: null, lastSuccessfulSyncAt: null, lastDataAt: null, connectedAt: "2026-11-20T12:00:00.000Z", disconnectedAt: null };
  await page.route(/\/api\/v1\/integrations\/garmin-intervals$/u, (route) => json(route, {
    ...shared, provider: "intervals_icu", displayName: "Garmin via Intervals.icu", lifecycle: "active",
    historicalImport: { ...emptyHistory, status: "failed", failureCode: "cutover_source_stopped", scopeFromDate: "2000-01-01" }
  }));
  await page.route(/\/api\/v1\/integrations\/garmin-personal$/u, (route) => json(route, {
    ...shared, provider: "garmin_personal", displayName: "Garmin", lifecycle: "active",
    historicalImport: { ...emptyHistory, status: "completed", scopeFromDate: preview.startsOn, processedThroughDate: preview.startsOn, completedAt: "2026-11-22T12:00:00.000Z" }
  }));
  await page.route(/\/api\/v1\/integrations\/garmin-personal\/cutover$/u, (route) => json(route, { cutover: transition("draining") }));
  await page.goto("/connections");
  await expect(page.getByRole("button", { name: "Intervals history import stopped", exact: true })).toBeDisabled();
  const garmin = page.getByRole("article", { name: "Garmin", exact: true });
  await expect(garmin).toContainText("Garmin history begins on 2026-11-21");
  await expect(page.getByText("Unchecked older dates have not been marked complete.", { exact: false })).toBeVisible();
});

test("an old Intervals poll cannot overwrite source status refreshed after a cutover change", async ({ page }) => {
  await sourceSession(page);
  await page.clock.install();
  let current = transition("scheduled", 1);
  const source = {
    provider: "intervals_icu", displayName: "Garmin via Intervals.icu", lifecycle: "active",
    recoveryConnectionId: randomUUID(), failureCode: null, lastAttemptAt: null,
    lastSuccessfulSyncAt: null, lastDataAt: null, connectedAt: "2026-11-20T12:00:00.000Z",
    disconnectedAt: null, historicalImport: emptyHistory
  };
  let sourceStopped = false;
  let delayNext = false;
  let delayed: Route | undefined;
  await page.route(/\/api\/v1\/integrations\/garmin-intervals$/u, (route) => {
    if (delayNext) { delayNext = false; delayed = route; return; }
    return json(route, sourceStopped ? { ...source, lifecycle: "disconnected", disconnectedAt: "2026-12-04T21:00:00.000Z" } : source);
  });
  await page.route(/\/api\/v1\/integrations\/garmin-personal\/cutover$/u, (route) => json(route, { cutover: current }));
  await page.goto("/connections");
  await expect(page.getByRole("heading", { name: "active", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  delayNext = true;
  await page.clock.fastForward(30_000);
  await expect.poll(() => delayed !== undefined).toBe(true);

  current = transition("active", 2);
  sourceStopped = true;
  const card = page.getByRole("article", { name: "Switch from Intervals to Garmin" });
  await card.getByRole("button", { name: "Refresh transition status", exact: true }).click();
  await expect(page.getByRole("heading", { name: "disconnected", exact: true })).toBeVisible();
  const oldResponse = page.waitForResponse((response) => response.url().endsWith("/garmin-intervals"));
  await json(delayed!, source);
  await (await oldResponse).finished();
  await page.clock.runFor(100);
  await expect(page.getByRole("heading", { name: "disconnected", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "active", exact: true })).toHaveCount(0);
});

for (const state of ["failed", "active"]) {
  test(`restored transition requires operator recovery instead of key re-entry (${state})`, async ({ page }) => {
    await sourceSession(page);
    await page.route(/\/api\/v1\/integrations\/garmin-personal\/cutover$/u, (route) => json(route, {
      cutover: { ...transition(state), failureCode: "restore_suppressed" }
    }));
    await page.goto("/connections");
    const card = page.getByRole("article", { name: "Switch from Intervals to Garmin" });
    await expect(card).toContainText("Подключение остановлено после восстановления данных. Нужна проверка оператора.");
    await expect(card.getByRole("button", { name: "Review retry", exact: true })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Cancel transition", exact: true })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Plan transition", exact: true })).toHaveCount(0);
    await expect(card.getByLabel("Garmin key for the transition")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Refresh transition status", exact: true })).toBeEnabled();
  });
}

test("journal readiness failure keeps saved-key retry available after operator repair", async ({ page }) => {
  await sourceSession(page);
  await page.route(/\/api\/v1\/integrations\/garmin-personal\/cutover$/u, (route) => json(route, {
    cutover: { ...transition("failed"), failureCode: "journal_not_ready" }
  }));
  await page.goto("/connections");
  const card = page.getByRole("article", { name: "Switch from Intervals to Garmin" });
  await expect(card).toContainText("Переход ещё не защищён журналом восстановления. Старое подключение сохранено; нужна проверка оператора.");
  await card.getByRole("button", { name: "Review retry", exact: true }).click();
  await expect(card).toContainText("The saved Garmin key will be checked again.");
  await expect(card.getByLabel("Garmin key for the transition")).toHaveCount(0);
});
