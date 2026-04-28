#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APEX_ROOT = resolve(SCRIPT_DIR, "..");
const FIXTURES_ROOT = join(APEX_ROOT, "fixtures/installer");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: options.cwd ?? APEX_ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

function git(target, args) {
  return spawnSync("git", args, {
    cwd: target,
    encoding: "utf8",
    stdio: "pipe",
  });
}

function makeTarget(root, fixtureName) {
  const target = join(root, fixtureName);
  cpSync(join(FIXTURES_ROOT, fixtureName), target, { recursive: true });
  return target;
}

function readConfig(target) {
  return JSON.parse(readFileSync(join(target, "apex.workflow.json"), "utf8"));
}

function initHarness(target, args, skillDir) {
  return run([
    join(APEX_ROOT, "scripts/init-harness.mjs"),
    `--target=${target}`,
    `--skill-dir=${skillDir}`,
    "--yes",
    ...args,
  ]);
}

function testNoAdaptersDoctor(root) {
  const target = makeTarget(root, "no-adapters");
  const skillDir = join(root, "skills");
  rmSync(join(target, ".gitignore"), { force: true });
  initHarness(target, ["--config-mode=custom", "--tracker=none", "--code-intelligence=focused-search", "--browser=none"], skillDir);

  const config = readConfig(target);
  assert(config.tracker.provider === "none", "no-adapters tracker should be none");
  assert(config.codeIntelligence.provider === "focused-search", "no-adapters should use focused-search");
  assert(config.verification.browser.provider === "none", "no-adapters browser should be none");
  assert(readFileSync(join(target, "AGENTS.md"), "utf8").includes("<!-- apex-workflow:start -->"), "AGENTS managed block missing");
  const gitignore = readFileSync(join(target, ".gitignore"), "utf8");
  assert(gitignore.includes("# apex-workflow:start"), "Apex .gitignore block missing");
  assert(gitignore.includes("tmp/apex-workflow/"), "Apex manifest artifact ignore missing");
  assert(gitignore.includes("tmp/agent-browser/"), "Apex browser artifact ignore missing");

  assert(git(target, ["init"]).status === 0, "git init failed");
  assert(git(target, ["check-ignore", "-q", "tmp/apex-workflow/fixture-slice.json"]).status === 0, "Apex manifest path should be ignored");
  assert(git(target, ["check-ignore", "-q", "tmp/agent-browser/snapshot.json"]).status === 0, "Apex browser artifact path should be ignored");
  assert(git(target, ["add", "."]).status === 0, "git add failed");
  assert(
    git(target, ["-c", "user.email=apex@example.local", "-c", "user.name=Apex Test", "commit", "-m", "baseline"]).status === 0,
    "git commit failed",
  );

  run([
    join(APEX_ROOT, "scripts/apex-doctor.mjs"),
    `--target=${target}`,
    `--skill-dir=${skillDir}`,
    "--skip-commands",
  ]);

  run([
    join(APEX_ROOT, "scripts/apex-manifest.mjs"),
    "new",
    "--config=apex.workflow.json",
    "--slug=fixture-slice",
    "--issue=none",
    "--mode=tiny",
    "--surface=product doc",
    "--files=PRODUCT.md",
    "--downshift=tiny: one known fixture doc",
    "--browser=skip: docs only",
    "--typecheck=skip: fixture docs only",
    "--required=node --version",
  ], { cwd: target });

  run([
    join(APEX_ROOT, "scripts/apex-manifest.mjs"),
    "detect",
    "--config=apex.workflow.json",
    "--slug=fixture-slice",
    "--write",
  ], { cwd: target });

  run([
    join(APEX_ROOT, "scripts/apex-manifest.mjs"),
    "close",
    "--config=apex.workflow.json",
    "--slug=fixture-slice",
    "--next=none",
  ], { cwd: target });

  const manifest = JSON.parse(readFileSync(join(target, "tmp/apex-workflow/fixture-slice.json"), "utf8"));
  assert(manifest.codeIntelligence.detect?.provider === "built-in", "detect result should be recorded");
  assert(
    manifest.checks.runs.some((entry) => entry.command === "node --version" && entry.status === "passed"),
    "required check run should be recorded",
  );
  assert(
    manifest.checks.runs.some((entry) => entry.command === "git diff --check" && entry.status === "passed"),
    "close should record git diff --check",
  );

  run([
    join(APEX_ROOT, "scripts/check-config.mjs"),
    "--config=profiles/service-desk.workflow.json",
    `--target=${target}`,
  ]);
}

function testLinearGitNexusWrapper(root) {
  const target = makeTarget(root, "linear-gitnexus-wrapper");
  const skillDir = join(root, "skills");
  initHarness(target, [
    "--config-mode=custom",
    "--tracker=linear",
    "--tracker-team=Ops",
    "--tracker-project=Launch",
    "--code-intelligence=gitnexus-wrapper",
    "--browser=none",
  ], skillDir);

  const config = readConfig(target);
  assert(config.tracker.provider === "linear", "linear fixture tracker should be linear");
  assert(config.tracker.team === "Ops", "linear fixture team missing");
  assert(config.codeIntelligence.provider === "gitnexus-wrapper", "wrapper fixture provider mismatch");
  assert(config.codeIntelligence.wrapperFallback.enabled === true, "wrapper fallback should be enabled");
  assert(config.codeIntelligence.availability.fallbackCommandReadiness === "configured", "wrapper readiness should be configured");
}

function testGitNexusMcpPreferred(root) {
  const target = makeTarget(root, "gitnexus-mcp-preferred");
  const skillDir = join(root, "skills");
  initHarness(target, ["--config-mode=custom", "--tracker=none", "--code-intelligence=gitnexus-mcp", "--browser=none"], skillDir);

  const config = readConfig(target);
  assert(config.codeIntelligence.provider === "gitnexus-mcp", "MCP fixture provider mismatch");
  assert(config.codeIntelligence.availability.configuredPreference === "gitnexus-mcp", "MCP preference not recorded");
  assert(
    config.codeIntelligence.availability.currentHostAvailability === "unknown-until-agent-session-verifies-mcp-tools",
    "MCP host availability should remain unknown at install time",
  );
}

function testExistingAgentsManagedBlock(root) {
  const target = makeTarget(root, "existing-agents-managed");
  const skillDir = join(root, "skills");
  initHarness(target, ["--config-mode=custom", "--tracker=none", "--code-intelligence=focused-search", "--browser=none"], skillDir);

  const agents = readFileSync(join(target, "AGENTS.md"), "utf8");
  assert(!agents.includes("old managed content"), "old managed block content should be replaced");
  assert((agents.match(/<!-- apex-workflow:start -->/g) ?? []).length === 1, "managed block should not duplicate");
  assert(agents.includes("Keep this repo-specific instruction."), "non-managed AGENTS content should be preserved");

  initHarness(target, ["--config-mode=custom", "--tracker=none", "--code-intelligence=focused-search", "--browser=none", "--force"], skillDir);
  const gitignore = readFileSync(join(target, ".gitignore"), "utf8");
  assert((gitignore.match(/# apex-workflow:start/g) ?? []).length === 1, ".gitignore managed block should not duplicate");
}

function testPathCasingMismatch(root) {
  const target = makeTarget(root, "path-casing-mismatch");
  const result = run([
    join(APEX_ROOT, "scripts/check-config.mjs"),
    "--config=apex.workflow.json",
    `--target=${target}`,
  ], { cwd: target, allowFailure: true });

  assert(result.status !== 0, "path casing mismatch should fail config check");
  assert(
    `${result.stdout}\n${result.stderr}`.includes("path casing does not match filesystem"),
    "path casing failure text missing",
  );
}

function testDryRunNoWrites(root) {
  const target = makeTarget(root, "dry-run-no-writes");
  const skillDir = join(root, "dry-run-skills");
  initHarness(target, ["--config-mode=custom", "--tracker=none", "--code-intelligence=focused-search", "--browser=none", "--dry-run"], skillDir);

  assert(!existsSync(join(target, "apex.workflow.json")), "dry-run should not write apex.workflow.json");
  assert(!existsSync(join(target, "AGENTS.md")), "dry-run should not write AGENTS.md");
  assert(!existsSync(join(skillDir, "apex-workflow")), "dry-run should not create skill symlink");
  assert(!readFileSync(join(target, ".gitignore"), "utf8").includes("# apex-workflow:start"), "dry-run should not update .gitignore");
}

function main() {
  mkdirSync(join(APEX_ROOT, "tmp"), { recursive: true });
  const root = mkdtempSync(join(APEX_ROOT, "tmp/apex-installer-fixtures-"));
  try {
    mkdirSync(root, { recursive: true });
    testNoAdaptersDoctor(root);
    testLinearGitNexusWrapper(root);
    testGitNexusMcpPreferred(root);
    testExistingAgentsManagedBlock(root);
    testPathCasingMismatch(root);
    testDryRunNoWrites(root);
    console.log("[apex-fixtures] ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main();
