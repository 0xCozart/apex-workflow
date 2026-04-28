#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SCAN_ROOTS = [
  ".github",
  "AGENTS.md",
  "README.md",
  "docs",
  "fixtures",
  "package.json",
  "package-lock.json",
  "profiles",
  "schemas",
  "scripts",
  "skills",
  "templates",
];

const IGNORE_DIRS = new Set([".git", "node_modules", "tmp"]);
const ALLOWED_NEGATIVE_FIXTURE = ["fixtures", "negative", "private-paths"].join(sep);
const wslCursorRoot = ["/mnt", "d", "CURSOR"].join("/");
const wslCursorRootLower = ["/mnt", "d", "cursor"].join("/");
const macHomeRoot = ["/Users", ""].join("/");
const cursorDir = ["/", "CURSOR"].join("");

const forbiddenPatterns = [
  {
    name: "private WSL cursor path",
    pattern: new RegExp(`(?:${escapeRegex(wslCursorRoot)}|${escapeRegex(wslCursorRootLower)})(?:/|$)`),
  },
  {
    name: "private macOS cursor path",
    pattern: new RegExp(`${escapeRegex(macHomeRoot)}[^\\n"'\` ]*${escapeRegex(cursorDir)}(?:/|$)`),
  },
  {
    name: "private Windows drive path",
    pattern: /\b[A-Za-z]:[\\/][^\n"'` ]*(?:CURSOR|cursor)[\\/]/,
  },
];

const TEXT_EXTENSIONS = new Set([
  "",
  ".cjs",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extension(filePath) {
  const base = filePath.split(/[\\/]/).pop() ?? "";
  const index = base.lastIndexOf(".");
  return index === -1 ? "" : base.slice(index);
}

function walk(entryPath, out = []) {
  const stats = statSync(entryPath);
  if (stats.isDirectory()) {
    const name = entryPath.split(sep).pop();
    if (IGNORE_DIRS.has(name)) return out;
    for (const child of readdirSync(entryPath)) walk(join(entryPath, child), out);
    return out;
  }

  if (!stats.isFile()) return out;
  const rel = relative(ROOT, entryPath);
  if (rel.includes(ALLOWED_NEGATIVE_FIXTURE)) return out;
  if (!TEXT_EXTENSIONS.has(extension(rel))) return out;
  out.push(entryPath);
  return out;
}

function lineAndColumn(text, index) {
  const before = text.slice(0, index);
  const lines = before.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function main() {
  const files = [];
  for (const scanRoot of SCAN_ROOTS) {
    try {
      walk(join(ROOT, scanRoot), files);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  const failures = [];
  for (const filePath of files) {
    const rel = relative(ROOT, filePath);
    const text = readFileSync(filePath, "utf8");
    for (const forbidden of forbiddenPatterns) {
      const match = forbidden.pattern.exec(text);
      if (!match) continue;
      const position = lineAndColumn(text, match.index);
      failures.push(`${rel}:${position.line}:${position.column} contains ${forbidden.name}`);
    }
  }

  if (failures.length > 0) {
    console.error("[apex-portability] forbidden maintainer-local paths found:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(`[apex-portability] ok: scanned ${files.length} files`);
}

main();
