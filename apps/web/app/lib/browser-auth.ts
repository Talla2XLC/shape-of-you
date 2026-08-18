type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

/** Failure to determine browser-session presence from the API authority. */
export class BrowserSessionProbeError extends Error {
  /** Creates a bounded failure without copying response data into the client. */
  public constructor() {
    super("Browser session presence is unavailable");
    this.name = "BrowserSessionProbeError";
  }
}

/** Creates the same-origin browser authorization navigation contract. */
export function createBrowserAuth(fetcher: Fetcher = globalThis.fetch.bind(globalThis)) {
  return {
    /** Returns whether the API recognizes one active HttpOnly browser session. */
    async hasSession(): Promise<boolean> {
      const response = await fetcher("/api/browser-auth/session", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        cache: "no-store"
      });
      if (response.status === 204) return true;
      if (response.status === 401) return false;
      throw new BrowserSessionProbeError();
    },

    /** Builds the top-level sign-in URL for a path-and-query return route. */
    signInUrl(returnTo = "/progress"): string {
      const query = new URLSearchParams({ returnTo });
      return `/api/browser-auth/sign-in?${query.toString()}`;
    }
  };
}

/** Shared browser authorization adapter used by landing and protected routes. */
export const browserAuth = createBrowserAuth();

/** Removes a fragment before a client route is sent to the API sign-in route. */
export function returnRoute(fullPath: string): string {
  const withoutFragment = fullPath.split("#", 1)[0];
  return withoutFragment?.startsWith("/") ? withoutFragment : "/progress";
}

/** Starts top-level OAuth without retaining navigation state in browser storage. */
export function beginBrowserSignIn(fullPath = "/progress"): void {
  window.location.assign(browserAuth.signInUrl(returnRoute(fullPath)));
}

/** Public browser authorization adapter contract. */
export type BrowserAuth = ReturnType<typeof createBrowserAuth>;
