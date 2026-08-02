import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateDocumentation } from "./validate-docs.mjs";

const wikiSections = [
  "Summary",
  "Content",
  "Evidence",
  "Decisions",
  "Open questions",
  "Related material",
];
const adrSections = [
  "Context",
  "Decision",
  "Considered alternatives",
  "Consequences",
  "Verification",
  "Related material",
];

function sections(names) {
  return names.map((name) => `## ${name}\n\nVerified.`).join("\n\n");
}

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "shape-of-you-docs-"));
  mkdirSync(path.join(root, "docs", "wiki"), { recursive: true });
  mkdirSync(path.join(root, "docs", "adr"), { recursive: true });
  mkdirSync(path.join(root, "docs", "templates"), { recursive: true });
  writeFileSync(
    path.join(root, "docs", "wiki", "start.md"),
    `---
id: wiki-start
kind: start
title: "Start"
status: accepted
tags:
  - docs
---

# Start

${sections(wikiSections)}
`,
  );
  writeFileSync(
    path.join(root, "docs", "adr", "20260731-test-decision.md"),
    `---
id: adr-test
kind: adr
title: "Test decision"
status: accepted
date: 2026-07-31
supersedes: []
superseded_by: null
tags:
  - docs
---

# Test decision

${sections(adrSections)}
`,
  );
  return root;
}

test("accepts a valid canonical documentation fixture", () => {
  const root = createFixture();
  try {
    assert.deepEqual(validateDocumentation(root), {
      errors: [],
      wikiCount: 1,
      adrCount: 1,
      idCount: 2,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports representative metadata, section, and link violations", () => {
  const root = createFixture();
  try {
    mkdirSync(path.join(root, ".4dt", "wiki", "pages"), {
      recursive: true,
    });
    writeFileSync(
      path.join(root, ".4dt", "wiki", "pages", "legacy.md"),
      "# Legacy\n",
    );
    writeFileSync(
      path.join(root, "legacy-wiki.md"),
      `---
owner: wiki
---

# Legacy
`,
    );
    writeFileSync(
      path.join(root, "docs", "wiki", "broken.md"),
      `---
id: wiki-start
kind: invalid
title: "Broken"
status: unknown
tags:
---

# Broken

[missing](missing.md)
[absolute](/tmp/file.md)
[windows](C:\\file.md)
[outside](../../../outside.md)
[sensitive](../../.env)

${"<".repeat(7)} current
-----BEGIN PRIVATE KEY-----
api_key: ${"abcdefghijkl"}
`,
    );
    writeFileSync(
      path.join(root, "docs", "wiki", "invalid-utf8.md"),
      Buffer.from([0xff, 0xfe, 0xfd]),
    );
    writeFileSync(
      path.join(root, "docs", "adr", "bad.md"),
      `---
id: adr-bad
kind: wrong
title: "Broken decision"
status: unknown
tags:
---

# Broken decision
`,
    );
    const result = validateDocumentation(root);
    assert.ok(
      result.errors.some((error) => error.includes("is already used")),
    );
    assert.ok(
      result.errors.some((error) =>
        error.includes("invalid Wiki kind"),
      ),
    );
    assert.ok(
      result.errors.some((error) =>
        error.includes("required section"),
      ),
    );
    assert.ok(
      result.errors.some((error) =>
        error.includes("relative link target does not exist"),
      ),
    );
    for (const expected of [
      "local link must be relative",
      "relative link escapes the repository",
      "link points to a forbidden sensitive file",
      "merge conflict marker",
      "private key block",
      "credential-like value",
      "file is not valid UTF-8",
      "ADR must have kind: adr",
      "invalid ADR status",
      "ADR filename must match",
      "required frontmatter field 'date' is missing",
      "managed Wiki Markdown found outside canonical paths",
      "managed Wiki frontmatter found outside canonical paths",
    ]) {
      assert.ok(
        result.errors.some((error) => error.includes(expected)),
        `Expected violation containing: ${expected}`,
      );
    }
    const cli = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./validate-docs.mjs", import.meta.url)),
        "--root",
        root,
      ],
      { encoding: "utf8" },
    );
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /Documentation validation failed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports missing canonical documentation directories", () => {
  const root = mkdtempSync(path.join(tmpdir(), "shape-of-you-docs-empty-"));
  try {
    const result = validateDocumentation(root);
    assert.ok(
      result.errors.filter((error) =>
        error.includes("required directory is missing"),
      ).length === 3,
    );
    assert.ok(
      result.errors.some((error) => error.includes("Wiki pages were not found")),
    );
    assert.ok(
      result.errors.some((error) => error.includes("ADR files were not found")),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
