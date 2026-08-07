import { describe, expect, it } from "vitest";

import { RequestPersonContext } from "../src/application/person-context.js";

describe("RequestPersonContext", () => {
  it("isolates concurrent authorized Person operations", async () => {
    const context = new RequestPersonContext();
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";

    const observed = await Promise.all([
      context.run(first, async () => {
        await Promise.resolve();
        return context.getPersonId();
      }),
      context.run(second, async () => {
        await Promise.resolve();
        return context.getPersonId();
      })
    ]);

    expect(observed).toEqual([first, second]);
    expect(() => context.getPersonId()).toThrow("required");
  });
});
