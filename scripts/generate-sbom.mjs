#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

const outPath = join("tmp", "apex-workflow", "sbom.json");
mkdirSync(dirname(outPath), { recursive: true });

const npmCommand = process.env.npm_execpath ? process.execPath : "npm";
const npmArgs = process.env.npm_execpath
  ? [process.env.npm_execpath, "sbom", "--json", "--sbom-format=cyclonedx"]
  : ["sbom", "--json", "--sbom-format=cyclonedx"];
const result = spawnSync(npmCommand, npmArgs, {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: "pipe",
});

if (result.status !== 0) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

writeFileSync(outPath, result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
console.log(`[apex-supply-chain] wrote ${outPath}`);
