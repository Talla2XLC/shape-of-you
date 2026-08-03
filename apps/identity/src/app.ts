import { createServer, type Server, type ServerResponse } from "node:http";

const contentType = "application/json; charset=utf-8";

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
 * The scaffold exposes dependency-free health endpoints. OAuth/OIDC routes are
 * attached in a later increment behind the accepted protocol adapter.
 *
 * @returns An unstarted Node.js HTTP server owned by the caller.
 */
export function createIdentityServer(): Server {
  return createServer((request, response) => {
    const method = request.method ?? "GET";
    const pathname = new URL(request.url ?? "/", "http://identity.local").pathname;

    if (method === "GET" && pathname === "/live") {
      writeJson(response, 200, { status: "alive" });
      return;
    }

    if (method === "GET" && pathname === "/ready") {
      writeJson(response, 200, { status: "ready" });
      return;
    }

    writeJson(response, 404, {
      error: "not_found",
      message: "Route not found"
    });
  });
}
