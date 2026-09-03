import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertRecoveryErasureManifestComplete,
  readPrivateRecoveryErasureManifest,
  writePrivateRecoveryErasureManifest,
  type RecoveryErasureManifest
} from "../src/recovery/recovery-erasure-manifest.js";

const manifest: RecoveryErasureManifest = {
  version: 1,
  generatedAt: "2026-09-03T12:00:00.000Z",
  completeThrough: "2026-09-03T11:59:59.000Z",
  markers: [],
  sha256: "90cdeeed039ecfa3798f8ca34b3e2a587647c7c1b02689d4c82def445e5f06e4"
};

describe("Recovery erasure manifest", () => {
  it("round-trips a private immutable manifest and checks completeness", async () => {
    const directory = await mkdtemp(join(tmpdir(), "shape-of-you-erasure-"));
    const path = join(directory, "manifest.json");
    await writePrivateRecoveryErasureManifest(path, manifest);

    const restored = await readPrivateRecoveryErasureManifest(path);
    expect(restored).toEqual(manifest);
    expect(() => assertRecoveryErasureManifestComplete(
      restored,
      "2026-09-03T11:59:59.000Z"
    )).not.toThrow();
    expect(() => assertRecoveryErasureManifestComplete(
      restored,
      "2026-09-03T12:00:00.000Z"
    )).toThrow("incomplete");
    await expect(writePrivateRecoveryErasureManifest(path, manifest)).rejects.toThrow();
  });

  it("rejects permissive permissions and tampering", async () => {
    const directory = await mkdtemp(join(tmpdir(), "shape-of-you-erasure-"));
    const path = join(directory, "manifest.json");
    await writePrivateRecoveryErasureManifest(path, manifest);
    await chmod(path, 0o644);
    await expect(readPrivateRecoveryErasureManifest(path)).rejects.toThrow("mode-0600");
    await chmod(path, 0o600);
    const raw = await readFile(path, "utf8");
    await writeFile(path, raw.replace("11:59:59", "11:59:58"), { mode: 0o600 });
    await expect(readPrivateRecoveryErasureManifest(path)).rejects.toThrow("does not match");
  });
});
