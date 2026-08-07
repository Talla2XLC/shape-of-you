import { describe, expect, it } from "vitest";

import { IdentityApiError } from "../app/lib/identity-api";
import { userMessage } from "../app/lib/user-message";
import { BrowserPasskeyError } from "../app/lib/webauthn";

describe("safe user messages", () => {
  it("maps browser cancellation without protocol details", () => {
    expect(userMessage(new BrowserPasskeyError("cancelled"))).toContain("closed");
  });

  it("maps server errors through an allowlisted message", () => {
    const message = userMessage(new IdentityApiError(409, "last_authentication_method"));
    expect(message).toContain("another passkey");
    expect(message).not.toContain("last_authentication_method");
  });
});
