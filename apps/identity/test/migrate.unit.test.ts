import { describe, expect, it, vi } from "vitest";

import {
  assessIdentityMigrationJournal,
  describeIdentityMigrationError,
  waitForIdentityDatabaseReadiness
} from "../src/database/migrate.js";

const firstMigration = {
  createdAt: "1754000000000",
  hash: "a".repeat(64)
};
const secondMigration = {
  createdAt: "1754000000001",
  hash: "b".repeat(64)
};

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
        message: "Identity migration operation failed"
      },
      {
        name: "Error",
        message: "Identity migration operation failed",
        code: "ECONNREFUSED",
        severity: "ERROR"
      }
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("super-secret");
    expect(JSON.stringify(diagnostics)).not.toContain("CREATE SCHEMA");
  });

  it("recognizes an exact current journal and an exact pending prefix", () => {
    expect(
      assessIdentityMigrationJournal(
        [firstMigration, secondMigration],
        [firstMigration, secondMigration]
      )
    ).toBe("current");
    expect(
      assessIdentityMigrationJournal(
        [firstMigration, secondMigration],
        [firstMigration]
      )
    ).toBe("pending");
    expect(
      assessIdentityMigrationJournal([firstMigration, secondMigration], [])
    ).toBe("pending");
  });

  it("fails closed when the database journal is ahead or divergent", () => {
    expect(() =>
      assessIdentityMigrationJournal(
        [firstMigration],
        [firstMigration, secondMigration]
      )
    ).toThrow("ahead");
    expect(() =>
      assessIdentityMigrationJournal(
        [firstMigration, secondMigration],
        [firstMigration, { ...secondMigration, hash: "c".repeat(64) }]
      )
    ).toThrow("diverges at entry 1");
    expect(() =>
      assessIdentityMigrationJournal(
        [firstMigration, secondMigration],
        [firstMigration, { ...secondMigration, createdAt: "1754000000999" }]
      )
    ).toThrow("diverges at entry 1");
  });

  it("fails closed on malformed migration journal metadata", () => {
    expect(() => assessIdentityMigrationJournal([], [])).toThrow(
      "local migration journal is empty"
    );
    expect(() =>
      assessIdentityMigrationJournal(
        [firstMigration],
        [{ createdAt: "not-a-timestamp", hash: "a".repeat(64) }]
      )
    ).toThrow("malformed created_at");
    expect(() =>
      assessIdentityMigrationJournal(
        [firstMigration],
        [{ createdAt: firstMigration.createdAt, hash: "not-a-hash" }]
      )
    ).toThrow("malformed hash");
    expect(() =>
      assessIdentityMigrationJournal(
        [firstMigration, secondMigration],
        [secondMigration, firstMigration]
      )
    ).toThrow("not strictly ordered");
  });
});
