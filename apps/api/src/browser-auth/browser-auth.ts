import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { jwtVerify, SignJWT, createRemoteJWKSet, type JWTPayload } from "jose";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AuthorizedPerson } from "../storage/identity-subject-mapping-repository.js";
import { ApplicationError } from "../domain/errors.js";
import type { RequestPersonContext } from "../application/person-context.js";

const sessionCookieName = "__Host-shape_of_you_api_session";
const csrfCookieName = "__Host-shape_of_you_api_csrf";
const transactionCookieName = "__Host-shape_of_you_api_oauth";
const transactionTtlSeconds = 600;
const sessionTtlSeconds = 3600;
const defaultReturnTo = "/day";
const maxReturnToLength = 2_048;

/** Verified browser authority suitable for the request Person context. */
export interface BrowserSession {
  readonly personId: string;
  readonly subject: string;
  readonly roles: readonly string[];
}

/** Dependencies for the API-owned browser OAuth boundary. */
export interface BrowserAuthOptions {
  readonly origin: string;
  readonly issuer: string;
  readonly jwksUri: string;
  readonly resource: string;
  readonly clientId: string;
  readonly cookieKeys: readonly string[];
  readonly resolveAuthorizedPersons: (issuer: string, subject: string) => Promise<readonly AuthorizedPerson[]>;
}

interface TransactionClaims {
  readonly returnTo: string;
  readonly state: string;
  readonly verifier: string;
}

/**
 * Registers top-level OAuth navigation and validates API-owned browser cookies.
 *
 * It never accepts Identity cookies directly or exposes OAuth tokens to JavaScript.
 */
export class BrowserAuth {
  private readonly key: Uint8Array;
  private readonly verificationKeys: readonly Uint8Array[];
  private readonly jwks;
  private readonly origin: URL;

  public constructor(private readonly options: BrowserAuthOptions) {
    this.verificationKeys = options.cookieKeys.map((key) => new TextEncoder().encode(key));
    this.key = this.verificationKeys[0]!;
    this.jwks = createRemoteJWKSet(new URL(options.jwksUri));
    this.origin = new URL(options.origin);
  }

  public register(fastify: FastifyInstance): void {
    fastify.get("/browser-auth/sign-in", async (request, reply) => {
      const state = randomToken();
      const verifier = randomToken();
      const returnTo = safeReturnTo(readQuery(request, "returnTo"), this.origin);
      const transaction = await this.sign(
        { returnTo, state, verifier },
        transactionTtlSeconds,
        "oauth-transaction"
      );
      setCookie(reply, transactionCookieName, transaction, { httpOnly: true, maxAge: transactionTtlSeconds });
      const authorize = new URL("/oauth/authorize", this.options.issuer);
      authorize.searchParams.set("client_id", this.options.clientId);
      authorize.searchParams.set("redirect_uri", this.callbackUrl());
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("scope", "openid");
      authorize.searchParams.set("resource", this.options.resource);
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("code_challenge", sha256Base64Url(verifier));
      authorize.searchParams.set("code_challenge_method", "S256");
      reply.redirect(authorize.toString());
    });

    fastify.get("/browser-auth/callback", async (request, reply) => {
      const code = readQuery(request, "code");
      const state = readQuery(request, "state");
      const transaction = await this.readTransaction(request);
      if (!code || !state || !transaction || !safeEqual(state, transaction.state)) {
        reply.code(401).send({ statusCode: 401, error: "UNAUTHORIZED", message: "Browser authorization was not accepted" });
        return;
      }
      clearCookie(reply, transactionCookieName);
      try {
        const token = await this.exchangeCode(code, transaction.verifier);
        const { payload } = await jwtVerify(token, this.jwks, {
          issuer: this.options.issuer,
          audience: this.options.clientId,
          algorithms: ["ES256"]
        });
        if (!payload.sub) throw new BrowserAuthorizationError("Browser authorization was not accepted");
        const persons = await this.options.resolveAuthorizedPersons(this.options.issuer, payload.sub);
        if (persons.length !== 1) {
          reply.redirect(new URL("/access-required", this.origin).toString());
          return;
        }
        const person = persons[0]!;
        const session = await this.sign({ personId: person.personId, subject: payload.sub, roles: person.roles }, sessionTtlSeconds, "browser-session");
        const csrf = randomToken();
        setCookie(reply, sessionCookieName, session, { httpOnly: true, maxAge: sessionTtlSeconds });
        setCookie(reply, csrfCookieName, csrf, { httpOnly: false, maxAge: sessionTtlSeconds });
        reply.redirect(new URL(transaction.returnTo, this.origin).toString());
      } catch (error) {
        if (error instanceof BrowserAuthorizationError) {
          reply.code(error.statusCode).send({ statusCode: error.statusCode, error: error.code, message: error.message });
          return;
        }
        reply.code(401).send({ statusCode: 401, error: "UNAUTHORIZED", message: "Browser authorization was not accepted" });
      }
    });

    fastify.post("/browser-auth/sign-out", async (request, reply) => {
      await this.requireWrite(request);
      clearCookie(reply, sessionCookieName);
      clearCookie(reply, csrfCookieName);
      reply.code(204).send();
    });

    fastify.get("/browser-auth/session", async (request, reply) => {
      reply.header("cache-control", "no-store");
      try {
        await this.requireRead(request);
        reply.code(204).send();
      } catch (error) {
        if (error instanceof BrowserAuthorizationError) {
          reply.code(401).send();
          return;
        }
        throw error;
      }
    });
  }

  /** Guards every published browser API route and establishes its Person context. */
  public guardApiRoutes(fastify: FastifyInstance, personContext: RequestPersonContext): void {
    fastify.addHook("preHandler", (request, reply, done) => {
      if (!request.url.startsWith("/v1/")) {
        done();
        return;
      }
      const authorize = request.method === "GET" || request.method === "HEAD"
        ? this.requireRead(request)
        : this.requireWrite(request);
      void authorize.then((session) => {
        personContext.run(session.personId, done);
      }).catch((error: unknown) => {
        if (error instanceof BrowserAuthorizationError) {
          reply.code(error.statusCode).send({ statusCode: error.statusCode, error: error.code, message: error.message });
          return;
        }
        done(error as Error);
      });
    });
  }

  public async requireRead(request: FastifyRequest): Promise<BrowserSession> {
    const raw = readCookie(request.headers.cookie, sessionCookieName);
    if (!raw) throw new BrowserAuthorizationError("Browser sign-in is required");
    try {
      const payload = await this.verifyApiToken(raw);
      if (!payload.sub || typeof payload.personId !== "string" || !Array.isArray(payload.roles)) {
        throw new Error("Malformed session");
      }
      return { personId: payload.personId, subject: payload.sub, roles: payload.roles.filter((item): item is string => typeof item === "string") };
    } catch {
      throw new BrowserAuthorizationError("Browser sign-in is required");
    }
  }

  public async requireWrite(request: FastifyRequest): Promise<BrowserSession> {
    const session = await this.requireRead(request);
    const origin = request.headers.origin;
    const csrf = request.headers["x-csrf-token"];
    const expected = readCookie(request.headers.cookie, csrfCookieName);
    if (origin !== this.origin.origin || typeof csrf !== "string" || !expected || !safeEqual(csrf, expected)) {
      throw new BrowserAuthorizationError("Browser write was not accepted");
    }
    return session;
  }

  private async readTransaction(request: FastifyRequest): Promise<TransactionClaims | null> {
    const raw = readCookie(request.headers.cookie, transactionCookieName);
    if (!raw) return null;
    try {
      const payload = await this.verifyApiToken(raw);
      return typeof payload.state === "string" && typeof payload.verifier === "string"
        ? {
            returnTo: safeReturnTo(
              typeof payload.returnTo === "string" ? payload.returnTo : null,
              this.origin
            ),
            state: payload.state,
            verifier: payload.verifier
          }
        : null;
    } catch { return null; }
  }

  private async exchangeCode(code: string, verifier: string): Promise<string> {
    const response = await fetch(new URL("/oauth/token", this.options.issuer), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: this.callbackUrl(), client_id: this.options.clientId, code_verifier: verifier })
    });
    const body = await response.json().catch(() => ({})) as { id_token?: unknown };
    if (!response.ok || typeof body.id_token !== "string") throw new BrowserAuthorizationError("Browser authorization was not accepted");
    return body.id_token;
  }

  private callbackUrl(): string { return new URL("/api/browser-auth/callback", this.origin).toString(); }

  private async verifyApiToken(raw: string): Promise<JWTPayload> {
    let lastError: unknown;
    for (const key of this.verificationKeys) {
      try {
        const { payload } = await jwtVerify(raw, key, {
          issuer: this.options.origin,
          audience: this.options.origin,
          algorithms: ["HS256"]
        });
        return payload;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("No browser session verification key is configured");
  }

  private sign(payload: Record<string, unknown>, ttl: number, purpose: string): Promise<string> {
    return new SignJWT(payload).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuer(this.options.origin).setAudience(this.options.origin).setSubject(purpose === "browser-session" ? String(payload.subject) : purpose).setIssuedAt().setExpirationTime(`${ttl}s`).sign(this.key);
  }
}

/** Bounded failure returned instead of falling back to a synthetic Person. */
export class BrowserAuthorizationError extends ApplicationError {
  public constructor(message: string) {
    super(message, 401, "UNAUTHORIZED");
    this.name = "BrowserAuthorizationError";
  }
}

function randomToken(): string { return randomBytes(32).toString("base64url"); }
function sha256Base64Url(value: string): string { return createHash("sha256").update(value).digest("base64url"); }
function safeEqual(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function safeReturnTo(value: string | null, origin: URL): string {
  if (
    !value ||
    value.length > maxReturnToLength ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("#") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return defaultReturnTo;
  }
  try {
    const target = new URL(value, origin);
    return target.origin === origin.origin
      ? `${target.pathname}${target.search}`
      : defaultReturnTo;
  } catch {
    return defaultReturnTo;
  }
}
function readCookie(header: string | undefined, name: string): string | null { const pair = header?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`)); return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null; }
function readQuery(request: FastifyRequest, name: string): string | null { const value = (request.query as Record<string, unknown>)[name]; return typeof value === "string" ? value : null; }
function setCookie(reply: FastifyReply, name: string, value: string, options: { httpOnly: boolean; maxAge: number }): void { appendCookie(reply, `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${options.maxAge}; Secure; SameSite=Lax${options.httpOnly ? "; HttpOnly" : ""}`); }
function clearCookie(reply: FastifyReply, name: string): void { appendCookie(reply, `${name}=; Path=/; Max-Age=0; Secure; SameSite=Lax; HttpOnly`); }
function appendCookie(reply: FastifyReply, value: string): void { const current = reply.getHeader("set-cookie"); reply.header("set-cookie", [...(Array.isArray(current) ? current : current ? [String(current)] : []), value]); }
