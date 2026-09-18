import { beginBrowserSignIn, browserAuth } from "~/lib/browser-auth";
import { ensureDailyAssessmentTimezone } from "~/lib/daily-assessment-preferences";

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;
  if (await browserAuth.hasSession()) {
    await ensureDailyAssessmentTimezone();
    return;
  }
  beginBrowserSignIn(to.fullPath);
  return abortNavigation();
});
