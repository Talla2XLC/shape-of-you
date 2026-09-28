import { parseIdentityOAuthDeniedKids } from "@shape-of-you/config";
import { assertAllowedIdentityTokenKid } from "./dist/identity/assert-allowed-token-kid.js";

const [oldKid, newKid] = process.argv.slice(1);
const denied = parseIdentityOAuthDeniedKids(process.env.IDENTITY_OAUTH_DENIED_KIDS);
const token = (kid) =>
  `${Buffer.from(JSON.stringify({ alg: "ES256", kid })).toString("base64url")}.e30.signature`;

if (!denied.has(oldKid)) {
  throw new Error("Running API does not contain the incident key denial");
}
let oldRejected = false;
try {
  assertAllowedIdentityTokenKid(token(oldKid), denied);
} catch {
  oldRejected = true;
}
if (!oldRejected) {
  throw new Error("Running API permits the incident key identifier");
}
assertAllowedIdentityTokenKid(token(newKid), denied);
