import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

interface BrowserAuthority {
  readonly enrollmentToken: string;
}

test("browser OAuth opens progress, reflects its session, and restores a protected route", async ({
  context,
  page
}) => {
  const authorityPath = process.env.BROWSER_AUTH_E2E_AUTHORITY_FILE;
  if (!authorityPath) throw new Error("BROWSER_AUTH_E2E_AUTHORITY_FILE is required");
  const authority = JSON.parse(await readFile(authorityPath, "utf8")) as BrowserAuthority;

  const client = await context.newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true
    }
  });

  await page.goto(`/enroll#${authority.enrollmentToken}`);
  await expect(page).toHaveURL(/\/enroll$/);
  await page.getByRole("button", { name: "Create passkey" }).click();
  await expect(page.getByText("Your passkey is ready.")).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: "Continue with a passkey" }).click();
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page).toHaveURL(/\/progress$/);
  await expect(page.getByRole("heading", { name: "Your shape, over time." })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Open progress" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with a passkey" })).toHaveCount(0);

  await context.clearCookies({ name: "__Host-shape_of_you_api_session" });
  await context.clearCookies({ name: "__Host-shape_of_you_api_csrf" });
  await page.goto("/days/2026-08-17?timezone=Europe%2FMoscow");
  await expect(page).toHaveURL(/\/days\/2026-08-17\?/);
  const restoredUrl = new URL(page.url());
  expect(restoredUrl.pathname).toBe("/days/2026-08-17");
  expect(restoredUrl.searchParams.get("timezone")).toBe("Europe/Moscow");
  await expect(page.getByRole("heading", { name: "Your day, with its context intact." })).toBeVisible();
  await expect(page.getByLabel("Date")).toHaveValue("2026-08-17");
  await expect(page.getByRole("alert")).toHaveCount(0);

  const cookies = await context.cookies();
  expect(cookies.some((cookie) => cookie.name === "__Host-shape_of_you_api_session")).toBe(true);
});
