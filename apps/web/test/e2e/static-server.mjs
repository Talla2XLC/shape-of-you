import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("../../.output/public/", import.meta.url).pathname;
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"]
]);

async function resolveFile(pathname) {
  const safePath = normalize(decodeURIComponent(pathname))
    .replace(/^(\.\.(\/|\\|$))+/, "")
    .replace(/^[/\\]+/, "");
  let candidate = join(root, safePath);
  try {
    const details = await stat(candidate);
    if (details.isDirectory()) candidate = join(candidate, "index.html");
    await stat(candidate);
    return candidate;
  } catch {
    return join(root, "200.html");
  }
}

createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1:4173").pathname;
    const file = await resolveFile(pathname);
    const body = await readFile(file);
    response.writeHead(200, {
      "cache-control": pathname.startsWith("/_nuxt/")
        ? "public, max-age=31536000, immutable"
        : "no-store",
      "content-type": contentTypes.get(extname(file)) ?? "application/octet-stream"
    });
    response.end(body);
  } catch {
    response.writeHead(500);
    response.end();
  }
}).listen(4173, "127.0.0.1");
