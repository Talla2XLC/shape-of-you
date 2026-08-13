import { SignJWT } from "jose";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  BrowserAuth,
  BrowserAuthorizationError
} from "../src/browser-auth/browser-auth.js";
import { RequestPersonContext } from "../src/application/person-context.js";

const origin = "https://staging.example.test";
const key = "test-browser-cookie-key-that-is-long-enough-for-validation";
const resource = "https://staging.example.test/api/mcp";

function auth(): BrowserAuth {
  return new BrowserAuth({
    origin,
    issuer: "https://identity.example.test",
    jwksUri: "https://identity.example.test/oauth/jwks",
    resource,
    clientId: "shape-of-you-web-test",
    cookieKeys: [key],
    resolveAuthorizedPersons: async () => []
  });
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
