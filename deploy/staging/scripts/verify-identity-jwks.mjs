import { createPublicKey } from "node:crypto";

const [oldKid, newKid, expectedOld] = process.argv.slice(1);
const input = await new Promise((resolve, reject) => {
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  process.stdin.on("error", reject);
});

let document;
try {
  document = JSON.parse(input);
} catch {
  throw new Error("External JWKS is not JSON");
}
if (!document || !Array.isArray(document.keys)) {
  throw new Error("External JWKS has no keys array");
}
const keys = new Map();
for (const jwk of document.keys) {
  if (
    !jwk || typeof jwk !== "object" ||
    typeof jwk.kid !== "string" || keys.has(jwk.kid) ||
    jwk.kty !== "EC" || jwk.crv !== "P-256" ||
    jwk.alg !== "ES256" || jwk.use !== "sig" ||
    typeof jwk.x !== "string" || typeof jwk.y !== "string" ||
    "d" in jwk
  ) {
    throw new Error("External JWKS contains an invalid or duplicate signing key");
  }
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  if (publicKey.asymmetricKeyType !== "ec" ||
      publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("External JWKS contains an unusable signing key");
  }
  keys.set(jwk.kid, publicKey);
}
if (!keys.has(newKid) || (expectedOld === "present") !== keys.has(oldKid)) {
  throw new Error("External JWKS has the wrong key lifecycle state");
}
