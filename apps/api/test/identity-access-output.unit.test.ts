import { describe, expect, it } from "vitest";

import {
  formatIdentityAccessLifecycle,
  formatIdentityAccessProvisioning
} from "../src/commands/identity-access-output.js";

describe("Identity access provisioning command output", () => {
  it("contains only stable status and API-owned authorization identifiers", () => {
    expect(
      formatIdentityAccessProvisioning({
        personId: "00000000-0000-4000-8000-000000000202",
        status: "created",
        userId: "00000000-0000-4000-8000-000000000201"
      })
    ).toBe(
      "Identity access created.\n" +
        "User: 00000000-0000-4000-8000-000000000201\n" +
        "Person: 00000000-0000-4000-8000-000000000202\n" +
        "Role: owner\n"
    );
  });

  it("formats lifecycle output without external identity or credential data", () => {
    expect(
      formatIdentityAccessLifecycle({
        grantId: "00000000-0000-4000-8000-000000000203",
        personId: "00000000-0000-4000-8000-000000000202",
        status: "revoked",
        userId: "00000000-0000-4000-8000-000000000201"
      })
    ).toBe(
      "Identity access revoked.\n" +
        "User: 00000000-0000-4000-8000-000000000201\n" +
        "Person: 00000000-0000-4000-8000-000000000202\n" +
        "Grant: 00000000-0000-4000-8000-000000000203\n" +
        "Role: owner\n"
    );
  });
});
