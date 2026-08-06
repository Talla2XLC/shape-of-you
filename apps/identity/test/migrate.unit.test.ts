import { describe, expect, it, vi } from "vitest";

import {
  describeIdentityMigrationError,
  waitForIdentityDatabaseReadiness
} from "../src/database/migrate.js";

describe("Identity migration startup", () => {
  it("retries only the readiness probe until it succeeds", async () => {
    const check = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValue(undefined);
    const sleep = vi.fn<(delayMs: number) => Promise<void>>().mockResolvedValue();

    await expect(
      waitForIdentityDatabaseReadiness(check, {
        attempts: 3,
        delayMs: 25,
        sleep
      })
    ).resolves.toBe(3);

    expect(check).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 25);
    expect(sleep).toHaveBeenNthCalledWith(2, 25);
  });

  it("throws the final readiness failure without invoking migrations", async () => {
    const finalError = new Error("still unavailable");
    const check = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockRejectedValueOnce(finalError);
    const sleep = vi.fn<(delayMs: number) => Promise<void>>().mockResolvedValue();

    await expect(
      waitForIdentityDatabaseReadiness(check, {
        attempts: 2,
        delayMs: 0,
        sleep
      })
    ).rejects.toBe(finalError);

    expect(check).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("reports a bounded error cause chain without credentials", () => {
    const databaseError = Object.assign(
      new Error(
        "connect postgresql://identity:super-secret@db.example.test/identity"
      ),
      {
        code: "ECONNREFUSED",
        detail: "password=super-secret",
        hint: "retry later",
        severity: "ERROR"
      }
    );
    const wrapper = new Error("Failed query: CREATE SCHEMA", {
      cause: databaseError
    });

    const diagnostics = describeIdentityMigrationError(wrapper);

    expect(diagnostics).toEqual([
      {
        name: "Error",
        message: "Failed query: CREATE SCHEMA"
      },
      {
        name: "Error",
        message:
          "connect postgresql://identity:[redacted]@db.example.test/identity",
        code: "ECONNREFUSED",
        severity: "ERROR",
        detail: "password=[redacted]",
        hint: "retry later"
      }
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("super-secret");
  });
});
