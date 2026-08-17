import { generateKeyPairSync, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { Socket, createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { spawn } from "node:child_process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const composeFile = "test/browser-auth-e2e.compose.yaml";
const children = new Set();
const servers = new Set();
const projectName = `soy-browser-e2e-${process.pid}`;
let temporaryDirectory;
let composeEnvironment;

function run(command, arguments_, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd: repositoryRoot,
      env: options.env ?? process.env,
      stdio: [options.input === undefined ? "inherit" : "pipe", "inherit", "inherit"]
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${code ?? signal ?? "unknown status"}`));
    });
  });
}

function start(command, arguments_, env) {
  const child = spawn(command, arguments_, {
    cwd: repositoryRoot,
    env,
    stdio: "inherit"
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local port"));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolvePromise(port));
    });
  });
}

async function waitFor(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The process may still be starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Timed out waiting for ${new URL(url).pathname}`);
}

async function waitForPort(port, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const connected = await new Promise((resolvePromise) => {
      const socket = new Socket();
      socket.setTimeout(250);
      socket.once("connect", () => {
        socket.destroy();
        resolvePromise(true);
      });
      socket.once("error", () => resolvePromise(false));
      socket.once("timeout", () => {
        socket.destroy();
        resolvePromise(false);
      });
      socket.connect(port, "127.0.0.1");
    });
    if (connected) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Timed out waiting for local database port ${port}`);
}

function proxyRequest(request, response, port, path) {
  const upstream = httpRequest({
    hostname: "127.0.0.1",
    port,
    method: request.method,
    path,
    headers: {
      ...request.headers,
      "x-forwarded-for": request.socket.remoteAddress ?? "127.0.0.1",
      "x-forwarded-proto": "https"
    }
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.pipe(upstream);
}

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"]
]);

async function staticFile(publicDirectory, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?", 1)[0]);
  const relative = normalize(decoded).replace(/^[/\\]+/, "");
  const candidates = relative && extname(relative)
    ? [relative]
    : [join(relative, "index.html"), relative ? `${relative}.html` : "index.html", "200.html"];
  for (const candidate of candidates) {
    const file = resolve(publicDirectory, candidate);
    if (!file.startsWith(`${resolve(publicDirectory)}/`)) continue;
    try {
      if ((await stat(file)).isFile()) return file;
    } catch {
      // Try the next generated static route.
    }
  }
  return null;
}

function startTlsFrontend({ certificate, key, port, publicDirectory, route }) {
  const server = createHttpsServer({ cert: certificate, key }, async (request, response) => {
    try {
      const path = request.url ?? "/";
      const destination = route(path);
      if (destination) {
        proxyRequest(request, response, destination.port, destination.path);
        return;
      }
      const file = await staticFile(publicDirectory, path);
      if (!file) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": contentTypes.get(extname(file)) ?? "application/octet-stream"
      });
      createReadStream(file).pipe(response);
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
  servers.add(server);
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePromise(server);
    });
  });
}

async function closeAll() {
  for (const child of children) child.kill("SIGTERM");
  await Promise.all([...children].map((child) => new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolvePromise();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  })));
  await Promise.all([...servers].map((server) => new Promise((resolvePromise) => {
    server.close(() => resolvePromise());
  })));
  if (composeEnvironment) {
    await run("docker", [
      "compose", "--project-name", projectName, "--file", composeFile,
      "down", "--volumes", "--remove-orphans", "--timeout", "10"
    ], { env: composeEnvironment }).catch(() => undefined);
  }
  if (temporaryDirectory) await rm(temporaryDirectory, { force: true, recursive: true });
}

async function main() {
  let [apiDatabasePort, identityDatabasePort, apiPort, identityPort, appTlsPort, identityTlsPort] =
    await Promise.all(Array.from({ length: 6 }, () => freePort()));
  temporaryDirectory = await mkdtemp(join(tmpdir(), "shape-of-you-browser-e2e-"));
  const certificatePath = join(temporaryDirectory, "localhost.crt");
  const keyPath = join(temporaryDirectory, "localhost.key");
  const authorityPath = join(temporaryDirectory, "authority.json");
  const identityOrigin = `https://localhost:${identityTlsPort}`;
  const appOrigin = `https://localhost:${appTlsPort}`;
  const resource = `${appOrigin}/api/mcp`;

  composeEnvironment = {
    ...process.env,
    BROWSER_E2E_API_DATABASE_PORT: String(apiDatabasePort),
    BROWSER_E2E_IDENTITY_DATABASE_PORT: String(identityDatabasePort)
  };
  await run("docker", [
    "compose", "--project-name", projectName, "--file", composeFile,
    "up", "--detach", "--wait", "api-database", "identity-database"
  ], { env: composeEnvironment });
  await Promise.all([
    waitForPort(apiDatabasePort),
    waitForPort(identityDatabasePort)
  ]);
  const apiDatabaseUrl = `postgresql://shape_of_you_api:shape_of_you_api@127.0.0.1:${apiDatabasePort}/shape_of_you_api`;
  const identityDatabaseUrl = `postgresql://shape_of_you_identity:shape_of_you_identity@127.0.0.1:${identityDatabasePort}/shape_of_you_identity`;

  await run("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1",
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "-addext", "basicConstraints=critical,CA:TRUE", "-keyout", keyPath, "-out", certificatePath
  ]);

  await run("pnpm", ["--filter", "@shape-of-you/config", "build"]);
  await run("pnpm", ["--filter", "@shape-of-you/contracts", "build"]);
  await run("pnpm", ["--filter", "@shape-of-you/api", "build"]);
  await run("pnpm", ["--filter", "@shape-of-you/identity", "build"]);

  const privateKey = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "der", type: "pkcs8" },
    publicKeyEncoding: { format: "der", type: "spki" }
  }).privateKey.toString("base64url");
  const identityEnvironment = {
    ...process.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: String(identityPort),
    DATABASE_URL: identityDatabaseUrl,
    DATABASE_POOL_MAX: "4",
    IDENTITY_PUBLIC_ORIGIN: identityOrigin,
    WEBAUTHN_RP_ID: "localhost",
    WEBAUTHN_RP_NAME: "Shape of You E2E",
    IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID: "browser-e2e-v1",
    IDENTITY_OAUTH_SIGNING_KEYS: JSON.stringify({ "browser-e2e-v1": privateKey }),
    IDENTITY_OAUTH_COOKIE_KEYS: JSON.stringify([randomBytes(32).toString("base64url")]),
    IDENTITY_OAUTH_RESOURCE: resource,
    LOG_LEVEL: "silent"
  };
  const apiEnvironment = {
    ...process.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: String(apiPort),
    DATABASE_URL: apiDatabaseUrl,
    LOG_LEVEL: "silent",
    PERSON_CONTEXT_MODE: "authenticated",
    IDENTITY_OAUTH_ISSUER: identityOrigin,
    IDENTITY_OAUTH_JWKS_URI: `${identityOrigin}/oauth/jwks`,
    IDENTITY_OAUTH_RESOURCE: resource,
    API_BROWSER_ORIGIN: appOrigin,
    API_BROWSER_OAUTH_CLIENT_ID: "shape-of-you-browser-e2e",
    API_BROWSER_SESSION_KEYS: randomBytes(32).toString("base64url"),
    NODE_EXTRA_CA_CERTS: certificatePath
  };

  await run("node", ["apps/identity/dist/database/migrate.js"], { env: identityEnvironment });
  await run("node", ["apps/api/dist/database/migrate.js"], { env: apiEnvironment });
  await run("pnpm", [
    "--filter", "@shape-of-you/identity", "exec", "tsx",
    "test/support/bootstrap-browser-e2e.ts", "--output", authorityPath
  ], { env: identityEnvironment });
  const authority = JSON.parse(await readFile(authorityPath, "utf8"));
  if (typeof authority.oauthSubject !== "string" || typeof authority.enrollmentToken !== "string") {
    throw new Error("Browser E2E bootstrap returned an invalid authority file");
  }
  await run("node", [
    "apps/api/dist/commands/manage-identity-access.js", "--action", "ensure",
    "--issuer", identityOrigin, "--subject-stdin", "--quiet"
  ], { env: apiEnvironment, input: authority.oauthSubject });
  await run("node", [
    "apps/identity/dist/commands/provision-oauth-client.js",
    "--client-id", "shape-of-you-browser-e2e",
    "--display-name", "Shape of You Browser E2E",
    "--redirect-uri", `${appOrigin}/api/browser-auth/callback`,
    "--scopes", "openid"
  ], { env: identityEnvironment });

  await run("pnpm", ["--filter", "@shape-of-you/web", "exec", "nuxt", "generate"], {
    env: { ...process.env, NUXT_PUBLIC_IDENTITY_ORIGIN: identityOrigin }
  });
  const publicDirectory = resolve(repositoryRoot, "apps/web/.output/public");
  const certificate = await readFile(certificatePath);
  const key = await readFile(keyPath);
  start("node", ["apps/identity/dist/server.js"], identityEnvironment);
  start("node", ["apps/api/dist/server.js"], apiEnvironment);
  await waitFor(`http://127.0.0.1:${identityPort}/ready`);
  await waitFor(`http://127.0.0.1:${apiPort}/ready`);

  await startTlsFrontend({
    certificate, key, port: identityTlsPort, publicDirectory,
    route: (path) => /^(\/\.well-known|\/live|\/oauth|\/ready|\/v1)(?:\/|\?|$)/.test(path)
      ? { port: identityPort, path }
      : null
  });
  await startTlsFrontend({
    certificate, key, port: appTlsPort, publicDirectory,
    route: (path) => path === "/api" || path.startsWith("/api/")
      ? { port: apiPort, path: path.slice(4) || "/" }
      : null
  });

  await run("pnpm", [
    "--filter", "@shape-of-you/web", "exec", "playwright", "test",
    "--config", "playwright.full-auth.config.mjs"
  ], {
    env: {
      ...process.env,
      BROWSER_AUTH_E2E_BASE_URL: appOrigin,
      BROWSER_AUTH_E2E_AUTHORITY_FILE: authorityPath
    }
  });
}

try {
  await main();
} finally {
  await closeAll();
}
