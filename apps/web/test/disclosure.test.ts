import { describe, expect, it } from "vitest";

import { nextDisclosureState } from "../app/lib/disclosure";

describe("disclosure state", () => {
  it("starts collapsed and toggles open and closed", () => {
    let expanded = false;

    expect(expanded).toBe(false);
    expanded = nextDisclosureState(expanded);
    expect(expanded).toBe(true);
    expanded = nextDisclosureState(expanded);
    expect(expanded).toBe(false);
  });
});
