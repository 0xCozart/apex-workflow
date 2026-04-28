#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? APEX_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
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

function makeTarget(root, fixtureName, targetName = fixtureName) {
  const target = join(root, targetName);
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

  const doctor = run([
    join(APEX_ROOT, "scripts/apex-doctor.mjs"),
    `--target=${target}`,
    `--skill-dir=${skillDir}`,
    "--skip-commands",
  ]);
  assert(
    doctor.stdout.includes("executable trust boundary"),
    "doctor should warn about trusted executable command configuration",
  );

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

function testReconciliationOwnedFilesOnly(root) {
  const target = makeTarget(root, "no-adapters", "no-adapters-reconciliation");
  const skillDir = join(root, "skills-reconciliation");
  initHarness(target, ["--config-mode=custom", "--tracker=none", "--code-intelligence=focused-search", "--browser=none"], skillDir);

  assert(git(target, ["init"]).status === 0, "git init failed");
  assert(git(target, ["add", "."]).status === 0, "git add failed");
  assert(
    git(target, ["-c", "user.email=apex@example.local", "-c", "user.name=Apex Test", "commit", "-m", "baseline"]).status === 0,
    "git commit failed",
  );

  writeFileSync(join(target, "UNRELATED.md"), "pre-existing external dirty work\n");

  run([
    join(APEX_ROOT, "scripts/apex-manifest.mjs"),
    "new",
    "--config=apex.workflow.json",
    "--slug=reconcile-slice",
    "--issue=none",
    "--mode=reconciliation",
    "--surface=manual evidence reconciliation",
  ], { cwd: target });

  run([
    join(APEX_ROOT, "scripts/apex-manifest.mjs"),
    "detect",
    "--config=apex.workflow.json",
    "--slug=reconcile-slice",
    "--write",
  ], { cwd: target });

  run([
    join(APEX_ROOT, "scripts/apex-manifest.mjs"),
    "record-evidence",
    "--config=apex.workflow.json",
    "--slug=reconcile-slice",
    "--kind=manual-terminal",
    "--summary=TUI launched with selected provider and real session id",
    "--source=fixture terminal",
  ], { cwd: target });

  run([
    join(APEX_ROOT, "scripts/apex-manifest.mjs"),
    "close",
    "--config=apex.workflow.json",
    "--slug=reconcile-slice",
    "--next=none",
  ], { cwd: target });

  const manifest = JSON.parse(readFileSync(join(target, "tmp/apex-workflow/reconcile-slice.json"), "utf8"));
  assert(manifest.scope?.dirtyPolicy === "owned-files-only", "reconciliation should default to owned-files-only dirty policy");
  assert(
    manifest.scope?.externalDirtyFiles?.includes("UNRELATED.md"),
    "external dirty file should be recorded on manifest scope",
  );
  assert(
    manifest.codeIntelligence.detect?.externalDirtyFiles?.includes("UNRELATED.md"),
    "external dirty file should be recorded in detect result",
  );
  assert(
    manifest.evidence?.some((entry) => entry.kind === "manual-terminal" && entry.summary.includes("real session id")),
    "manual terminal evidence should be recorded",
  );
  assert(
    manifest.checks.runs.some((entry) => entry.command === "git diff --check" && entry.status === "skipped"),
    "close should skip broad diff check when owned-files-only reconciliation has no owned files",
  );
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
  assert(config.codeIntelligence.freshnessGate.enabled === true, "wrapper fixture should enable freshness gate");
}

function testGitNexusFreshnessGate(root) {
  const target = makeTarget(root, "linear-gitnexus-wrapper", "gitnexus-freshness-gate");
  const skillDir = join(root, "skills-freshness");
  initHarness(target, [
    "--config-mode=custom",
    "--tracker=none",
    "--code-intelligence=gitnexus-wrapper",
    "--browser=none",
  ], skillDir);

  assert(git(target, ["init"]).status === 0, "git init failed");
  assert(git(target, ["add", "."]).status === 0, "git add failed");
  assert(
    git(target, ["-c", "user.email=apex@example.local", "-c", "user.name=Apex Test", "commit", "-m", "baseline"]).status === 0,
    "git commit failed",
  );

  run([
    join(APEX_ROOT, "scripts/apex-manifest.mjs"),
    "new",
    "--config=apex.workflow.json",
    "--slug=freshness-slice",
    "--issue=none",
    "--mode=route-local",
    "--surface=product doc",
    "--files=PRODUCT.md",
    "--downshift=route-local: one product doc owner",
    "--browser=skip: docs only",
    "--typecheck=skip: fixture docs only",
    "--required=node --version",
  ], { cwd: target });

  const missingGate = run([
    join(APEX_ROOT, "scripts/apex-manifest.mjs"),
    "close",
    "--config=apex.workflow.json",
    "--slug=freshness-slice",
    "--next=none",
  ], { cwd: target, allowFailure: true });
  assert(missingGate.status !== 0, "GitNexus close should fail without freshness records");
  assert(
    `${missingGate.stdout}\n${missingGate.stderr}`.includes("preSliceStatus is required"),
    "freshness gate should report missing preSliceStatus",
  );

  run([
    join(APEX_ROOT, "scripts/apex-manifest.mjs"),
    "record-gitnexus-freshness",
    "--config=apex.workflow.json",
    "--slug=freshness-slice",
    "--phase=pre-status",
    "--status=fresh",
    "--command=npm run gitnexus:status",
  ], { cwd: target });

  const missingPost = run([
    join(APEX_ROOT, "scripts/apex-manifest.mjs"),
    "finish",
    "--config=apex.workflow.json",
    "--slug=freshness-slice",
    "--next=none",
  ], { cwd: target, allowFailure: true });
  assert(missingPost.status !== 0, "GitNexus finish should fail without post freshness disposition");
  assert(
    `${missingPost.stdout}\n${missingPost.stderr}`.includes("postSliceRefresh or postSliceSkipReason"),
    "freshness gate should report missing post-slice disposition",
  );

  run([
    join(APEX_ROOT, "scripts/apex-manifest.mjs"),
    "record-gitnexus-freshness",
    "--config=apex.workflow.json",
    "--slug=freshness-slice",
    "--phase=post-skip",
    "--status=skipped",
    "--reason=docs-only fixture slice",
  ], { cwd: target });

  run([
    join(APEX_ROOT, "scripts/apex-manifest.mjs"),
    "close",
    "--config=apex.workflow.json",
    "--slug=freshness-slice",
    "--next=none",
  ], { cwd: target });

  const manifest = JSON.parse(readFileSync(join(target, "tmp/apex-workflow/freshness-slice.json"), "utf8"));
  assert(manifest.codeIntelligence.freshness.preSliceStatus.status === "fresh", "preSliceStatus should be recorded");
  assert(
    manifest.codeIntelligence.freshness.postSliceSkipReason.reason === "docs-only fixture slice",
    "postSliceSkipReason should be recorded",
  );

  run([
    join(APEX_ROOT, "scripts/apex-manifest.mjs"),
    "new",
    "--config=apex.workflow.json",
    "--slug=stale-slice",
    "--issue=none",
    "--mode=route-local",
    "--surface=product doc",
    "--files=PRODUCT.md",
    "--downshift=route-local: one product doc owner",
    "--browser=skip: docs only",
    "--typecheck=skip: fixture docs only",
    "--required=node --version",
  ], { cwd: target });
  run([
    join(APEX_ROOT, "scripts/apex-manifest.mjs"),
    "record-gitnexus-freshness",
    "--config=apex.workflow.json",
    "--slug=stale-slice",
    "--phase=pre-status",
    "--status=stale",
    "--command=npm run gitnexus:status",
  ], { cwd: target });
  run([
    join(APEX_ROOT, "scripts/apex-manifest.mjs"),
    "record-gitnexus-freshness",
    "--config=apex.workflow.json",
    "--slug=stale-slice",
    "--phase=post-skip",
    "--status=skipped",
    "--reason=fixture no follow-up graph work",
  ], { cwd: target });
  const missingRefresh = run([
    join(APEX_ROOT, "scripts/apex-manifest.mjs"),
    "finish",
    "--config=apex.workflow.json",
    "--slug=stale-slice",
    "--next=none",
  ], { cwd: target, allowFailure: true });
  assert(missingRefresh.status !== 0, "stale preSliceStatus should require preSliceRefresh");
  assert(
    `${missingRefresh.stdout}\n${missingRefresh.stderr}`.includes("preSliceRefresh is required"),
    "freshness gate should report missing preSliceRefresh",
  );
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

function testSchemaValidation(root) {
  const valid = run([
    join(APEX_ROOT, "scripts/check-config.mjs"),
    "--config=profiles/service-desk.workflow.json",
    "--target=fixtures/config/service-desk",
    "--format=json",
  ]);
  const validJson = JSON.parse(valid.stdout);
  assert(validJson.ok === true, "valid profile should pass JSON check-config");
  assert(validJson.schema.ok === true, "valid profile should pass schema validation");
  assert(validJson.repoChecks.ok === true, "valid profile should pass repo checks");

  const invalidConfig = join(root, "invalid-schema.workflow.json");
  writeFileSync(
    invalidConfig,
    JSON.stringify(
      {
        version: 1,
        name: "invalid-schema-fixture",
      },
      null,
      2,
    ),
  );
  const invalid = run([
    join(APEX_ROOT, "scripts/check-config.mjs"),
    `--config=${invalidConfig}`,
    "--target=fixtures/config/service-desk",
    "--format=json",
  ], { allowFailure: true });
  assert(invalid.status !== 0, "schema-invalid profile should fail");
  const invalidJson = JSON.parse(invalid.stdout);
  assert(invalidJson.schema.ok === false, "schema-invalid profile should report schema failure");
  assert(invalidJson.repoChecks.skipped === true, "repo checks should be skipped when schema fails");
  assert(
    invalidJson.schema.errors.some((error) => error.message.includes("must have required property")),
    "schema errors should include required property details",
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

function testPortableCliEntrypoints(root) {
  const packRoot = join(root, "pack");
  const installRoot = join(root, "cli-install");
  const target = makeTarget(root, "no-adapters", "portable-cli-target");
  const skillDir = join(root, "portable-cli-skills");
  mkdirSync(packRoot, { recursive: true });
  mkdirSync(installRoot, { recursive: true });
  writeFileSync(join(installRoot, "package.json"), JSON.stringify({ private: true }, null, 2));

  const npmEnv = { npm_config_cache: join(root, "npm-cache") };
  const pack = runCommand("npm", ["pack", "--pack-destination", packRoot, "--silent"], { env: npmEnv });
  const tarball = join(packRoot, pack.stdout.trim().split("\n").pop());
  runCommand("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], { cwd: installRoot, env: npmEnv });

  const binDir = join(installRoot, "node_modules/.bin");
  const apexInit = join(binDir, "apex-init");
  const apexDoctor = join(binDir, "apex-doctor");
  const apexManifest = join(binDir, "apex-manifest");
  const apexCheckConfig = join(binDir, "apex-check-config");

  runCommand(apexInit, [
    `--target=${target}`,
    `--skill-dir=${skillDir}`,
    "--config-mode=custom",
    "--tracker=none",
    "--code-intelligence=focused-search",
    "--browser=none",
    "--yes",
  ]);

  runCommand(apexCheckConfig, ["--config=apex.workflow.json", "--target=."], { cwd: target });
  assert(git(target, ["init"]).status === 0, "git init failed");
  assert(git(target, ["add", "."]).status === 0, "git add failed");
  assert(
    git(target, ["-c", "user.email=apex@example.local", "-c", "user.name=Apex Test", "commit", "-m", "baseline"]).status === 0,
    "git commit failed",
  );
  runCommand(apexDoctor, [`--target=${target}`, "--config=apex.workflow.json", `--skill-dir=${skillDir}`, "--skip-commands"]);
  runCommand(apexManifest, [
    "new",
    "--config=apex.workflow.json",
    "--slug=portable-cli",
    "--issue=none",
    "--mode=planning",
    "--surface=fixture docs",
    "--downshift=planning: cli shim smoke test",
  ], { cwd: target });
}

function testPortabilityScan() {
  const result = run([join(APEX_ROOT, "scripts/check-portability.mjs")]);
  assert(result.stdout.includes("[apex-portability] ok"), "portability scan should pass");
}

function testTrustModelDocs() {
  assert(existsSync(join(APEX_ROOT, "SECURITY.md")), "SECURITY.md should document the trust model");
  const security = readFileSync(join(APEX_ROOT, "SECURITY.md"), "utf8");
  assert(security.includes("trusted executable workflow configuration"), "SECURITY.md should name executable trust boundary");
  assert(security.includes("Do not run Apex against untrusted profiles"), "SECURITY.md should warn about untrusted profiles");
  const readme = readFileSync(join(APEX_ROOT, "README.md"), "utf8");
  assert(readme.includes("[SECURITY.md](SECURITY.md)"), "README should link SECURITY.md");
  const skill = readFileSync(join(APEX_ROOT, "skills/apex-workflow/SKILL.md"), "utf8");
  assert(skill.includes("trusted executable workflow configuration"), "skill should describe trust boundary");
}

function main() {
  mkdirSync(join(APEX_ROOT, "tmp"), { recursive: true });
  const root = mkdtempSync(join(APEX_ROOT, "tmp/apex-installer-fixtures-"));
  try {
    mkdirSync(root, { recursive: true });
    testNoAdaptersDoctor(root);
    testReconciliationOwnedFilesOnly(root);
    testLinearGitNexusWrapper(root);
    testGitNexusFreshnessGate(root);
    testGitNexusMcpPreferred(root);
    testExistingAgentsManagedBlock(root);
    testSchemaValidation(root);
    testPathCasingMismatch(root);
    testDryRunNoWrites(root);
    testPortableCliEntrypoints(root);
    testPortabilityScan();
    testTrustModelDocs();
    console.log("[apex-fixtures] ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main();
