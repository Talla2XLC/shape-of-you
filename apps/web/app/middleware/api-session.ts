import { beginBrowserSignIn, browserAuth } from "~/lib/browser-auth";

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;
  if (await browserAuth.hasSession()) return;
  beginBrowserSignIn(to.fullPath);
  return abortNavigation();
});
