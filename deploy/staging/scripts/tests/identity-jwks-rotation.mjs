import { createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const helper = readFileSync(new URL("../verify-identity-jwks.mjs", import.meta.url), "utf8");
const pair = (kid) => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privateKey,
    jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" }
  };
};
const old = pair("old");
const next = pair("new");
const stage = { keys: [old.jwk, next.jwk] };
const retired = { keys: [next.jwk] };
const probe = (jwks, expectedOld = "present") => spawnSync(
  process.execPath,
  ["--input-type=module", "--eval", helper, "old", "new", expectedOld],
  { input: JSON.stringify(jwks), encoding: "utf8" }
).status;
const token = (kid, privateKey) => {
  const body = `${Buffer.from(JSON.stringify({ alg: "ES256", kid })).toString("base64url")}.e30`;
  const signature = sign("sha256", Buffer.from(body), {
    key: privateKey,
    dsaEncoding: "ieee-p1363"
  }).toString("base64url");
  return `${body}.${signature}`;
};
const accepts = (jwt, jwks) => {
  const [header, payload, signature] = jwt.split(".");
  const kid = JSON.parse(Buffer.from(header, "base64url").toString("utf8")).kid;
  const jwk = jwks.keys.find((entry) => entry.kid === kid);
  return !!jwk && verify("sha256", Buffer.from(`${header}.${payload}`), {
    key: createPublicKey({ key: jwk, format: "jwk" }),
    dsaEncoding: "ieee-p1363"
  }, Buffer.from(signature, "base64url"));
};
const oldJwt = token("old", old.privateKey);
const newJwt = token("new", next.privateKey);

if (probe(stage) !== 0 || probe(retired, "absent") !== 0) {
  throw new Error("Valid stage or retirement JWKS failed structural validation");
}
if (probe({ keys: [], hint: { kid: "new" } }) === 0 ||
    probe({ keys: [{ kid: "new" }] }) === 0 ||
    probe({ keys: [old.jwk, { ...next.jwk, d: "private" }] }) === 0) {
  throw new Error("False or unsafe JWKS passed structural validation");
}
const warmClientBeforeRefresh = { keys: [old.jwk] };
const coldClientAfterPublication = stage;
const warmClientAfterRefresh = stage;
if (!accepts(oldJwt, warmClientBeforeRefresh) ||
    !accepts(oldJwt, coldClientAfterPublication) ||
    !accepts(newJwt, coldClientAfterPublication) ||
    !accepts(oldJwt, warmClientAfterRefresh) ||
    !accepts(newJwt, warmClientAfterRefresh) ||
    accepts(newJwt, warmClientBeforeRefresh) ||
    accepts(oldJwt, retired) ||
    !accepts(newJwt, retired)) {
  throw new Error("Warm/cold JWT acceptance does not match the rotation phases");
}
console.log("Identity JWKS rotation verification passed.");
