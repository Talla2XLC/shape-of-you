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
  "Кратко",
  "Содержание",
  "Основания",
  "Решения",
  "Открытые вопросы",
  "Связанные материалы",
];
const adrSections = [
  "Контекст",
  "Решение",
  "Рассмотренные альтернативы",
  "Последствия",
  "Проверка",
  "Связанные материалы",
];

function sections(names) {
  return names.map((name) => `## ${name}\n\nПроверено.`).join("\n\n");
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
title: "Старт"
status: accepted
tags:
  - docs
---

# Старт

${sections(wikiSections)}
`,
  );
  writeFileSync(
    path.join(root, "docs", "adr", "20260731-test-decision.md"),
    `---
id: adr-test
kind: adr
title: "Тестовое решение"
status: accepted
date: 2026-07-31
supersedes: []
superseded_by: null
tags:
  - docs
---

# Тестовое решение

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
title: "Сломанная"
status: unknown
tags:
---

# Сломанная

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
title: "Сломанное решение"
status: unknown
tags:
---

# Сломанное решение
`,
    );
    const result = validateDocumentation(root);
    assert.ok(
      result.errors.some((error) => error.includes("уже используется")),
    );
    assert.ok(
      result.errors.some((error) =>
        error.includes("недопустимый kind Wiki"),
      ),
    );
    assert.ok(
      result.errors.some((error) =>
        error.includes("отсутствует обязательный раздел"),
      ),
    );
    assert.ok(
      result.errors.some((error) =>
        error.includes("цель относительной ссылки не существует"),
      ),
    );
    for (const expected of [
      "локальная ссылка должна быть относительной",
      "относительная ссылка выходит за пределы репозитория",
      "ссылка ведёт на запрещённый чувствительный файл",
      "marker конфликта слияния",
      "блок private key",
      "похожее на credentials",
      "файл не является корректным UTF-8",
      "ADR должен иметь kind: adr",
      "недопустимый status ADR",
      "имя файла ADR должно соответствовать",
      "отсутствует обязательное поле frontmatter 'date'",
      "обнаружен Markdown managed Wiki вне канонических путей",
      "обнаружен frontmatter managed Wiki вне канонических путей",
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
    assert.match(cli.stderr, /Проверка документации завершилась ошибкой/);
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
        error.includes("отсутствует обязательный каталог"),
      ).length === 3,
    );
    assert.ok(
      result.errors.some((error) => error.includes("страницы Wiki не найдены")),
    );
    assert.ok(
      result.errors.some((error) => error.includes("файлы ADR не найдены")),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
