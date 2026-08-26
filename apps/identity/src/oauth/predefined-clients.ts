import type { OAuthPublicClientInput } from "./client-store.js";

/** Exact callback owned by the stable ChatGPT connector platform. */
export const CHATGPT_CONNECTOR_REDIRECT_URI =
  "https://chatgpt.com/connector_platform_oauth_redirect";

/** Stable policy for an Identity-owned predefined public OAuth client. */
export interface PredefinedOAuthClientPolicy {
  readonly clientId: string;
  readonly displayName: string;
  readonly allowedScopes: readonly string[];
  readonly refreshTokensEnabled: boolean;
}

/** Versioned collection of predefined OAuth client policies. */
export interface PredefinedOAuthClientManifest {
  readonly version: number;
  readonly clients: readonly PredefinedOAuthClientPolicy[];
}

/** Predefined client manifest owned by the Identity release. */
export const predefinedOAuthClientManifest: PredefinedOAuthClientManifest = {
  version: 4,
  clients: [
    {
      clientId: "shape-of-you-web-staging",
      displayName: "Shape of You Web Staging",
      allowedScopes: ["openid"],
      refreshTokensEnabled: false
    },
    {
      clientId: "shape-of-you-chatgpt-staging",
      displayName: "Shape of You ChatGPT Staging",
      allowedScopes: [
        "openid",
        "offline_access",
        "person:read",
        "weight:write",
        "body-measurement:write",
        "daily-context-note:write",
        "day-closure:write",
        "meal:write",
        "recovery:write",
        "workout:write"
      ],
      refreshTokensEnabled: true
    }
  ]
};

/** Reserved predefined client policies owned by the Identity release. */
export const predefinedOAuthClientPolicies = predefinedOAuthClientManifest.clients;

const reservedClientIds = new Set(
  predefinedOAuthClientPolicies.map((policy) => policy.clientId)
);

/** Returns whether a client ID is reserved for release-managed reconciliation. */
export function isPredefinedOAuthClientId(clientId: string): boolean {
  return reservedClientIds.has(clientId);
}

/**
 * Rejects client IDs whose policy is owned by deployment reconciliation.
 *
 * @throws Error when an operator command attempts to manage a reserved ID.
 */
export function assertOAuthClientIdIsOperatorManaged(clientId: string): void {
  if (isPredefinedOAuthClientId(clientId)) {
    throw new Error("Reserved OAuth client IDs are managed by deployment reconciliation");
  }
}

/**
 * Validates the exact ChatGPT connector callback without exposing its value.
 *
 * @throws Error when the callback is absent or is not a credential-free HTTPS
 * ChatGPT connector URL without query or fragment components.
 */
export function parseChatGptRedirectUri(value: string | undefined): string {
  if (!value) {
    throw new Error("Predefined ChatGPT OAuth redirect URI is required");
  }
  if (value !== CHATGPT_CONNECTOR_REDIRECT_URI) {
    throw new Error("Predefined ChatGPT OAuth redirect URI is invalid");
  }
  return value;
}

/** Resolves versioned predefined policies with their environment-owned callback. */
export function resolvePredefinedOAuthClients(
  chatGptRedirectUri: string | undefined,
  webRedirectUri: string | undefined,
  manifest: PredefinedOAuthClientManifest = predefinedOAuthClientManifest
): readonly OAuthPublicClientInput[] {
  if (manifest.version !== 4) {
    throw new Error("Predefined OAuth client manifest version is unsupported");
  }
  const chatGptUri = parseChatGptRedirectUri(chatGptRedirectUri);
  const webUri = parseWebRedirectUri(webRedirectUri);
  return manifest.clients.map((policy) => ({
    ...policy,
    redirectUris: [
      policy.clientId === "shape-of-you-web-staging"
        ? webUri
        : chatGptUri
    ]
  }));
}

/** Validates an exact credential-free HTTPS callback owned by the staging Web/API origin. */
export function parseWebRedirectUri(value: string | undefined): string {
  if (!value) throw new Error("Predefined Web OAuth redirect URI is required");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Predefined Web OAuth redirect URI is invalid");
  }
  if (
    url.origin !== "https://staging.shape-of-you.ru" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/api/browser-auth/callback"
  ) {
    throw new Error("Predefined Web OAuth redirect URI is invalid");
  }
  return value;
}
