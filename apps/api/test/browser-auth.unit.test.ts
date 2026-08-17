import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from "jose";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserAuth,
  BrowserAuthorizationError
} from "../src/browser-auth/browser-auth.js";
import { RequestPersonContext } from "../src/application/person-context.js";

const origin = "https://staging.example.test";
const key = "test-browser-cookie-key-that-is-long-enough-for-validation";
const resource = "https://staging.example.test/api/mcp";

function auth(
  resolveAuthorizedPersons: BrowserAuthOptions["resolveAuthorizedPersons"] = async () => []
): BrowserAuth {
  return new BrowserAuth({
    origin,
    issuer: "https://identity.example.test",
    jwksUri: "https://identity.example.test/oauth/jwks",
    resource,
    clientId: "shape-of-you-web-test",
    cookieKeys: [key],
    resolveAuthorizedPersons
  });
}

type BrowserAuthOptions = ConstructorParameters<typeof BrowserAuth>[0];

function transactionCookie(response: { headers: Record<string, unknown> }): string {
  const setCookie = response.headers["set-cookie"] as string | string[] | undefined;
  return (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";", 1)[0]!;
}

async function transactionReturnTo(response: { headers: Record<string, unknown> }): Promise<string> {
  const encoded = transactionCookie(response).split("=", 2)[1]!;
  const { payload } = await jwtVerify(
    decodeURIComponent(encoded),
    new TextEncoder().encode(key),
    { issuer: origin, audience: origin, algorithms: ["HS256"] }
  );
  return String(payload.returnTo);
}

async function session(expires = "5m", signingKey = key): Promise<string> {
  return new SignJWT({
    personId: "00000000-0000-4000-8000-000000000001",
    roles: ["owner"]
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(origin)
    .setAudience(origin)
    .setSubject("identity-subject")
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(new TextEncoder().encode(signingKey));
}

function request(cookie: string, headers: Record<string, string> = {}) {
  return { headers: { cookie, ...headers } } as never;
}

describe("API browser session boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a valid host-only API session without exposing an OAuth token", async () => {
    await expect(auth().requireRead(request(`__Host-shape_of_you_api_session=${await session()}`))).resolves.toEqual({
      personId: "00000000-0000-4000-8000-000000000001",
      subject: "identity-subject",
      roles: ["owner"]
    });
  });

  it("rejects an expired or malformed API session", async () => {
    await expect(auth().requireRead(request(`__Host-shape_of_you_api_session=${await session("-1s")}`))).rejects.toBeInstanceOf(BrowserAuthorizationError);
    await expect(auth().requireRead(request("__Host-shape_of_you_api_session=forged"))).rejects.toBeInstanceOf(BrowserAuthorizationError);
  });

  it("accepts a session from a retained signing key during rotation", async () => {
    const oldKey = "old-browser-cookie-key-that-is-long-enough-for-validation";
    const rotating = new BrowserAuth({
      origin,
      issuer: "https://identity.example.test",
      jwksUri: "https://identity.example.test/oauth/jwks",
      resource,
      clientId: "shape-of-you-web-test",
      cookieKeys: [key, oldKey],
      resolveAuthorizedPersons: async () => []
    });
    await expect(
      rotating.requireRead(
        request(`__Host-shape_of_you_api_session=${await session("5m", oldKey)}`)
      )
    ).resolves.toMatchObject({ subject: "identity-subject" });
  });

  it("requires exact Origin and matching CSRF for browser writes", async () => {
    const cookie = `__Host-shape_of_you_api_session=${await session()}; __Host-shape_of_you_api_csrf=csrf-value`;
    await expect(auth().requireWrite(request(cookie, { origin, "x-csrf-token": "csrf-value" }))).resolves.toMatchObject({ subject: "identity-subject" });
    await expect(auth().requireWrite(request(cookie, { origin: "https://evil.example.test", "x-csrf-token": "csrf-value" }))).rejects.toBeInstanceOf(BrowserAuthorizationError);
    await expect(auth().requireWrite(request(cookie, { origin }))).rejects.toBeInstanceOf(BrowserAuthorizationError);
  });

  it("starts authorization with the configured Identity resource and S256 PKCE", async () => {
    const fastify = Fastify();
    auth().register(fastify);

    const response = await fastify.inject({ method: "GET", url: "/browser-auth/sign-in" });
    const redirect = new URL(response.headers.location!);

    expect(response.statusCode).toBe(302);
    expect(redirect.origin + redirect.pathname).toBe("https://identity.example.test/oauth/authorize");
    expect(redirect.searchParams.get("client_id")).toBe("shape-of-you-web-test");
    expect(redirect.searchParams.get("resource")).toBe(resource);
    expect(redirect.searchParams.get("code_challenge_method")).toBe("S256");
    expect(redirect.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const setCookie = response.headers["set-cookie"];
    expect(Array.isArray(setCookie) ? setCookie.join(";") : setCookie ?? "").toContain(
      "__Host-shape_of_you_api_oauth="
    );
    await expect(transactionReturnTo(response)).resolves.toBe("/day");
    await fastify.close();
  });

  it.each([
    ["/day?date=2026-08-17&timezone=Europe%2FMoscow", "/day?date=2026-08-17&timezone=Europe%2FMoscow"],
    ["https://evil.example.test/day", "/day"],
    ["//evil.example.test/day", "/day"],
    ["/\\evil.example.test/day", "/day"],
    ["/day#private", "/day"],
    ["/day\nredirect", "/day"],
    [`/${"a".repeat(2_048)}`, "/day"]
  ])("stores only a bounded same-origin return route for %s", async (returnTo, expected) => {
    const fastify = Fastify();
    auth().register(fastify);
    const response = await fastify.inject({
      method: "GET",
      url: `/browser-auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`
    });
    await expect(transactionReturnTo(response)).resolves.toBe(expected);
    await fastify.close();
  });

  it("reports only credential-free session presence without caching", async () => {
    const fastify = Fastify();
    auth().register(fastify);
    const missing = await fastify.inject({ method: "GET", url: "/browser-auth/session" });
    expect(missing.statusCode).toBe(401);
    expect(missing.body).toBe("");
    expect(missing.headers["cache-control"]).toBe("no-store");

    const active = await fastify.inject({
      method: "GET",
      url: "/browser-auth/session",
      headers: { cookie: `__Host-shape_of_you_api_session=${await session()}` }
    });
    expect(active.statusCode).toBe(204);
    expect(active.body).toBe("");
    expect(active.headers["cache-control"]).toBe("no-store");

    const expired = await fastify.inject({
      method: "GET",
      url: "/browser-auth/session",
      headers: { cookie: `__Host-shape_of_you_api_session=${await session("-1s")}` }
    });
    expect(expired.statusCode).toBe(401);
    expect(expired.body).toBe("");
    expect(expired.headers["cache-control"]).toBe("no-store");
    await fastify.close();
  });

  it("redirects an authorized callback to the signed path and query", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    const idToken = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "browser-return-test" })
      .setIssuer("https://identity.example.test")
      .setAudience("shape-of-you-web-test")
      .setSubject("authorized-subject")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.pathname === "/oauth/token") return Response.json({ id_token: idToken });
      if (url.pathname === "/oauth/jwks") {
        return Response.json({
          keys: [{ ...publicJwk, alg: "ES256", kid: "browser-return-test", use: "sig" }]
        });
      }
      return new Response(null, { status: 404 });
    }));
    const fastify = Fastify();
    auth(async () => [{
      personId: "00000000-0000-4000-8000-000000000001",
      roles: ["owner"]
    }]).register(fastify);
    const returnTo = "/day?date=2026-08-17&timezone=Europe%2FMoscow";
    const start = await fastify.inject({
      method: "GET",
      url: `/browser-auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`
    });
    const authorize = new URL(start.headers.location!);
    const response = await fastify.inject({
      method: "GET",
      url: `/browser-auth/callback?code=one-time-code&state=${authorize.searchParams.get("state")}&returnTo=${encodeURIComponent("https://evil.example.test")}`,
      headers: { cookie: transactionCookie(start) }
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`${origin}${returnTo}`);
    expect(response.headers.location).not.toContain("one-time-code");

    const legacyState = "legacy-state";
    const legacyTransaction = await new SignJWT({
      state: legacyState,
      verifier: "legacy-verifier"
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(origin)
      .setAudience(origin)
      .setSubject("oauth-transaction")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(key));
    const legacyResponse = await fastify.inject({
      method: "GET",
      url: `/browser-auth/callback?code=legacy-code&state=${legacyState}`,
      headers: {
        cookie: `__Host-shape_of_you_api_oauth=${encodeURIComponent(legacyTransaction)}`
      }
    });
    expect(legacyResponse.statusCode).toBe(302);
    expect(legacyResponse.headers.location).toBe(`${origin}/day`);
    await fastify.close();
  });

  it("redirects an authenticated but unbound subject without exposing OAuth material", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    const idToken = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "browser-test" })
      .setIssuer("https://identity.example.test")
      .setAudience("shape-of-you-web-test")
      .setSubject("unbound-subject")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.pathname === "/oauth/token") {
        return Response.json({ id_token: idToken });
      }
      if (url.pathname === "/oauth/jwks") {
        return Response.json({ keys: [{ ...publicJwk, alg: "ES256", kid: "browser-test", use: "sig" }] });
      }
      return new Response(null, { status: 404 });
    }));
    const fastify = Fastify();
    auth().register(fastify);
    const start = await fastify.inject({ method: "GET", url: "/browser-auth/sign-in" });
    const authorize = new URL(start.headers.location!);
    const setCookie = start.headers["set-cookie"];
    const transactionCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!
      .split(";", 1)[0]!;
    const response = await fastify.inject({
      method: "GET",
      url: `/browser-auth/callback?code=one-time-code&state=${authorize.searchParams.get("state")}`,
      headers: { cookie: transactionCookie }
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://staging.example.test/access-required");
    expect(response.headers.location).not.toContain("unbound-subject");
    expect(response.headers.location).not.toContain("one-time-code");
    await fastify.close();
  });

  it("guards every v1 browser route and supplies only the session Person", async () => {
    const fastify = Fastify();
    const personContext = new RequestPersonContext();
    auth().guardApiRoutes(fastify, personContext);
    fastify.get("/v1/person", () => ({ personId: personContext.getPersonId() }));
    fastify.post("/v1/person", () => ({ personId: personContext.getPersonId() }));

    const cookie = `__Host-shape_of_you_api_session=${await session()}; __Host-shape_of_you_api_csrf=csrf-value`;
    await expect(fastify.inject({ method: "GET", url: "/v1/person" })).resolves.toMatchObject({ statusCode: 401 });
    await expect(fastify.inject({ method: "GET", url: "/v1/person", headers: { cookie } })).resolves.toMatchObject({ statusCode: 200 });
    const read = await fastify.inject({ method: "GET", url: "/v1/person", headers: { cookie } });
    expect(read.json()).toEqual({ personId: "00000000-0000-4000-8000-000000000001" });
    await expect(fastify.inject({ method: "POST", url: "/v1/person", headers: { cookie } })).resolves.toMatchObject({ statusCode: 401 });
    const write = await fastify.inject({ method: "POST", url: "/v1/person", headers: { cookie, origin, "x-csrf-token": "csrf-value" } });
    expect(write.statusCode).toBe(200);
    expect(write.json()).toEqual({ personId: "00000000-0000-4000-8000-000000000001" });
    await fastify.close();
  });
});
