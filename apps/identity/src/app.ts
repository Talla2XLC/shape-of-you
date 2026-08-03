import { createServer, type Server, type ServerResponse } from "node:http";

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
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: Readonly<Record<string, unknown>>
): void {
  response.writeHead(statusCode, { "content-type": contentType });
  response.end(JSON.stringify(body));
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

    writeJson(response, 404, {
      error: "not_found",
      message: "Route not found"
    });
  });
}
