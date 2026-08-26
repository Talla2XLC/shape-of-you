import { describe, expect, it, vi } from "vitest";

import {
  aggregateAllDomainReports,
  runAllDomainImports
} from "../src/commands/import-fitness-tracker.js";
import type { SafeImportReport } from "../src/import/contracts.js";
import type { FitnessTrackerImportDomain } from "../src/import/fitness-tracker-sheets-reader.js";

const domains = [
  "weight",
  "body",
  "nutrition",
  "training",
  "recovery"
] as const satisfies readonly FitnessTrackerImportDomain[];

const snapshotFiles = Object.fromEntries(
  domains.map((domain) => [domain, `/private/${domain}.json`])
) as Readonly<Record<FitnessTrackerImportDomain, string>>;

function report(
  domain: FitnessTrackerImportDomain,
  counts: SafeImportReport["counts"],
  mode: SafeImportReport["mode"] = "dry_run"
): SafeImportReport {
  return {
    version: 1,
    mode,
    domain,
    sourceManifestChecksum: `${domain}-manifest`,
    counts,
    findings: []
  };
}

describe("Fitness Tracker all-domain orchestration", () => {
  it("runs separate typed snapshots in deterministic order and aggregates counts", async () => {
    const runner = vi.fn(async (domain: FitnessTrackerImportDomain) => report(
      domain,
      { created: 1, unchanged: 2, conflict: 3, invalid: 4 }
    ));

    const result = await runAllDomainImports("dry-run", snapshotFiles, runner);

    expect(runner.mock.calls).toEqual(domains.map((domain) => [
      domain,
      `/private/${domain}.json`
    ]));
    expect(result).toMatchObject({
      version: 1,
      mode: "dry_run",
      domain: "all",
      counts: { created: 5, unchanged: 10, conflict: 15, invalid: 20 },
      failures: []
    });
    expect(result.domains.map(({ domain }) => domain)).toEqual(domains);
  });

  it("continues after one domain fails and exposes no exception text", async () => {
    const runner = vi.fn(async (domain: FitnessTrackerImportDomain) => {
      if (domain === "nutrition") {
        throw new Error("private source value must not escape");
      }
      return report(domain, {
        created: domain === "weight" ? 1 : 0,
        unchanged: 1,
        conflict: 0,
        invalid: 0
      }, "apply");
    });

    const result = await runAllDomainImports("apply", snapshotFiles, runner);

    expect(runner).toHaveBeenCalledTimes(5);
    expect(result.mode).toBe("apply");
    expect(result.counts).toEqual({
      created: 1,
      unchanged: 4,
      conflict: 0,
      invalid: 0
    });
    expect(result.failures).toEqual([{
      domain: "nutrition",
      code: "domain_execution_failed"
    }]);
    expect(JSON.stringify(result)).not.toContain("private source value");
  });

  it("produces byte-stable aggregate output for repeated reconciliation", () => {
    const reports = domains.map((domain) => report(domain, {
      created: 0,
      unchanged: 1,
      conflict: 0,
      invalid: 0
    }));

    const first = aggregateAllDomainReports("dry-run", reports, []);
    const repeated = aggregateAllDomainReports("dry-run", reports, []);

    expect(JSON.stringify(repeated)).toBe(JSON.stringify(first));
  });
});
