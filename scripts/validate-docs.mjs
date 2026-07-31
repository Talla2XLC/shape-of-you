#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const WIKI_KINDS = new Set([
  "start",
  "vision",
  "product",
  "domain",
  "data",
  "architecture",
  "roadmap",
]);
const WIKI_STATUSES = new Set(["draft", "accepted", "deprecated"]);
const ADR_STATUSES = new Set([
  "proposed",
  "accepted",
  "superseded",
  "rejected",
]);
const WIKI_SECTIONS = [
  "Кратко",
  "Содержание",
  "Основания",
  "Решения",
  "Открытые вопросы",
  "Связанные материалы",
];
const ADR_SECTIONS = [
  "Контекст",
  "Решение",
  "Рассмотренные альтернативы",
  "Последствия",
  "Проверка",
  "Связанные материалы",
];
const decoder = new TextDecoder("utf-8", { fatal: true });

function listMarkdownFiles(root, ignoredDirectoryNames = new Set()) {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory() && !ignoredDirectoryNames.has(entry.name)) {
        pending.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(entryPath);
      }
    }
  }
  return files.sort();
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function readUtf8File(file, addViolation) {
  try {
    return decoder.decode(fs.readFileSync(file)).replace(/^\uFEFF/, "");
  } catch {
    addViolation(file, "файл не является корректным UTF-8");
    return null;
  }
}

function readFrontmatter(file, text, addViolation) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 3 || lines[0] !== "---") {
    addViolation(file, "отсутствует YAML frontmatter");
    return null;
  }

  const closing = lines.indexOf("---", 1);
  if (closing < 0) {
    addViolation(file, "YAML frontmatter не закрыт");
    return null;
  }

  const metadata = new Map();
  for (const line of lines.slice(1, closing)) {
    const match = line.match(/^([a-z][a-z0-9_]*):\s*(.*)$/);
    if (!match) {
      continue;
    }
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    metadata.set(match[1], value);
  }
  return metadata;
}

function testRequiredMetadata(file, metadata, keys, addViolation) {
  for (const key of keys) {
    const missing =
      !metadata.has(key) || (key !== "tags" && metadata.get(key).trim() === "");
    if (missing) {
      addViolation(
        file,
        `отсутствует обязательное поле frontmatter '${key}'`,
      );
    }
  }
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function testSections(file, text, sections, addViolation) {
  for (const section of sections) {
    const expression = new RegExp(
      `^## ${escapeRegularExpression(section)}\\s*\\r?\\n(.*?)(?=^## |(?![\\s\\S]))`,
      "ms",
    );
    const match = text.match(expression);
    if (!match) {
      addViolation(file, `отсутствует обязательный раздел '## ${section}'`);
    } else if (match[1].trim() === "") {
      addViolation(
        file,
        `раздел '## ${section}' пуст; добавьте содержимое или явное указание «Не применимо»`,
      );
    }
  }
}

function testLinks(repositoryRoot, file, text, addViolation) {
  for (const match of text.matchAll(/!?\[[^\]]*]\(([^)]+)\)/gm)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) {
      target = target.slice(1, -1);
    } else {
      const targetWithTitle = target.match(/^(\S+)\s+[`"'].*[`"']$/);
      if (targetWithTitle) {
        target = targetWithTitle[1];
      }
    }

    if (/^(?:https?|mailto):/i.test(target) || target.startsWith("#")) {
      continue;
    }
    if (
      /^[A-Za-z]:[\\/]/.test(target) ||
      target.startsWith("/") ||
      target.startsWith("\\")
    ) {
      addViolation(file, `локальная ссылка должна быть относительной: ${target}`);
      continue;
    }

    const pathPart = target.split("#", 1)[0];
    if (pathPart.trim() === "") {
      continue;
    }

    let decoded;
    try {
      decoded = decodeURIComponent(pathPart);
    } catch {
      addViolation(file, `локальная ссылка содержит некорректное кодирование: ${target}`);
      continue;
    }

    const resolved = path.resolve(path.dirname(file), decoded);
    if (!isWithin(repositoryRoot, resolved)) {
      addViolation(
        file,
        `относительная ссылка выходит за пределы репозитория: ${target}`,
      );
      continue;
    }
    if (!fs.existsSync(resolved)) {
      addViolation(file, `цель относительной ссылки не существует: ${target}`);
    }
    if (
      /(?:^|[\\/])\.env(?:$|[./\\])|\.pem$|\.key$|\.pfx$|\.p12$|\.sql(?:ite3?)?$|\.dump$/i.test(
        decoded,
      )
    ) {
      addViolation(
        file,
        `ссылка ведёт на запрещённый чувствительный файл: ${target}`,
      );
    }
  }
}

function testContentSafety(file, text, addViolation) {
  if (/^(?:<<<<<<<|=======|>>>>>>>)/m.test(text)) {
    addViolation(file, "обнаружен неразрешённый marker конфликта слияния");
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
    addViolation(file, "обнаружен блок private key");
  }
  if (
    /^\s*(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*[`"']?[A-Za-z0-9_\-+/=]{12,}/im.test(
      text,
    )
  ) {
    addViolation(file, "обнаружено значение, похожее на credentials");
  }
}

/**
 * Validates canonical Wiki and ADR Markdown without changing repository state.
 *
 * @param {string} repositoryRoot Absolute or relative repository root.
 * @returns {{errors: string[], wikiCount: number, adrCount: number, idCount: number}}
 * Validation errors and document counters.
 */
export function validateDocumentation(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const wikiRoot = path.join(root, "docs", "wiki");
  const adrRoot = path.join(root, "docs", "adr");
  const templateRoot = path.join(root, "docs", "templates");
  const errors = [];
  const ids = new Map();
  const displayPath = (file) =>
    isWithin(root, file) ? path.relative(root, file) || "." : file;
  const addViolation = (file, message) => {
    errors.push(`${displayPath(file)}: ${message}`);
  };

  for (const directory of [wikiRoot, adrRoot, templateRoot]) {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      addViolation(directory, "отсутствует обязательный каталог");
    }
  }

  const wikiFiles = listMarkdownFiles(wikiRoot);
  const adrFiles = listMarkdownFiles(adrRoot);
  if (wikiFiles.length === 0) {
    addViolation(wikiRoot, "страницы Wiki не найдены");
  }
  if (adrFiles.length === 0) {
    addViolation(adrRoot, "файлы ADR не найдены");
  }

  for (const file of [...wikiFiles, ...adrFiles]) {
    const text = readUtf8File(file, addViolation);
    if (text === null) {
      continue;
    }

    testContentSafety(file, text, addViolation);
    testLinks(root, file, text, addViolation);
    const metadata = readFrontmatter(file, text, addViolation);
    if (metadata === null) {
      continue;
    }

    testRequiredMetadata(
      file,
      metadata,
      ["id", "kind", "title", "status", "tags"],
      addViolation,
    );
    const id = metadata.get("id");
    if (id?.trim()) {
      if (ids.has(id)) {
        addViolation(
          file,
          `identifier '${id}' уже используется в ${ids.get(id)}`,
        );
      } else {
        ids.set(id, displayPath(file));
      }
    }

    const isAdr = isWithin(adrRoot, file);
    if (isAdr) {
      testRequiredMetadata(
        file,
        metadata,
        ["date", "supersedes", "superseded_by"],
        addViolation,
      );
      if (metadata.has("kind") && metadata.get("kind") !== "adr") {
        addViolation(file, "ADR должен иметь kind: adr");
      }
      if (
        metadata.has("status") &&
        !ADR_STATUSES.has(metadata.get("status"))
      ) {
        addViolation(
          file,
          `недопустимый status ADR: ${metadata.get("status")}`,
        );
      }

      const nameMatch = path
        .basename(file)
        .match(/^(\d{8})-[a-z0-9-]+\.md$/);
      if (!nameMatch) {
        addViolation(
          file,
          "имя файла ADR должно соответствовать YYYYMMDD-kebab-case.md",
        );
      } else if (metadata.has("date")) {
        const datePrefix = nameMatch[1];
        const expectedDate = `${datePrefix.slice(0, 4)}-${datePrefix.slice(4, 6)}-${datePrefix.slice(6, 8)}`;
        if (metadata.get("date") !== expectedDate) {
          addViolation(
            file,
            `date '${metadata.get("date")}' не соответствует префиксу имени файла`,
          );
        }
      }
      testSections(file, text, ADR_SECTIONS, addViolation);
    } else {
      if (
        metadata.has("kind") &&
        !WIKI_KINDS.has(metadata.get("kind"))
      ) {
        addViolation(
          file,
          `недопустимый kind Wiki: ${metadata.get("kind")}`,
        );
      }
      if (
        metadata.has("status") &&
        !WIKI_STATUSES.has(metadata.get("status"))
      ) {
        addViolation(
          file,
          `недопустимый status Wiki: ${metadata.get("status")}`,
        );
      }
      testSections(file, text, WIKI_SECTIONS, addViolation);
    }
  }

  const managedExportRoot = path.join(root, ".4dt", "wiki", "pages");
  for (const file of listMarkdownFiles(managedExportRoot)) {
    addViolation(
      file,
      "обнаружен Markdown managed Wiki вне канонических путей",
    );
  }

  for (const file of listMarkdownFiles(root, new Set([".git", "node_modules"]))) {
    if (
      isWithin(wikiRoot, file) ||
      isWithin(adrRoot, file) ||
      isWithin(templateRoot, file)
    ) {
      continue;
    }
    const text = readUtf8File(file, addViolation);
    if (
      text !== null &&
      /^---\s[\s\S]*?^owner:\s*wiki\s*$[\s\S]*?^---\s*$/m.test(text)
    ) {
      addViolation(
        file,
        "обнаружен frontmatter managed Wiki вне канонических путей",
      );
    }
  }

  return {
    errors: errors.sort(),
    wikiCount: wikiFiles.length,
    adrCount: adrFiles.length,
    idCount: ids.size,
  };
}

function parseRootArgument(argv) {
  const rootIndex = argv.indexOf("--root");
  if (rootIndex >= 0) {
    if (!argv[rootIndex + 1]) {
      throw new Error("Для --root требуется путь.");
    }
    return path.resolve(argv[rootIndex + 1]);
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  let result;
  try {
    result = validateDocumentation(parseRootArgument(process.argv.slice(2)));
  } catch (error) {
    console.error(`Проверка документации не запущена: ${error.message}`);
    process.exitCode = 1;
  }

  if (result) {
    if (result.errors.length > 0) {
      console.error(
        `Проверка документации завершилась ошибкой: нарушений — ${result.errors.length}.`,
      );
      for (const violation of result.errors) {
        console.error(`- ${violation}`);
      }
      process.exitCode = 1;
    } else {
      console.log(
        `Проверка документации пройдена: страниц Wiki — ${result.wikiCount}, ADR — ${result.adrCount}, уникальных id — ${result.idCount}.`,
      );
    }
  }
}
