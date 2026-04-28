#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APEX_ROOT = resolve(SCRIPT_DIR, "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? APEX_ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

function nodeScript(scriptName, args, options = {}) {
  return run(process.execPath, [join(APEX_ROOT, "scripts", scriptName), ...args], options);
}

function git(target, args) {
  return run("git", args, { cwd: target });
}

function writeDemoTarget(target) {
  mkdirSync(join(target, "docs/feature-artifacts"), { recursive: true });
  mkdirSync(join(target, "docs/state-contracts"), { recursive: true });
  writeFileSync(join(target, "package.json"), `${JSON.stringify({
    name: "apex-demo-target",
    private: true,
    scripts: {
      test: "node --version",
    },
  }, null, 2)}\n`);
  writeFileSync(join(target, "README.md"), "# Apex Demo Target\n\nTemporary app for Apex quickstart smoke testing.\n");
  writeFileSync(join(target, "PRODUCT.md"), "# Product\n\nOperators can verify Apex on a clean demo target.\n");
  writeFileSync(join(target, ".gitignore"), "node_modules/\ntmp/\n");
}

function main() {
  const keep = process.env.APEX_KEEP_DEMO === "1";
  const root = mkdtempSync(join(tmpdir(), "apex-demo-smoke-"));
  const target = join(root, "target");
  const skillDir = join(root, "skills");

  try {
    mkdirSync(target, { recursive: true });
    writeDemoTarget(target);

    nodeScript("init-harness.mjs", [
      `--target=${target}`,
      `--skill-dir=${skillDir}`,
      "--config-mode=custom",
      "--tracker=none",
      "--code-intelligence=focused-search",
      "--browser=none",
      "--yes",
    ]);

    git(target, ["init"]);
    git(target, ["add", "."]);
    git(target, ["-c", "user.email=apex@example.local", "-c", "user.name=Apex Test", "commit", "-m", "baseline"]);

    nodeScript("apex-doctor.mjs", [`--target=${target}`, "--config=apex.workflow.json", `--skill-dir=${skillDir}`, "--skip-commands"]);
    nodeScript("apex-manifest.mjs", [
      "new",
      "--config=apex.workflow.json",
      "--slug=quickstart-demo",
      "--issue=none",
      "--mode=tiny",
      "--surface=README demo doc",
      "--files=README.md",
      "--downshift=tiny: quickstart smoke touches one known doc",
      "--browser=skip: no UI in demo target",
      "--typecheck=skip: demo target has no typecheck",
      "--required=npm test",
    ], { cwd: target });
    nodeScript("apex-manifest.mjs", ["detect", "--config=apex.workflow.json", "--slug=quickstart-demo", "--write"], { cwd: target });
    nodeScript("apex-manifest.mjs", ["run-check", "--config=apex.workflow.json", "--slug=quickstart-demo", "--cmd=npm test"], { cwd: target });
    nodeScript("apex-manifest.mjs", [
      "close",
      "--config=apex.workflow.json",
      "--slug=quickstart-demo",
      "--skip-required",
      "--next=none",
    ], { cwd: target });
    nodeScript("apex-manifest.mjs", ["finish", "--config=apex.workflow.json", "--slug=quickstart-demo", "--next=none"], { cwd: target });

    const manifest = JSON.parse(readFileSync(join(target, "tmp/apex-workflow/quickstart-demo.json"), "utf8"));
    if (!manifest.checks?.runs?.some((run) => run.command === "npm test" && run.status === "passed")) {
      throw new Error("demo manifest did not record npm test");
    }

    console.log(`[apex-demo] ok: ${target}`);
  } finally {
    if (!keep) rmSync(root, { recursive: true, force: true });
    else console.log(`[apex-demo] kept: ${root}`);
  }
}

main();
