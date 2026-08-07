import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import {
  IdentityAuthenticationError,
  identityCsrfCookieName,
  type IdentityAuthenticationService,
  type OAuthBrowserSession
} from "../authentication/service.js";
import type { OAuthClientStore } from "./client-store.js";
import type { OAuthRuntime } from "./runtime.js";

const interactionPath = /^\/oauth\/interaction\/([A-Za-z0-9_-]{43})(?:\/(login|consent))?$/;
const submissionSchema = z.object({
  action: z.enum(["allow", "deny"]).optional(),
  csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
});

/** Dependencies for the minimal same-origin OAuth login and consent page. */
export interface OAuthBrowserUiDependencies {
  readonly authentication: IdentityAuthenticationService;
  readonly clients: OAuthClientStore;
  readonly publicOrigin: string;
  readonly resource: string;
  readonly runtime: OAuthRuntime;
}

/** Handles Identity-owned OAuth interaction HTML and its CSRF-bound submits. */
export class OAuthBrowserUi {
  public constructor(private readonly dependencies: OAuthBrowserUiDependencies) {}

  /** Returns whether the request matched and was handled as an OAuth interaction. */
  public async handle(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string
  ): Promise<boolean> {
    const match = pathname.match(interactionPath);
    if (!match) return false;
    response.setHeader("cache-control", "no-store");
    const interactionCredential = match[1]!;
    const actionRoute = match[2];
    if ((request.method ?? "GET") === "GET" && actionRoute === undefined) {
      await this.render(request, response, interactionCredential);
      return true;
    }
    if (
      (request.method ?? "GET") === "POST" &&
      (actionRoute === "login" || actionRoute === "consent")
    ) {
      if (request.headers.origin !== this.dependencies.publicOrigin) {
        throw new IdentityAuthenticationError(403, "invalid_origin", "Request Origin is not allowed");
      }
      await this.submit(request, response, interactionCredential, actionRoute);
      return true;
    }
    response.writeHead(405, { allow: actionRoute ? "POST" : "GET" });
    response.end();
    return true;
  }

  private async render(
    request: IncomingMessage,
    response: ServerResponse,
    interactionCredential: string
  ): Promise<void> {
    const details = await this.dependencies.runtime.interactionDetails(request, response);
    if (details.uid !== interactionCredential) throw new Error("OAuth interaction cookie mismatch");
    const clientId = requireString(details.params.client_id, "OAuth client id");
    const client = await this.dependencies.clients.findProviderClient(clientId);
    if (!client) throw new Error("OAuth client is unavailable");
    const scopes = splitScope(requireString(details.params.scope, "OAuth scope"));
    const session = await optionalSession(this.dependencies.authentication, request.headers.cookie);
    const csrfToken = readCookie(request.headers.cookie, identityCsrfCookieName);
    const nonce = randomBytes(18).toString("base64url");
    const promptName = details.prompt.name;
    if (promptName !== "login" && promptName !== "consent") {
      throw new Error("OAuth interaction prompt is unsupported");
    }
    if (promptName === "consent" && (!session || !csrfToken)) {
      throw new IdentityAuthenticationError(401, "authentication_required", "Authentication required");
    }
    const html = renderPage({
      clientName: typeof client.client_name === "string" ? client.client_name : clientId,
      csrfToken,
      interactionCredential,
      nonce,
      prompt: promptName,
      scopes,
      session
    });
    response.writeHead(200, {
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY"
    });
    response.end(html);
  }

  private async submit(
    request: IncomingMessage,
    response: ServerResponse,
    interactionCredential: string,
    route: "login" | "consent"
  ): Promise<void> {
    const body = submissionSchema.parse(await readJson(request));
    const details = await this.dependencies.runtime.interactionDetails(request, response);
    if (details.uid !== interactionCredential || details.prompt.name !== route) {
      throw new IdentityAuthenticationError(400, "invalid_oauth_interaction", "OAuth interaction is invalid");
    }
    const session = await this.dependencies.authentication.bindOAuthInteractionSession(
      {
        cookie: request.headers.cookie,
        csrfToken: body.csrfToken
      },
      interactionCredential
    );
    if (route === "login") {
      await this.dependencies.runtime.finishInteraction(request, response, {
        login: {
          accountId: session.accountId,
          acr: session.acr,
          amr: [...session.amr],
          remember: true,
          ts: Math.floor(session.authenticatedAt.getTime() / 1_000)
        }
      });
      return;
    }
    if (body.action === "deny") {
      await this.dependencies.runtime.finishInteraction(request, response, {
        error: "access_denied",
        error_description: "End-user denied access"
      });
      return;
    }
    if (body.action !== "allow") {
      throw new IdentityAuthenticationError(400, "invalid_request", "Consent decision is required");
    }
    const clientId = requireString(details.params.client_id, "OAuth client id");
    const scopes = splitScope(requireString(details.params.scope, "OAuth scope"));
    const grantId = await this.dependencies.runtime.grantResourceScopes({
      accountId: session.accountId,
      clientId,
      existingGrantId: details.grantId,
      scopes
    });
    await this.dependencies.runtime.finishInteraction(request, response, {
      consent: { grantId }
    });
  }
}

async function optionalSession(
  authentication: IdentityAuthenticationService,
  cookie: string | undefined
): Promise<OAuthBrowserSession | null> {
  try {
    return await authentication.getOAuthBrowserSession({ cookie });
  } catch (error) {
    if (error instanceof IdentityAuthenticationError && error.statusCode === 401) return null;
    throw error;
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 16 * 1_024) throw new IdentityAuthenticationError(413, "payload_too_large", "Request body is too large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new IdentityAuthenticationError(400, "invalid_json", "Request body must be valid JSON");
  }
}

function renderPage(input: {
  readonly clientName: string;
  readonly csrfToken: string | null;
  readonly interactionCredential: string;
  readonly nonce: string;
  readonly prompt: "login" | "consent";
  readonly scopes: readonly string[];
  readonly session: OAuthBrowserSession | null;
}): string {
  const title = input.prompt === "login" ? "Sign in" : "Authorize access";
  const description = input.prompt === "login"
    ? `Continue to ${escapeHtml(input.clientName)} with your Shape of You account.`
    : `${escapeHtml(input.clientName)} requests the following access:`;
  const scopeItems = input.prompt === "consent"
    ? `<ul>${input.scopes.map((scope) => `<li>${escapeHtml(scopeLabel(scope))}</li>`).join("")}</ul>`
    : "";
  const authenticatedAction = input.session && input.csrfToken
    ? input.prompt === "login"
      ? `<button id="continue" type="button">Continue as ${escapeHtml(input.session.displayName)}</button>`
      : `<button id="allow" type="button">Allow</button><button id="deny" class="secondary" type="button">Deny</button>`
    : `<button id="passkey" type="button">Sign in with a passkey</button>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Shape of You</title>
<style nonce="${input.nonce}">body{font:16px system-ui,sans-serif;background:#f4f5f7;color:#17191c;margin:0;display:grid;min-height:100vh;place-items:center}.card{background:#fff;border:1px solid #dfe3e8;border-radius:16px;box-shadow:0 12px 36px #10182818;max-width:440px;padding:32px;width:calc(100% - 48px)}h1{margin:0 0 12px;font-size:26px}p{line-height:1.5;color:#475467}ul{padding-left:22px;line-height:1.7}button{background:#111827;color:#fff;border:0;border-radius:10px;cursor:pointer;font:inherit;font-weight:650;margin:8px 8px 0 0;padding:12px 18px}.secondary{background:#e5e7eb;color:#111827}.error{color:#b42318;min-height:24px}</style></head>
<body><main class="card"><h1>${title}</h1><p>${description}</p>${scopeItems}<p id="error" class="error" role="alert"></p>${authenticatedAction}</main>
<script nonce="${input.nonce}">
const interaction=${JSON.stringify(input.interactionCredential)};let csrf=${JSON.stringify(input.csrfToken)};
const from64=v=>Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(v.length/4)*4,'=')),c=>c.charCodeAt(0));
const to64=v=>btoa(String.fromCharCode(...new Uint8Array(v))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
const fail=e=>{document.getElementById('error').textContent=e instanceof Error?e.message:'Request failed'};
async function submit(route,action){const r=await fetch('/oauth/interaction/'+interaction+'/'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({csrfToken:csrf,action}),redirect:'follow'});if(r.redirected){location.assign(r.url);return}if(!r.ok)throw new Error('Authorization request failed')}
async function passkey(){const o=await fetch('/v1/webauthn/authentication/options',{method:'POST'}).then(r=>r.json());const p=o.options;p.challenge=from64(p.challenge);if(p.allowCredentials)p.allowCredentials=p.allowCredentials.map(x=>({...x,id:from64(x.id)}));const c=await navigator.credentials.get({publicKey:p});const response={id:c.id,rawId:to64(c.rawId),type:c.type,response:{authenticatorData:to64(c.response.authenticatorData),clientDataJSON:to64(c.response.clientDataJSON),signature:to64(c.response.signature),userHandle:c.response.userHandle?to64(c.response.userHandle):undefined},clientExtensionResults:c.getClientExtensionResults(),authenticatorAttachment:c.authenticatorAttachment};const r=await fetch('/v1/webauthn/authentication/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({challengeId:o.challengeId,response})});const body=await r.json();if(!r.ok)throw new Error(body.message||'Passkey sign-in failed');csrf=body.csrfToken;await submit('login')}
document.getElementById('passkey')?.addEventListener('click',()=>passkey().catch(fail));document.getElementById('continue')?.addEventListener('click',()=>submit('login').catch(fail));document.getElementById('allow')?.addEventListener('click',()=>submit('consent','allow').catch(fail));document.getElementById('deny')?.addEventListener('click',()=>submit('consent','deny').catch(fail));
</script></body></html>`;
}

function scopeLabel(scope: string): string {
  return {
    "body-measurement:write": "Record body measurements",
    "meal:write": "Record meals",
    "person:read": "Read your profile",
    "weight:write": "Record weight",
    "workout:write": "Record workouts"
  }[scope] ?? scope;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]!);
}

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of header?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} is invalid`);
  return value;
}

function splitScope(value: string): string[] {
  const scopes = [...new Set(value.split(" ").filter(Boolean))].sort();
  if (scopes.length === 0) throw new Error("OAuth scope set is empty");
  return scopes;
}
