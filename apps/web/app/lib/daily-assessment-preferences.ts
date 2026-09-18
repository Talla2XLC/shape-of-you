import { readCookie } from "./browser-security";

const csrfCookieName = "__Host-shape_of_you_api_csrf";

/** Browser-visible subset of Person preferences used for day context. */
export interface DailyAssessmentPreferences {
  readonly timezone: string | null;
  readonly updatedAt: string;
}

function browserTimezone(): string | null {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timezone || timezone.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return null;
  }
}

async function requestPreferences(
  init: RequestInit = {}
): Promise<DailyAssessmentPreferences> {
  const csrf = init.method && init.method !== "GET"
    ? readCookie(document.cookie, csrfCookieName)
    : null;
  const response = await fetch("/api/v1/daily-assessment/preferences", {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      ...init.headers
    }
  });
  if (!response.ok) throw Object.assign(new Error("Daily context preferences unavailable"), {
    status: response.status
  });
  return await response.json() as DailyAssessmentPreferences;
}

let bootstrap: Promise<void> | null = null;
let bootstrapCompleted = false;

/** Persists browser IANA timezone only when the Person has no day context yet. */
export function ensureDailyAssessmentTimezone(): Promise<void> {
  if (bootstrapCompleted) return Promise.resolve();
  bootstrap ??= (async () => {
    const timezone = browserTimezone();
    if (timezone === null) return;
    const preferences = await requestPreferences();
    if (preferences.timezone !== null) return;
    await requestPreferences({
      method: "PUT",
      body: JSON.stringify({ timezone, ifTimezoneUnset: true })
    });
  })().then(
    () => { bootstrapCompleted = true; },
    () => undefined
  ).finally(() => { bootstrap = null; });
  return bootstrap;
}
