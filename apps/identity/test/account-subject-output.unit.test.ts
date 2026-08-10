import { describe, expect, it } from "vitest";

import { formatIdentityAccountSubject } from "../src/commands/account-subject-output.js";

describe("account subject command output", () => {
  it("contains only the stable status, account id, and public subject", () => {
    expect(
      formatIdentityAccountSubject({
        accountId: "00000000-0000-4000-8000-000000000101",
        subject: "public-subject"
      })
    ).toBe(
      "Identity account subject resolved.\n" +
        "Account: 00000000-0000-4000-8000-000000000101\n" +
        "Subject: public-subject\n"
    );
  });
});
