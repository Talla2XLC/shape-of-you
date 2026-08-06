import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";

import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON
} from "@simplewebauthn/server";
import { z } from "zod";

import {
  IdentityAuthenticationError,
  type IdentityAuthenticationService
} from "./authentication/service.js";

const contentType = "application/json; charset=utf-8";

/** Dependency used by the Identity readiness endpoint. */
export interface IdentityReadinessProbe {
  /** Resolves when required runtime dependencies are available. */
  check(): Promise<void>;
}

/** Dependencies required to create the Identity HTTP server. */
export interface IdentityServerDependencies {
  /** Readiness probe for the service-owned PostgreSQL database. */
  readonly readiness: IdentityReadinessProbe;
  /** Optional passkey application service when authentication routes are enabled. */
  readonly authentication?: IdentityAuthenticationService;
  /** Exact browser Origin accepted by every POST route. */
  readonly publicOrigin?: string;
}

const challengeSchema = z.object({ challengeId: z.string().uuid() });
const registrationVerificationSchema = challengeSchema.extend({
  label: z.string().trim().min(1).max(200).optional(),
  response: z.object({ id: z.string().min(1) }).passthrough()
});
const authenticationVerificationSchema = challengeSchema.extend({
  response: z.object({ id: z.string().min(1) }).passthrough()
});

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: Readonly<Record<string, unknown>>
): void {
  response.writeHead(statusCode, { "content-type": contentType });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 64 * 1024) {
      throw new IdentityAuthenticationError(413, "payload_too_large", "Request body is too large");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new IdentityAuthenticationError(400, "invalid_json", "Request body must be valid JSON");
  }
}

function requestAuthority(request: IncomingMessage) {
  return {
    authorization: request.headers.authorization,
    cookie: request.headers.cookie,
    csrfToken:
      typeof request.headers["x-csrf-token"] === "string"
        ? request.headers["x-csrf-token"]
        : undefined
  };
}

async function handleAuthenticationRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: IdentityServerDependencies
): Promise<boolean> {
  if (request.method !== "POST") return false;
  if (!dependencies.authentication || !dependencies.publicOrigin) return false;
  response.setHeader("cache-control", "no-store");
  if (request.headers.origin !== dependencies.publicOrigin) {
    throw new IdentityAuthenticationError(403, "invalid_origin", "Request Origin is not allowed");
  }
  if (pathname === "/v1/webauthn/registration/options") {
    const result = await dependencies.authentication.createRegistrationOptions(
      requestAuthority(request)
    );
    writeJson(response, 200, result);
    return true;
  }
  if (pathname === "/v1/webauthn/registration/verify") {
    const body = registrationVerificationSchema.parse(await readJson(request));
    const result = await dependencies.authentication.verifyRegistration({
      authority: requestAuthority(request),
      challengeId: body.challengeId,
      label: body.label,
      response: body.response as unknown as RegistrationResponseJSON
    });
    writeJson(response, 201, result);
    return true;
  }
  if (pathname === "/v1/webauthn/authentication/options") {
    const result = await dependencies.authentication.createAuthenticationOptions();
    writeJson(response, 200, result);
    return true;
  }
  if (pathname === "/v1/webauthn/authentication/verify") {
    const body = authenticationVerificationSchema.parse(await readJson(request));
    const result = await dependencies.authentication.verifyAuthentication({
      challengeId: body.challengeId,
      response: body.response as unknown as AuthenticationResponseJSON
    });
    response.setHeader("set-cookie", result.cookie);
    writeJson(response, 200, result.body);
    return true;
  }
  return false;
}

/**
 * Creates the Identity HTTP server without opening a network listener.
 *
 * Liveness remains dependency-free while readiness verifies the service-owned
 * PostgreSQL database. OAuth/OIDC routes are attached in a later increment
 * behind the accepted protocol adapter.
 *
 * @param dependencies - Runtime dependencies used by HTTP handlers.
 * @returns An unstarted Node.js HTTP server owned by the caller.
 */
export function createIdentityServer(
  dependencies: IdentityServerDependencies
): Server {
  return createServer((request, response) => {
    const method = request.method ?? "GET";
    const pathname = new URL(request.url ?? "/", "http://identity.local").pathname;

    if (method === "GET" && pathname === "/live") {
      writeJson(response, 200, { status: "alive" });
      return;
    }

    if (method === "GET" && pathname === "/ready") {
      void dependencies.readiness.check().then(
        () => {
          writeJson(response, 200, { status: "ready" });
        },
        () => {
          writeJson(response, 503, { status: "not_ready" });
        }
      );
      return;
    }

    void handleAuthenticationRequest(request, response, pathname, dependencies)
      .then((handled) => {
        if (!handled && !response.writableEnded) {
          writeJson(response, 404, {
            error: "not_found",
            message: "Route not found"
          });
        }
      })
      .catch((error: unknown) => {
        if (response.writableEnded) return;
        if (error instanceof IdentityAuthenticationError) {
          writeJson(response, error.statusCode, {
            error: error.code,
            message: error.message
          });
          return;
        }
        if (error instanceof z.ZodError) {
          writeJson(response, 400, {
            error: "invalid_request",
            message: "Request body is invalid"
          });
          return;
        }
        writeJson(response, 500, {
          error: "internal_error",
          message: "Internal server error"
        });
      });
  });
}
