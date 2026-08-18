import { randomBytes, randomUUID } from "node:crypto";

import { expect, test, type Page, type Route } from "@playwright/test";

const rpId = "localhost";

function opaqueValue(): string {
  return randomBytes(32).toString("base64url");
}

async function addVirtualPasskeyAuthenticator(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("WebAuthn.enable");
  await session.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true
    }
  });
}

function registrationOptions() {
  return {
    challengeId: randomUUID(),
    options: {
      rp: { id: rpId, name: "Shape of You" },
      user: {
        id: opaqueValue(),
        name: randomUUID(),
        displayName: "Test account"
      },
      challenge: opaqueValue(),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      timeout: 60_000,
      attestation: "none",
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required"
      },
      excludeCredentials: []
    }
  };
}

function authenticationOptions() {
  return {
    challengeId: randomUUID(),
    options: {
      challenge: opaqueValue(),
      rpId,
      timeout: 60_000,
      userVerification: "required",
      allowCredentials: []
    }
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

async function mockApiSession(page: Page, status: 204 | 401): Promise<void> {
  await page.route("**/api/browser-auth/session", (route) =>
    route.fulfill({ status, headers: { "cache-control": "no-store" }, body: "" })
  );
}

test("landing starts the API-owned browser authorization flow", async ({ page }) => {
  await mockApiSession(page, 401);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Your signals/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with a passkey" })).toHaveAttribute(
    "href",
    "/api/browser-auth/sign-in?returnTo=%2Fprogress"
  );
});

test("landing offers progress when the API session is active", async ({ page }) => {
  await mockApiSession(page, 204);
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Open progress" })).toHaveAttribute("href", "/progress");
  await expect(page.getByRole("link", { name: "Continue with a passkey" })).toHaveCount(0);
});

test("landing passkey explanation is a reversible disclosure", async ({ page }) => {
  await mockApiSession(page, 401);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const disclosure = page.locator('[aria-controls="passkey-explanation"]');
  const explanation = page.getByRole("region", { name: "Why Shape of You uses passkeys" });

  await expect(disclosure).toHaveRole("button");
  await expect(disclosure).toHaveAccessibleName("Why passkeys?");
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(explanation).toBeHidden();
  await disclosure.click();
  await expect(disclosure).toHaveAccessibleName("Hide passkey details");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(explanation).toBeVisible();
  await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(explanation).toBeHidden();
  expect(await page.evaluate(() => location.hash)).toBe("");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true);
});

test("landing keeps keyboard focus, reduced motion, and mobile width usable", async ({ page }) => {
  await mockApiSession(page, 401);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true);
  const brand = page.getByRole("link", { name: "Shape of You home" });
  const myDay = page.getByRole("banner").getByRole("link", { name: "Progress" });
  const continueLink = page.getByRole("link", { name: "Continue with a passkey" });
  await expect(continueLink).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(brand).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(myDay).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(continueLink).toBeFocused();
  await page.keyboard.press("Tab");
  const disclosure = page.locator('[aria-controls="passkey-explanation"]');
  const explanation = page.getByRole("region", { name: "Why Shape of You uses passkeys" });
  await expect(disclosure).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(explanation).toBeVisible();
  await page.keyboard.press("Space");
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(explanation).toBeHidden();

  const transitionSeconds = await disclosure.locator(".disclosure-indicator").evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).transitionDuration)
  );
  expect(transitionSeconds).toBeLessThanOrEqual(0.001);
});

test("protected dated day route starts sign-in with its path and query", async ({ page }) => {
  await mockApiSession(page, 401);
  await page.goto("/days/2026-08-17?timezone=Europe%2FMoscow");

  await expect(page).toHaveURL(/\/api\/browser-auth\/sign-in\?/);
  const signInUrl = new URL(page.url());
  expect(signInUrl.pathname).toBe("/api/browser-auth/sign-in");
  expect(signInUrl.searchParams.get("returnTo")).toBe(
    "/days/2026-08-17?timezone=Europe/Moscow"
  );
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test("day layout remains content-sized across phone, tablet, and desktop", async ({ page }) => {
  await mockApiSession(page, 204);
  await page.route("**/api/v1/day-projections?*", (route) =>
    fulfillJson(route, {
      localDate: "2026-08-17",
      timezone: "Europe/Moscow",
      state: "open",
      closure: null,
      isStale: false,
      snapshot: {
        physical: { weightMeasurements: [{ weightKg: 77.7 }] },
        nutrition: { totals: { mealCount: 0, caloriesKcal: 0 } }
      }
    })
  );
  await page.route("**/api/v1/day-closures/history?*", (route) =>
    fulfillJson(route, { items: [] })
  );

  for (const viewport of [
    { width: 320, height: 720 },
    { width: 768, height: 1_024 },
    { width: 1_440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/days/2026-08-17?timezone=Europe%2FMoscow");
    await expect(page.getByRole("heading", { name: "Your day, with its context intact." })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const headingSize = await page.locator(".day-heading").evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize)
    );
    expect(headingSize).toBeLessThanOrEqual(viewport.width <= 320 ? 52 : 87);
    const card = page.locator(".day-card").first();
    const cardBox = await card.boundingBox();
    const copyBox = await card.locator(".signal-copy").boundingBox();
    expect(cardBox).not.toBeNull();
    expect(copyBox).not.toBeNull();
    expect(cardBox!.height - copyBox!.height).toBeLessThan(70);
  }
});

test("progress renders sparse facts and dated drill-down without exact-day fanout", async ({ page }) => {
  await mockApiSession(page, 204);
  let overviewReads = 0;
  const overviewUrls: string[] = [];
  let dayReads = 0;
  await page.route("**/api/v1/progress-overview?*", (route) => {
    overviewReads += 1;
    overviewUrls.push(route.request().url());
    return fulfillJson(route, {
      from: "2026-07-20", to: "2026-08-18", timezone: "UTC", metricSetVersion: "progress-metrics-v1",
      metrics: [
        { key: "weight_kg", label: "Weight", unit: "kg", points: [{ localDate: "2026-08-16", value: 78.2 }, { localDate: "2026-08-18", value: 77.8 }] },
        { key: "calories_kcal", label: "Calories", unit: "kcal", points: [] },
        { key: "protein_g", label: "Protein", unit: "g", points: [] },
        { key: "workout_session_count", label: "Workout sessions", unit: "sessions", points: [] },
        { key: "readiness_score", label: "Readiness", unit: "score", points: [] }
      ],
      days: [{ localDate: "2026-08-18", facts: { weightMeasurements: 1 } }, { localDate: "2026-08-16", facts: { weightMeasurements: 1 } }]
    });
  });
  await page.route("**/api/v1/day-projections?*", (route) => { dayReads += 1; return route.abort(); });
  await page.goto("/progress");
  await expect(page.getByRole("heading", { name: "Your shape, over time." })).toBeVisible();
  const browserTimezone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  await expect(page.getByRole("link", { name: /August 18, 2026/ })).toHaveAttribute(
    "href",
    "/days/2026-08-18?timezone=" + encodeURIComponent(browserTimezone)
  );
  await expect(page.getByLabel("Selected metric values")).toContainText("2026-08-18: 77.8 kg");
  await page.getByRole("combobox", { name: "Metric" }).selectOption("calories_kcal");
  await expect(page.getByText("No entries").first()).toBeVisible();
  await page.getByRole("button", { name: "Week" }).click();
  await Promise.all([
    expect.poll(() => overviewReads).toBe(3),
    page.getByRole("button", { name: "Year" }).click()
  ]);
  expect(overviewUrls.some((url) => url.includes("from=2026-08-12"))).toBe(true);
  expect(overviewUrls.some((url) => url.includes("from=2025-08-19"))).toBe(true);
  expect(dayReads).toBe(0);
});

test("legacy day query safely replaces itself with the canonical dated route", async ({ page }) => {
  await mockApiSession(page, 204);
  await page.route("**/api/v1/day-projections?*", (route) => fulfillJson(route, { localDate: "2026-08-17", timezone: "Europe/Moscow", state: "open", closure: null, isStale: false, snapshot: { physical: { weightMeasurements: [] }, nutrition: { totals: { mealCount: 0, caloriesKcal: 0 } } } }));
  await page.route("**/api/v1/day-closures/history?*", (route) => fulfillJson(route, { items: [] }));
  await page.goto("/day?date=2026-08-17&timezone=Europe%2FMoscow&returnTo=https%3A%2F%2Fevil.test#private");
  await expect(page).toHaveURL(/\/days\/2026-08-17\?timezone=Europe(?:%2F|\/)Moscow$/);
});

test("dated page reloads exact-day facts when the route date changes", async ({ page }) => {
  await mockApiSession(page, 204);
  const requestedDates: string[] = [];
  await page.route("**/api/v1/day-projections?*", (route) => {
    const date = new URL(route.request().url()).searchParams.get("localDate")!;
    requestedDates.push(date);
    return fulfillJson(route, { localDate: date, timezone: "Europe/Moscow", state: "open", closure: null, isStale: false, snapshot: { physical: { weightMeasurements: [{ weightKg: date === "2026-08-18" ? 78 : 79 }] }, nutrition: { totals: { mealCount: 0, caloriesKcal: 0 } } } });
  });
  await page.route("**/api/v1/day-closures/history?*", (route) => fulfillJson(route, { items: [] }));
  await page.goto("/days/2026-08-17?timezone=Europe%2FMoscow");
  await page.getByLabel("Date").fill("2026-08-18");
  await page.getByLabel("Date").dispatchEvent("change");
  await expect(page).toHaveURL(/\/days\/2026-08-18/);
  await expect(page.getByText("78", { exact: true })).toBeVisible();
  expect(requestedDates).toEqual(["2026-08-17", "2026-08-18"]);
});

test("invalid dated route does not issue domain reads", async ({ page }) => {
  await mockApiSession(page, 204);
  let domainReads = 0;
  await page.route("**/api/v1/day-*", (route) => { domainReads += 1; return route.abort(); });
  await page.goto("/days/2026-02-30?timezone=Mars%2FOlympus&extra=discarded");
  await expect(page.getByRole("alert")).toHaveText("Choose a valid calendar date.");
  expect(domainReads).toBe(0);
});

test("access-required explains an unlinked account without credential details", async ({ page }) => {
  await page.goto("/access-required");
  await expect(page.getByRole("heading", { name: "This account is not linked yet." })).toBeVisible();
  await expect(page.getByText("No fitness data was changed.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Return home" })).toHaveAttribute("href", "/");
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test("enrollment strips the fragment and sends the bearer only as authority", async ({ page }) => {
  await addVirtualPasskeyAuthenticator(page);
  const bearer = opaqueValue();
  const requestUrls: string[] = [];
  page.on("request", (request) => requestUrls.push(request.url()));

  await page.route("**/v1/webauthn/registration/options", async (route) => {
    expect(page.url()).not.toContain("#");
    const headers = route.request().headers();
    expect(headers.authorization?.startsWith("Bearer ")).toBe(true);
    expect(headers.authorization === `Bearer ${bearer}`).toBe(true);
    expect(headers.referer?.includes(bearer) ?? false).toBe(false);
    await fulfillJson(route, registrationOptions());
  });
  await page.route("**/v1/webauthn/registration/verify", async (route) => {
    const headers = route.request().headers();
    expect(headers.authorization?.startsWith("Bearer ")).toBe(true);
    expect(headers.authorization === `Bearer ${bearer}`).toBe(true);
    expect(headers.referer?.includes(bearer) ?? false).toBe(false);
    const body = route.request().postDataJSON() as { challengeId?: unknown; response?: unknown };
    expect(typeof body.challengeId).toBe("string");
    expect(body.response).toBeTruthy();
    expect(route.request().postData()?.includes(bearer) ?? false).toBe(false);
    await fulfillJson(route, { accountId: randomUUID(), credentialId: randomUUID() }, 201);
  });

  await page.goto(`/enroll#${bearer}`);
  await expect(page).toHaveURL("http://localhost:4173/enroll");
  await page.getByLabel("Passkey name (optional)").fill("Test passkey");
  await page.getByRole("button", { name: "Create passkey" }).click();
  await expect(page.getByText("Your passkey is ready.")).toBeVisible();

  expect(requestUrls.every((url) => !url.includes(bearer))).toBe(true);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test("malformed enrollment authority is removed without an Identity request", async ({ page }) => {
  let identityRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/v1/")) identityRequests += 1;
  });

  await page.goto("/enroll#not-an-enrollment-authority");

  await expect(page).toHaveURL("http://localhost:4173/enroll");
  await expect(page.getByRole("alert")).toContainText("missing or invalid");
  expect(identityRequests).toBe(0);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test("rejected enrollment exposes only a bounded error and clears authority", async ({ page }) => {
  const bearer = opaqueValue();
  await page.route("**/v1/webauthn/registration/options", (route) =>
    fulfillJson(route, { error: "invalid_enrollment", message: "internal detail" }, 401)
  );

  await page.goto(`/enroll#${bearer}`);
  await page.getByRole("button", { name: "Create passkey" }).click();

  await expect(page.getByRole("alert")).toContainText("authorization is missing or has expired");
  await expect(page.getByRole("alert")).not.toContainText("internal detail");
  await expect(page.getByRole("button", { name: "Create passkey" })).toBeDisabled();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test("cancelled WebAuthn registration returns a safe retry state", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Object.getPrototypeOf(navigator.credentials), "create", {
      configurable: true,
      value: async () => {
        throw new DOMException("synthetic cancellation", "NotAllowedError");
      }
    });
  });
  await page.route("**/v1/webauthn/registration/options", (route) =>
    fulfillJson(route, registrationOptions())
  );

  await page.goto(`/enroll#${opaqueValue()}`);
  await page.getByRole("button", { name: "Create passkey" }).click();

  await expect(page.getByRole("alert")).toContainText("prompt was closed");
  await expect(page.getByRole("button", { name: "Create passkey" })).toBeDisabled();
});

test("registered passkey signs in and opens server-owned security state", async ({ page }) => {
  await addVirtualPasskeyAuthenticator(page);
  const bearer = opaqueValue();

  await page.route("**/v1/webauthn/registration/options", (route) =>
    fulfillJson(route, registrationOptions())
  );
  await page.route("**/v1/webauthn/registration/verify", (route) =>
    fulfillJson(route, { accountId: randomUUID(), credentialId: randomUUID() }, 201)
  );
  await page.goto(`/enroll#${bearer}`);
  await page.getByRole("button", { name: "Create passkey" }).click();
  await expect(page.getByText("Your passkey is ready.")).toBeVisible();

  await page.route("**/v1/webauthn/authentication/options", (route) =>
    fulfillJson(route, authenticationOptions())
  );
  await page.route("**/v1/webauthn/authentication/verify", async (route) => {
    const body = route.request().postDataJSON() as { response?: unknown };
    expect(body.response).toBeTruthy();
    await fulfillJson(route, { expiresAt: new Date(Date.now() + 60_000).toISOString() });
  });
  await page.route("**/v1/security/passkeys", (route) =>
    fulfillJson(route, { passkeys: [], currentCredentialId: null })
  );
  await page.route("**/v1/security/sessions", (route) =>
    fulfillJson(route, { sessions: [] })
  );

  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL("http://localhost:4173/security");
  await expect(page.getByRole("heading", { name: "Devices you trust." })).toBeVisible();
});

test("security mutations send the session-bound CSRF cookie", async ({ context, page }) => {
  const csrf = opaqueValue();
  await addVirtualPasskeyAuthenticator(page);
  await context.addCookies([
    {
      name: "__Host-shape_of_you_csrf",
      value: csrf,
      domain: "localhost",
      path: "/",
      secure: true,
      httpOnly: false,
      sameSite: "Lax"
    }
  ]);
  const credentialId = randomUUID();
  const removableCredentialId = randomUUID();
  const currentSessionId = randomUUID();
  const removableSessionId = randomUUID();
  let removablePasskeyActive = true;
  let removableSessionActive = true;

  await page.route("**/v1/webauthn/registration/options", async (route) => {
    expect(route.request().headers()["x-csrf-token"] === csrf).toBe(true);
    await fulfillJson(route, registrationOptions());
  });
  await page.route("**/v1/webauthn/registration/verify", async (route) => {
    expect(route.request().headers()["x-csrf-token"] === csrf).toBe(true);
    await fulfillJson(route, { accountId: randomUUID(), credentialId: randomUUID() }, 201);
  });

  await page.route("**/v1/security/passkeys**", async (route) => {
    if (route.request().method() === "PATCH") {
      expect(route.request().headers()["x-csrf-token"] === csrf).toBe(true);
      await fulfillJson(route, { id: credentialId, label: "Renamed" });
      return;
    }
    if (route.request().method() === "DELETE") {
      expect(route.request().headers()["x-csrf-token"] === csrf).toBe(true);
      expect(route.request().url().endsWith(removableCredentialId)).toBe(true);
      removablePasskeyActive = false;
      await fulfillJson(route, { revoked: true, currentSessionRevoked: false });
      return;
    }
    await fulfillJson(route, {
      currentCredentialId: credentialId,
      passkeys: [
        {
          id: credentialId,
          label: "Laptop",
          deviceType: "multiDevice",
          backedUp: true,
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString()
        },
        ...(removablePasskeyActive
          ? [{
              id: removableCredentialId,
              label: "Backup phone",
              deviceType: "multiDevice",
              backedUp: true,
              createdAt: new Date().toISOString(),
              lastUsedAt: null
            }]
          : [])
      ]
    });
  });
  await page.route("**/v1/security/sessions**", async (route) => {
    if (route.request().method() === "DELETE") {
      expect(route.request().headers()["x-csrf-token"] === csrf).toBe(true);
      expect(route.request().url().endsWith(removableSessionId)).toBe(true);
      removableSessionActive = false;
      await fulfillJson(route, { revoked: true, currentSessionRevoked: false });
      return;
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000).toISOString();
    await fulfillJson(route, {
      sessions: [
        {
          id: currentSessionId,
          credentialId,
          authenticatedAt: now.toISOString(),
          lastActivityAt: now.toISOString(),
          expiresAt,
          current: true
        },
        ...(removableSessionActive
          ? [{
              id: removableSessionId,
              credentialId: removableCredentialId,
              authenticatedAt: now.toISOString(),
              lastActivityAt: now.toISOString(),
              expiresAt,
              current: false
            }]
          : [])
      ]
    });
  });

  await page.goto("/security");
  await page.getByLabel("Name a new passkey (optional)").fill("Travel key");
  await page.getByRole("button", { name: "Add passkey" }).click();
  await expect(page.getByText("Passkey added.")).toBeVisible();

  await page.getByLabel("Rename passkey").first().fill("Renamed");
  await page.getByRole("button", { name: "Save name" }).first().click();
  await expect(page.getByText("Passkey name updated.")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("listitem")
    .filter({ hasText: "Backup phone" })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.getByText("Passkey removed.")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("Session revoked.")).toBeVisible();
});

test("unauthenticated security state redirects to same-origin sign-in", async ({ page }) => {
  await page.route("**/v1/security/passkeys", (route) =>
    fulfillJson(route, { error: "session_required" }, 401)
  );
  await page.route("**/v1/security/sessions", (route) =>
    fulfillJson(route, { error: "session_required" }, 401)
  );

  await page.goto("/security");

  await expect(page).toHaveURL("http://localhost:4173/sign-in");
});
