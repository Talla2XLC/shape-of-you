import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  canonicalSnapshotChecksum,
  createCutoverManifest,
  createRollbackPlan,
  cutoverDomains,
  cutoverWriterTools,
  readPrivateCutoverManifest,
  verifyCutoverWriterEvidence,
  verifyFrozenSnapshots,
  writePrivateCutoverManifest
} from "../src/cutover/preflight.js";

const checksums = Object.fromEntries(
  cutoverDomains.map((domain) => [domain, canonicalSnapshotChecksum({ domain })])
) as Record<(typeof cutoverDomains)[number], string>;

const reconciliation = {
  version: 1 as const,
  mode: "dry_run" as const,
  domain: "all" as const,
  counts: { created: 0, unchanged: 428, conflict: 0, invalid: 46 },
  domains: [],
  failures: []
};

describe("cutover preflight", () => {
  it("creates a private immutable checkpoint manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "shape-cutover-"));
    const path = join(directory, "manifest.json");
    const manifest = createCutoverManifest({
      workbookId: "workbook-1",
      checkpointAt: "2026-08-26T16:00:00.000Z",
      gitCommit: "0123456789abcdef",
      snapshotChecksums: checksums,
      reconciliation
    });
    await writePrivateCutoverManifest(path, manifest);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readPrivateCutoverManifest(path)).toEqual(manifest);
    await expect(writePrivateCutoverManifest(path, manifest)).rejects.toThrow();
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 1 });
  });

  it("rejects missing facts or conflicts at the final checkpoint", () => {
    expect(() => createCutoverManifest({
      workbookId: "workbook-1",
      checkpointAt: "2026-08-26T16:00:00.000Z",
      gitCommit: "0123456789abcdef",
      snapshotChecksums: checksums,
      reconciliation: {
        ...reconciliation,
        counts: { ...reconciliation.counts, created: 1 }
      }
    })).toThrow("not cutover-ready");
  });

  it("detects any bounded source drift after checkpoint", () => {
    const manifest = createCutoverManifest({
      workbookId: "workbook-1",
      checkpointAt: "2026-08-26T16:00:00.000Z",
      gitCommit: "0123456789abcdef",
      snapshotChecksums: checksums,
      reconciliation
    });
    expect(() => verifyFrozenSnapshots(manifest, {
      ...checksums,
      recovery: canonicalSnapshotChecksum({ changed: true })
    })).toThrow("recovery");
  });

  it("requires the exact tool scopes and successful write read-back canaries", () => {
    const tools = cutoverWriterTools.map(({ name, scope }) => ({ name, scope }));
    const canaries = cutoverWriterTools
      .filter((tool) => tool.canaryRequired)
      .map((tool) => ({ tool: tool.name, success: true, readBack: true }));
    expect(() => verifyCutoverWriterEvidence({ tools, canaries })).not.toThrow();
    expect(() => verifyCutoverWriterEvidence({
      tools,
      canaries: canaries.filter((item) => item.tool !== "close_day")
    })).toThrow("close_day");
  });

  it("builds a deterministic zero-write post-checkpoint replay plan", () => {
    const plan = createRollbackPlan("2026-08-26T16:00:00.000Z", [
      {
        kind: "meal",
        id: "00000000-0000-4000-8000-000000000002",
        localDate: "2026-08-26",
        createdAt: "2026-08-26T16:02:00.000Z"
      },
      {
        kind: "daily_context_note",
        id: "00000000-0000-4000-8000-000000000001",
        localDate: "2026-08-26",
        createdAt: "2026-08-26T16:01:00.000Z"
      }
    ]);
    expect(plan.requiresReplay).toBe(true);
    expect(plan.facts.map((fact) => fact.kind)).toEqual([
      "daily_context_note",
      "meal"
    ]);
    expect(plan.counts).toMatchObject({ meal: 1, daily_context_note: 1 });
  });
});
