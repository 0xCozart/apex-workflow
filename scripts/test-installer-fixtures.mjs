#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { lockPathForManifest } from "./lib/manifest-store.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APEX_ROOT = resolve(SCRIPT_DIR, "..");
const FIXTURES_ROOT = join(APEX_ROOT, "fixtures/installer");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
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

function portableCommand(command) {
  const value = String(command);
  if (process.platform !== "win32") return value;
  if (
    value.toLowerCase().endsWith(".cmd") ||
    value.toLowerCase().endsWith(".exe") ||
    value.toLowerCase().endsWith(".bat")
  ) {
    return value;
  }
  const cmdShim = `${value}.cmd`;
  if (existsSync(cmdShim)) return cmdShim;
  if (!value.includes("/") && !value.includes("\\")) return cmdShim;
  return value;
}

function runCommand(command, args, options = {}) {
  const resolvedCommand = portableCommand(command);
  const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(resolvedCommand);
  const result = spawnSync(resolvedCommand, args, {
    cwd: options.cwd ?? APEX_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    shell: useShell,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(
      `${resolvedCommand} ${args.join(" ")} failed\nerror:\n${result.error?.message ?? ""}\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`,
    );
  }
  return result;
}

function runNodeModule(source, options = {}) {
  return runCommand(process.execPath, ["--input-type=module", "--eval", source], options);
}

function runNpm(args, options = {}) {
  if (process.env.npm_execpath) {
    return runCommand(process.execPath, [process.env.npm_execpath, ...args], options);
  }
  return runCommand("npm", args, options);
}

function git(target, args) {
  return spawnSync("git", args, {
    cwd: target,
    encoding: "utf8",
    stdio: "pipe",
  });
}

function waitMs(ms) {
  spawnSync(process.execPath, ["-e", `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${Number(ms)})`], {
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

function stripReviewMarkers(filePath) {
  writeFileSync(
    filePath,
    readFileSync(filePath, "utf8")
      .replace(/REVIEW NEEDED:\s*/g, "")
      .replace(/REVIEW NEEDED/g, ""),
  );
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
  initHarness(
    target,
    ["--config-mode=custom", "--tracker=none", "--code-intelligence=focused-search", "--browser=none"],
    skillDir,
  );

  const config = readConfig(target);
  assert(config.tracker.provider === "none", "no-adapters tracker should be none");
  assert(config.codeIntelligence.provider === "focused-search", "no-adapters should use focused-search");
  assert(config.verification.browser.provider === "none", "no-adapters browser should be none");
  assert(
    readFileSync(join(target, "AGENTS.md"), "utf8").includes("<!-- apex-workflow:start -->"),
    "AGENTS managed block missing",
  );
  const gitignore = readFileSync(join(target, ".gitignore"), "utf8");
  assert(gitignore.includes("# apex-workflow:start"), "Apex .gitignore block missing");
  assert(gitignore.includes("tmp/apex-workflow/"), "Apex manifest artifact ignore missing");
  assert(gitignore.includes("tmp/agent-browser/"), "Apex browser artifact ignore missing");

  assert(git(target, ["init"]).status === 0, "git init failed");
  assert(
    git(target, ["check-ignore", "-q", "tmp/apex-workflow/fixture-slice.json"]).status === 0,
    "Apex manifest path should be ignored",
  );
  assert(
    git(target, ["check-ignore", "-q", "tmp/agent-browser/snapshot.json"]).status === 0,
    "Apex browser artifact path should be ignored",
  );
  assert(git(target, ["add", "."]).status === 0, "git add failed");
  assert(
    git(target, ["-c", "user.email=apex@example.local", "-c", "user.name=Apex Test", "commit", "-m", "baseline"])
      .status === 0,
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

  run(
    [
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
    ],
    { cwd: target },
  );

  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "detect",
      "--config=apex.workflow.json",
      "--slug=fixture-slice",
      "--write",
    ],
    { cwd: target },
  );

  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "close",
      "--config=apex.workflow.json",
      "--slug=fixture-slice",
      "--next=none",
    ],
    { cwd: target },
  );

  const manifest = JSON.parse(readFileSync(join(target, "tmp/apex-workflow/fixture-slice.json"), "utf8"));
  assert(manifest.codeIntelligence.detect?.provider === "built-in", "detect result should be recorded");
  assert(
    manifest.checks.runs.some((entry) => entry.command === "node --version" && entry.status === "passed"),
    "required check run should be recorded",
  );
  const nodeRun = manifest.checks.runs.find((entry) => entry.command === "node --version" && entry.status === "passed");
  assert(nodeRun.id, "run record should include id");
  assert(nodeRun.commandSource === "close-required", "required close run should include command source");
  assert(nodeRun.cwd === ".", "run record should include cwd");
  assert(nodeRun.gitHead, "run record should include git head");
  assert(nodeRun.gitStatusFingerprint?.startsWith("sha256:"), "run record should include git status fingerprint");
  assert(nodeRun.ownedFilesFingerprint?.startsWith("sha256:"), "run record should include owned files fingerprint");
  assert(nodeRun.logPath, "run record should include log path");
  assert(nodeRun.logSha256?.startsWith("sha256:"), "run record should include log hash");
  const nodeLog = readFileSync(join(target, nodeRun.logPath), "utf8");
  assert(sha256(nodeLog) === nodeRun.logSha256, "run record logSha256 should match written log");
  assert(nodeRun.stdoutTail.includes("v"), "run record should include stdout tail");
  assert(
    manifest.checks.runs.some((entry) => entry.command === "git diff --check" && entry.status === "passed"),
    "close should record git diff --check",
  );

  run([
    join(APEX_ROOT, "scripts/check-config.mjs"),
    "--config=profiles/service-desk.workflow.json",
    `--target=${target}`,
    "--allow-outside-config",
  ]);
}

function testStaleEvidenceDetection(root) {
  const target = makeTarget(root, "no-adapters", "stale-evidence");
  const skillDir = join(root, "skills-stale-evidence");
  initHarness(
    target,
    ["--config-mode=custom", "--tracker=none", "--code-intelligence=focused-search", "--browser=none"],
    skillDir,
  );

  assert(git(target, ["init"]).status === 0, "git init failed");
  assert(git(target, ["add", "."]).status === 0, "git add failed");
  assert(
    git(target, ["-c", "user.email=apex@example.local", "-c", "user.name=Apex Test", "commit", "-m", "baseline"])
      .status === 0,
    "git commit failed",
  );

  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "new",
      "--config=apex.workflow.json",
      "--slug=stale-evidence",
      "--issue=none",
      "--mode=tiny",
      "--surface=product doc",
      "--files=PRODUCT.md",
      "--downshift=tiny: stale evidence fixture",
      "--browser=skip: docs only",
      "--typecheck=skip: fixture docs only",
      "--required=node --version",
    ],
    { cwd: target },
  );

  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "run-check",
      "--config=apex.workflow.json",
      "--slug=stale-evidence",
      "--cmd=node --version",
    ],
    { cwd: target },
  );

  writeFileSync(join(target, "PRODUCT.md"), "# Product\n\nChanged after evidence.\n");

  const staleClose = run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "close",
      "--config=apex.workflow.json",
      "--slug=stale-evidence",
      "--skip-required",
      "--next=none",
    ],
    { cwd: target, allowFailure: true },
  );
  assert(staleClose.status !== 0, "close should fail when skipped required evidence is stale");
  assert(
    `${staleClose.stdout}\n${staleClose.stderr}`.includes("stale required evidence"),
    "stale evidence failure should explain the problem",
  );

  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "close",
      "--config=apex.workflow.json",
      "--slug=stale-evidence",
      "--skip-required",
      "--allow-stale-evidence=fixture intentionally reuses prior node version check",
      "--next=none",
    ],
    { cwd: target },
  );

  const manifest = JSON.parse(readFileSync(join(target, "tmp/apex-workflow/stale-evidence.json"), "utf8"));
  assert(
    manifest.evidence?.some((entry) => entry.kind === "stale-evidence-override"),
    "allow-stale-evidence should record an override evidence item",
  );
}

function testCommandPreviewAndPlaceholderFailure(root) {
  const target = makeTarget(root, "no-adapters", "command-preview");
  const skillDir = join(root, "skills-command-preview");
  initHarness(
    target,
    ["--config-mode=custom", "--tracker=none", "--code-intelligence=focused-search", "--browser=none"],
    skillDir,
  );

  assert(git(target, ["init"]).status === 0, "git init failed");
  assert(git(target, ["add", "."]).status === 0, "git add failed");
  assert(
    git(target, ["-c", "user.email=apex@example.local", "-c", "user.name=Apex Test", "commit", "-m", "baseline"])
      .status === 0,
    "git commit failed",
  );

  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "new",
      "--config=apex.workflow.json",
      "--slug=preview-slice",
      "--issue=none",
      "--mode=tiny",
      "--surface=product doc",
      "--files=PRODUCT.md",
      "--downshift=tiny: command preview fixture",
      "--browser=skip: docs only",
      "--typecheck=skip: fixture docs only",
      "--required=node --version",
    ],
    { cwd: target },
  );

  const preview = run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "close",
      "--config=apex.workflow.json",
      "--slug=preview-slice",
      "--preview-commands",
    ],
    { cwd: target },
  );
  assert(preview.stdout.includes("close command preview"), "preview should print a command preview header");
  assert(preview.stdout.includes("[close-required] node --version"), "preview should list required command");
  assert(preview.stdout.includes("[close-diff/will-run] git diff --check"), "preview should list diff check");

  const previewManifest = JSON.parse(readFileSync(join(target, "tmp/apex-workflow/preview-slice.json"), "utf8"));
  assert((previewManifest.checks.runs ?? []).length === 0, "preview should not run or record commands");

  const unresolved = run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "run-check",
      "--config=apex.workflow.json",
      "--slug=preview-slice",
      "--cmd=node {missingPlaceholder}",
    ],
    { cwd: target, allowFailure: true },
  );
  assert(unresolved.status !== 0, "unresolved placeholders should fail before command execution");
  assert(
    `${unresolved.stdout}\n${unresolved.stderr}`.includes("unresolved placeholder"),
    "unresolved placeholder failure should be explicit",
  );
}

function testReconciliationOwnedFilesOnly(root) {
  const target = makeTarget(root, "no-adapters", "no-adapters-reconciliation");
  const skillDir = join(root, "skills-reconciliation");
  initHarness(
    target,
    ["--config-mode=custom", "--tracker=none", "--code-intelligence=focused-search", "--browser=none"],
    skillDir,
  );

  assert(git(target, ["init"]).status === 0, "git init failed");
  assert(git(target, ["add", "."]).status === 0, "git add failed");
  assert(
    git(target, ["-c", "user.email=apex@example.local", "-c", "user.name=Apex Test", "commit", "-m", "baseline"])
      .status === 0,
    "git commit failed",
  );

  writeFileSync(join(target, "UNRELATED.md"), "pre-existing external dirty work\n");

  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "new",
      "--config=apex.workflow.json",
      "--slug=reconcile-slice",
      "--issue=none",
      "--mode=reconciliation",
      "--surface=manual evidence reconciliation",
    ],
    { cwd: target },
  );

  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "detect",
      "--config=apex.workflow.json",
      "--slug=reconcile-slice",
      "--write",
    ],
    { cwd: target },
  );

  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "record-evidence",
      "--config=apex.workflow.json",
      "--slug=reconcile-slice",
      "--kind=manual-terminal",
      "--summary=TUI launched with selected provider and real session id",
      "--source=fixture terminal",
    ],
    { cwd: target },
  );

  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "close",
      "--config=apex.workflow.json",
      "--slug=reconcile-slice",
      "--next=none",
    ],
    { cwd: target },
  );

  const manifest = JSON.parse(readFileSync(join(target, "tmp/apex-workflow/reconcile-slice.json"), "utf8"));
  assert(
    manifest.scope?.dirtyPolicy === "owned-files-only",
    "reconciliation should default to owned-files-only dirty policy",
  );
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
  initHarness(
    target,
    [
      "--config-mode=custom",
      "--tracker=linear",
      "--tracker-team=Ops",
      "--tracker-project=Launch",
      "--code-intelligence=gitnexus-wrapper",
      "--browser=none",
    ],
    skillDir,
  );

  const config = readConfig(target);
  assert(config.tracker.provider === "linear", "linear fixture tracker should be linear");
  assert(config.tracker.team === "Ops", "linear fixture team missing");
  assert(config.codeIntelligence.provider === "gitnexus-wrapper", "wrapper fixture provider mismatch");
  assert(config.codeIntelligence.wrapperFallback.enabled === true, "wrapper fallback should be enabled");
  assert(
    config.codeIntelligence.availability.fallbackCommandReadiness === "configured",
    "wrapper readiness should be configured",
  );
  assert(config.codeIntelligence.freshnessGate.enabled === true, "wrapper fixture should enable freshness gate");
}

function testGitNexusFreshnessGate(root) {
  const target = makeTarget(root, "linear-gitnexus-wrapper", "gitnexus-freshness-gate");
  const skillDir = join(root, "skills-freshness");
  initHarness(
    target,
    ["--config-mode=custom", "--tracker=none", "--code-intelligence=gitnexus-wrapper", "--browser=none"],
    skillDir,
  );

  assert(git(target, ["init"]).status === 0, "git init failed");
  assert(git(target, ["add", "."]).status === 0, "git add failed");
  assert(
    git(target, ["-c", "user.email=apex@example.local", "-c", "user.name=Apex Test", "commit", "-m", "baseline"])
      .status === 0,
    "git commit failed",
  );

  run(
    [
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
    ],
    { cwd: target },
  );

  const missingGate = run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "close",
      "--config=apex.workflow.json",
      "--slug=freshness-slice",
      "--next=none",
    ],
    { cwd: target, allowFailure: true },
  );
  assert(missingGate.status !== 0, "GitNexus close should fail without freshness records");
  assert(
    `${missingGate.stdout}\n${missingGate.stderr}`.includes("preSliceStatus is required"),
    "freshness gate should report missing preSliceStatus",
  );

  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "record-gitnexus-freshness",
      "--config=apex.workflow.json",
      "--slug=freshness-slice",
      "--phase=pre-status",
      "--status=fresh",
      "--command=npm run gitnexus:status",
    ],
    { cwd: target },
  );

  const missingPost = run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "finish",
      "--config=apex.workflow.json",
      "--slug=freshness-slice",
      "--next=none",
    ],
    { cwd: target, allowFailure: true },
  );
  assert(missingPost.status !== 0, "GitNexus finish should fail without post freshness disposition");
  assert(
    `${missingPost.stdout}\n${missingPost.stderr}`.includes("postSliceRefresh or postSliceSkipReason"),
    "freshness gate should report missing post-slice disposition",
  );

  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "record-gitnexus-freshness",
      "--config=apex.workflow.json",
      "--slug=freshness-slice",
      "--phase=post-skip",
      "--status=skipped",
      "--reason=docs-only fixture slice",
    ],
    { cwd: target },
  );

  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "close",
      "--config=apex.workflow.json",
      "--slug=freshness-slice",
      "--next=none",
    ],
    { cwd: target },
  );

  const manifest = JSON.parse(readFileSync(join(target, "tmp/apex-workflow/freshness-slice.json"), "utf8"));
  assert(manifest.codeIntelligence.freshness.preSliceStatus.status === "fresh", "preSliceStatus should be recorded");
  assert(
    manifest.codeIntelligence.freshness.postSliceSkipReason.reason === "docs-only fixture slice",
    "postSliceSkipReason should be recorded",
  );

  run(
    [
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
    ],
    { cwd: target },
  );
  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "record-gitnexus-freshness",
      "--config=apex.workflow.json",
      "--slug=stale-slice",
      "--phase=pre-status",
      "--status=stale",
      "--command=npm run gitnexus:status",
    ],
    { cwd: target },
  );
  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "record-gitnexus-freshness",
      "--config=apex.workflow.json",
      "--slug=stale-slice",
      "--phase=post-skip",
      "--status=skipped",
      "--reason=fixture no follow-up graph work",
    ],
    { cwd: target },
  );
  const missingRefresh = run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "finish",
      "--config=apex.workflow.json",
      "--slug=stale-slice",
      "--next=none",
    ],
    { cwd: target, allowFailure: true },
  );
  assert(missingRefresh.status !== 0, "stale preSliceStatus should require preSliceRefresh");
  assert(
    `${missingRefresh.stdout}\n${missingRefresh.stderr}`.includes("preSliceRefresh is required"),
    "freshness gate should report missing preSliceRefresh",
  );
}

function testGitNexusMcpPreferred(root) {
  const target = makeTarget(root, "gitnexus-mcp-preferred");
  const skillDir = join(root, "skills");
  initHarness(
    target,
    ["--config-mode=custom", "--tracker=none", "--code-intelligence=gitnexus-mcp", "--browser=none"],
    skillDir,
  );

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
  initHarness(
    target,
    ["--config-mode=custom", "--tracker=none", "--code-intelligence=focused-search", "--browser=none"],
    skillDir,
  );

  const agents = readFileSync(join(target, "AGENTS.md"), "utf8");
  assert(!agents.includes("old managed content"), "old managed block content should be replaced");
  assert((agents.match(/<!-- apex-workflow:start -->/g) ?? []).length === 1, "managed block should not duplicate");
  assert(agents.includes("Keep this repo-specific instruction."), "non-managed AGENTS content should be preserved");

  initHarness(
    target,
    ["--config-mode=custom", "--tracker=none", "--code-intelligence=focused-search", "--browser=none", "--force"],
    skillDir,
  );
  const gitignore = readFileSync(join(target, ".gitignore"), "utf8");
  assert(
    (gitignore.match(/# apex-workflow:start/g) ?? []).length === 1,
    ".gitignore managed block should not duplicate",
  );
}

function testPathCasingMismatch(root) {
  const target = makeTarget(root, "path-casing-mismatch");
  const result = run(
    [join(APEX_ROOT, "scripts/check-config.mjs"), "--config=apex.workflow.json", `--target=${target}`],
    { cwd: target, allowFailure: true },
  );

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
    "--allow-outside-config",
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
  const invalid = run(
    [
      join(APEX_ROOT, "scripts/check-config.mjs"),
      `--config=${invalidConfig}`,
      "--target=fixtures/config/service-desk",
      "--allow-outside-config",
      "--format=json",
    ],
    { allowFailure: true },
  );
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
  initHarness(
    target,
    ["--config-mode=custom", "--tracker=none", "--code-intelligence=focused-search", "--browser=none", "--dry-run"],
    skillDir,
  );

  assert(!existsSync(join(target, "apex.workflow.json")), "dry-run should not write apex.workflow.json");
  assert(!existsSync(join(target, "AGENTS.md")), "dry-run should not write AGENTS.md");
  assert(!existsSync(join(skillDir, "apex-workflow")), "dry-run should not create skill symlink");
  assert(
    !readFileSync(join(target, ".gitignore"), "utf8").includes("# apex-workflow:start"),
    "dry-run should not update .gitignore",
  );
}

function testCodebaseMapWorkflow(root) {
  const sparseTarget = join(root, "sparse-no-orientation");
  const sparseSkillDir = join(root, "skills-sparse-map");
  mkdirSync(sparseTarget, { recursive: true });
  writeFileSync(
    join(sparseTarget, "package.json"),
    JSON.stringify({ name: "sparse-no-orientation", private: true }, null, 2),
  );
  writeFileSync(join(sparseTarget, ".gitignore"), "tmp/\n");
  const sparseInstall = initHarness(
    sparseTarget,
    ["--config-mode=custom", "--tracker=none", "--code-intelligence=focused-search", "--browser=none"],
    sparseSkillDir,
  );
  assert(
    sparseInstall.stdout.includes("apex-map-codebase --target=. --write"),
    "missing orientation install report should recommend apex-map-codebase",
  );

  const target = makeTarget(root, "codebase-map-target");
  const skillDir = join(root, "skills-codebase-map");
  writeFileSync(join(target, ".env.local"), "SECRET_SHOULD_NOT_APPEAR=fixture-secret\n");
  writeFileSync(join(target, "private.key"), "fixture-private-key\n");
  initHarness(
    target,
    [
      "--config-mode=custom",
      "--tracker=none",
      "--code-intelligence=focused-search",
      "--browser=none",
      "--create-codebase-map",
    ],
    skillDir,
  );

  const mapPath = join(target, "docs/CODEBASE_MAP.md");
  assert(existsSync(mapPath), "create-codebase-map should write docs/CODEBASE_MAP.md");
  const mapText = readFileSync(mapPath, "utf8");
  assert(mapText.includes("Status: draft"), "generated map should start as draft");
  assert(!mapText.includes("SECRET_SHOULD_NOT_APPEAR"), "generated map should not read .env content");
  assert(!mapText.includes("fixture-private-key"), "generated map should not read key content");

  let config = readConfig(target);
  assert(
    config.orientation.readBeforeBroadSearch.includes("docs/CODEBASE_MAP.md"),
    "profile should point at generated map",
  );
  assert(
    config.setup.reviewNeeded.some((item) => item.includes("Generated docs/CODEBASE_MAP.md is draft")),
    "profile should retain draft map review item",
  );

  const draftCheck = run([
    join(APEX_ROOT, "scripts/apex-map-codebase.mjs"),
    `--target=${target}`,
    "--check",
    "--format=json",
  ]);
  const draftJson = JSON.parse(draftCheck.stdout);
  assert(draftJson.ok === true, "draft map should pass structural check");
  assert(draftJson.status === "draft", "draft map should report draft status");
  assert(draftJson.reviewMarkers.length > 0, "draft map should report review markers");

  const blockedReview = run(
    [join(APEX_ROOT, "scripts/apex-map-codebase.mjs"), `--target=${target}`, "--mark-reviewed", "--check"],
    { allowFailure: true },
  );
  assert(
    blockedReview.status !== 0,
    "mark-reviewed should fail while review markers remain, even when --check is also passed",
  );

  stripReviewMarkers(mapPath);
  run([join(APEX_ROOT, "scripts/apex-map-codebase.mjs"), `--target=${target}`, "--mark-reviewed", "--sync-profile"]);

  config = readConfig(target);
  assert(
    !config.setup.reviewNeeded.some((item) => item.includes("Generated docs/CODEBASE_MAP.md is draft")),
    "sync-profile should remove only generated draft map review item",
  );
  assert(
    config.setup.reviewRequiredBeforeFirstSlice === false,
    "sync-profile should recompute reviewRequiredBeforeFirstSlice",
  );

  run([join(APEX_ROOT, "scripts/apex-map-codebase.mjs"), `--target=${target}`, "--check", "--require-reviewed"]);

  assert(git(target, ["init"]).status === 0, "git init failed");
  assert(git(target, ["add", "."]).status === 0, "git add failed");
  assert(
    git(target, ["-c", "user.email=apex@example.local", "-c", "user.name=Apex Test", "commit", "-m", "baseline"])
      .status === 0,
    "git commit failed",
  );

  run([join(APEX_ROOT, "scripts/apex-doctor.mjs"), `--target=${target}`, `--skill-dir=${skillDir}`, "--skip-commands"]);

  const legacyTarget = makeTarget(root, "codebase-map-target", "legacy-map-target");
  mkdirSync(join(legacyTarget, "docs"), { recursive: true });
  writeFileSync(join(legacyTarget, "docs/CODEBASE_MAP.md"), "# Codebase Map\n\n## High-Level Layout\n\nLegacy only.\n");
  const legacy = run(
    [
      join(APEX_ROOT, "scripts/apex-map-codebase.mjs"),
      `--target=${legacyTarget}`,
      "--check",
      "--require-reviewed",
      "--format=json",
    ],
    { allowFailure: true },
  );
  assert(legacy.status !== 0, "legacy map should fail require-reviewed");
  assert(JSON.parse(legacy.stdout).status === "legacy", "legacy map should report legacy status");

  const invalidNoMarkers = join(root, "invalid-no-markers");
  mkdirSync(join(invalidNoMarkers, "docs"), { recursive: true });
  writeFileSync(
    join(invalidNoMarkers, "docs/CODEBASE_MAP.md"),
    "# Codebase Map\n\nStatus: draft\n\n## High-Level Layout\n\nOnly one section.\n",
  );
  const invalidReview = run(
    [
      join(APEX_ROOT, "scripts/apex-map-codebase.mjs"),
      `--target=${invalidNoMarkers}`,
      "--mark-reviewed",
      "--format=json",
    ],
    { allowFailure: true },
  );
  assert(invalidReview.status !== 0, "mark-reviewed should fail on structurally incomplete maps");
  assert(
    !readFileSync(join(invalidNoMarkers, "docs/CODEBASE_MAP.md"), "utf8").includes("Status: reviewed"),
    "failed mark-reviewed should not rewrite status",
  );

  const existingMapTarget = makeTarget(root, "codebase-map-target", "existing-map-target");
  const existingSkillDir = join(root, "skills-existing-map");
  mkdirSync(join(existingMapTarget, "docs"), { recursive: true });
  writeFileSync(join(existingMapTarget, "docs/CODEBASE_MAP.md"), "# Codebase Map\n\nExisting human map.\n");
  initHarness(
    existingMapTarget,
    [
      "--config-mode=custom",
      "--tracker=none",
      "--code-intelligence=focused-search",
      "--browser=none",
      "--create-codebase-map",
    ],
    existingSkillDir,
  );
  assert(
    readFileSync(join(existingMapTarget, "docs/CODEBASE_MAP.md"), "utf8").includes("Existing human map."),
    "create-codebase-map should not overwrite an existing map without force",
  );
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
  const pack = runNpm(["pack", "--pack-destination", packRoot, "--silent"], { env: npmEnv });
  const tarball = join(packRoot, pack.stdout.trim().split("\n").pop());
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], { cwd: installRoot, env: npmEnv });

  const binDir = join(installRoot, "node_modules/.bin");
  const apexInit = join(binDir, "apex-init");
  const apexDoctor = join(binDir, "apex-doctor");
  const apexManifest = join(binDir, "apex-manifest");
  const apexCheckConfig = join(binDir, "apex-check-config");
  const apexMapCodebase = join(binDir, "apex-map-codebase");

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
    git(target, ["-c", "user.email=apex@example.local", "-c", "user.name=Apex Test", "commit", "-m", "baseline"])
      .status === 0,
    "git commit failed",
  );
  runCommand(apexDoctor, [
    `--target=${target}`,
    "--config=apex.workflow.json",
    `--skill-dir=${skillDir}`,
    "--skip-commands",
  ]);
  runCommand(
    apexManifest,
    [
      "new",
      "--config=apex.workflow.json",
      "--slug=portable-cli",
      "--issue=none",
      "--mode=planning",
      "--surface=fixture docs",
      "--downshift=planning: cli shim smoke test",
    ],
    { cwd: target },
  );
  runCommand(apexMapCodebase, [`--target=${target}`, "--write", "--date=2026-04-29"]);
}

function testPortabilityScan() {
  const result = run([join(APEX_ROOT, "scripts/check-portability.mjs")]);
  assert(result.stdout.includes("[apex-portability] ok"), "portability scan should pass");
}

function testTrustModelDocs() {
  assert(existsSync(join(APEX_ROOT, "SECURITY.md")), "SECURITY.md should document the trust model");
  const security = readFileSync(join(APEX_ROOT, "SECURITY.md"), "utf8");
  assert(
    security.includes("trusted executable workflow configuration"),
    "SECURITY.md should name executable trust boundary",
  );
  assert(
    security.includes("Do not run Apex against untrusted profiles"),
    "SECURITY.md should warn about untrusted profiles",
  );
  const readme = readFileSync(join(APEX_ROOT, "README.md"), "utf8");
  assert(readme.includes("[SECURITY.md](SECURITY.md)"), "README should link SECURITY.md");
  const skill = readFileSync(join(APEX_ROOT, "skills/apex-workflow/SKILL.md"), "utf8");
  assert(skill.includes("trusted executable workflow configuration"), "skill should describe trust boundary");
}

function latestRun(target, slug) {
  const manifest = JSON.parse(readFileSync(join(target, `tmp/apex-workflow/${slug}.json`), "utf8"));
  return manifest.checks.runs[manifest.checks.runs.length - 1];
}

function escapeWorkflowCommand(value) {
  return String(value)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A")
    .replace(/:/g, "%3A")
    .replace(/,/g, "%2C");
}

function fixture(name, fn) {
  console.log(`[apex-fixtures] ${name}`);
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `::error file=scripts/test-installer-fixtures.mjs,title=${escapeWorkflowCommand(
        `fixture failed: ${name}`,
      )}::${escapeWorkflowCommand(message)}`,
    );
    throw error;
  }
}

function cleanupFixtureRoot(root) {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[apex-fixtures] warning: could not fully remove temp fixture root: ${message}`);
  }
}

function testControlPlaneHardening(root) {
  const target = makeTarget(root, "no-adapters", "control-plane-hardening");
  writeFileSync(join(target, "package-lock.json"), JSON.stringify({ name: "fixture", lockfileVersion: 3 }, null, 2));
  const skillDir = join(root, "skills-control-plane");
  initHarness(
    target,
    ["--config-mode=custom", "--tracker=none", "--code-intelligence=focused-search", "--browser=none"],
    skillDir,
  );

  const escapedManifest = run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "new",
      "--config=apex.workflow.json",
      "--file=../../outside.json",
      "--issue=none",
      "--mode=tiny",
      "--surface=escape",
      "--files=PRODUCT.md",
      "--downshift=tiny: path escape fixture",
      "--browser=skip",
      "--typecheck=skip",
      "--required=node --version",
    ],
    { cwd: target, allowFailure: true },
  );
  assert(escapedManifest.status !== 0, "manifest path escape should fail");
  assert(
    `${escapedManifest.stdout}\n${escapedManifest.stderr}`.includes("must stay inside target repo"),
    "path escape failure should be clear",
  );

  const absoluteOutsideManifest = run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "new",
      "--config=apex.workflow.json",
      `--file=${join(root, "outside-absolute.json")}`,
      "--issue=none",
      "--mode=tiny",
      "--surface=escape",
      "--files=PRODUCT.md",
      "--downshift=tiny: absolute path escape fixture",
      "--browser=skip",
      "--typecheck=skip",
      "--required=node --version",
    ],
    { cwd: target, allowFailure: true },
  );
  assert(absoluteOutsideManifest.status !== 0, "absolute manifest path escape should fail");

  const pathSlug = run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "new",
      "--config=apex.workflow.json",
      "--slug=../bad",
      "--issue=none",
      "--mode=tiny",
      "--surface=escape",
      "--files=PRODUCT.md",
      "--downshift=tiny: slug path escape fixture",
      "--browser=skip",
      "--typecheck=skip",
      "--required=node --version",
    ],
    { cwd: target, allowFailure: true },
  );
  assert(pathSlug.status !== 0, "manifest slug path escape should fail");

  const escapedMap = run(
    [join(APEX_ROOT, "scripts/apex-map-codebase.mjs"), `--target=${target}`, "--output=../../outside.md", "--write"],
    { allowFailure: true },
  );
  assert(escapedMap.status !== 0, "codebase map output escape should fail");

  const outsideConfig = run(
    [join(APEX_ROOT, "scripts/check-config.mjs"), "--config=../../outside.workflow.json", `--target=${target}`],
    { allowFailure: true },
  );
  assert(outsideConfig.status !== 0, "outside config should fail without explicit allow flag");

  assert(git(target, ["init"]).status === 0, "git init failed");
  assert(git(target, ["add", "."]).status === 0, "git add failed");
  assert(
    git(target, ["-c", "user.email=apex@example.local", "-c", "user.name=Apex Test", "commit", "-m", "baseline"])
      .status === 0,
    "git commit failed",
  );

  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "new",
      "--config=apex.workflow.json",
      "--slug=hardening",
      "--issue=none",
      "--mode=tiny",
      "--surface=product doc",
      "--files=PRODUCT.md,package-lock.json,apex.workflow.json",
      "--downshift=tiny: control-plane fixture",
      "--browser=skip: docs only",
      "--typecheck=skip: docs only",
      "--required=node --version",
    ],
    { cwd: target },
  );

  const escapedFinish = run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "finish",
      "--config=apex.workflow.json",
      "--slug=hardening",
      "--verified=none",
      "--next=none",
      "--out=../../outside.md",
    ],
    { cwd: target, allowFailure: true },
  );
  assert(escapedFinish.status !== 0, "finish packet output path escape should fail");

  const manifestPath = join(target, "tmp/apex-workflow/hardening.json");
  const freshLockPath = lockPathForManifest(manifestPath, target);
  mkdirSync(dirname(freshLockPath), { recursive: true });
  writeFileSync(freshLockPath, JSON.stringify({ createdAt: new Date().toISOString(), pid: 123456 }, null, 2));
  const freshLock = run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "record-check",
      "--config=apex.workflow.json",
      "--slug=hardening",
      "--cmd=node --version",
      "--status=passed",
    ],
    { cwd: target, allowFailure: true },
  );
  assert(freshLock.status !== 0, "fresh manifest lock should block writes");
  assert(
    `${freshLock.stdout}\n${freshLock.stderr}`.includes("manifest lock exists"),
    "fresh lock failure should be clear",
  );
  rmSync(freshLockPath, { force: true });
  writeFileSync(freshLockPath, JSON.stringify({ createdAt: "2000-01-01T00:00:00.000Z", pid: 123456 }, null, 2));
  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "record-check",
      "--config=apex.workflow.json",
      "--slug=hardening",
      "--cmd=node --version",
      "--status=skipped",
      "--note=stale lock recovery fixture",
    ],
    { cwd: target },
  );
  assert(!existsSync(freshLockPath), "stale manifest lock should be replaced and cleaned up");

  const runnerUrl = pathToFileURL(join(APEX_ROOT, "scripts/lib/runner.mjs")).href;
  const escapedLog = join(root, "outside-command.log");
  const runnerOutsideLog = runNodeModule(
    [
      `const { runTrustedCommand } = await import(${JSON.stringify(runnerUrl)});`,
      `await runTrustedCommand('node --version', { cwd: ${JSON.stringify(target)}, logPath: ${JSON.stringify(
        escapedLog,
      )} });`,
    ].join("\n"),
    { allowFailure: true },
  );
  assert(runnerOutsideLog.status !== 0, "runner log path escape should fail");
  assert(!existsSync(escapedLog), "escaped runner log should not be written");
  const insideLog = "tmp/apex-workflow/logs/runner-boundary.log";
  runNodeModule(
    [
      `const { runTrustedCommand } = await import(${JSON.stringify(runnerUrl)});`,
      `await runTrustedCommand('node --version', { cwd: ${JSON.stringify(target)}, logPath: ${JSON.stringify(
        insideLog,
      )} });`,
    ].join("\n"),
  );
  assert(existsSync(join(target, insideLog)), "repo-local runner log should be written");

  const childMarker = join(target, "tmp/apex-workflow/timeout-child-alive.txt");
  const timeoutScript = join(target, "tmp/apex-workflow/timeout-child.mjs");
  mkdirSync(dirname(timeoutScript), { recursive: true });
  writeFileSync(
    timeoutScript,
    [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "import { dirname, join } from 'node:path';",
      "const marker = join(process.cwd(), 'tmp/apex-workflow/timeout-child-alive.txt');",
      "setTimeout(() => { mkdirSync(dirname(marker), { recursive: true }); writeFileSync(marker, 'alive'); }, 1500);",
      "setTimeout(() => {}, 5000);",
      "",
    ].join("\n"),
  );
  const timeout = run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "run-check",
      "--config=apex.workflow.json",
      "--slug=hardening",
      "--timeout-ms=250",
      "--cmd=node tmp/apex-workflow/timeout-child.mjs",
    ],
    { cwd: target, allowFailure: true },
  );
  assert(timeout.status !== 0, "hanging command should time out");
  assert(latestRun(target, "hardening").timedOut === true, "timed out run should be recorded");
  waitMs(1800);
  assert(!existsSync(childMarker), "timed out command should not leave child process running");

  writeFileSync(join(target, "tmp/apex-workflow/big-output.mjs"), "process.stdout.write('x'.repeat(1200000));\n");
  const capped = run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "run-check",
      "--config=apex.workflow.json",
      "--slug=hardening",
      "--cmd=node tmp/apex-workflow/big-output.mjs",
    ],
    { cwd: target },
  );
  assert(capped.status === 0, "large-output command should still pass");
  const cappedRun = latestRun(target, "hardening");
  assert(cappedRun.outputTruncated === true, "large output should be marked truncated");
  assert((cappedRun.stdout ?? "").length <= 4000, "recorded stdout should be capped to tail limit");

  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "run-check",
      "--config=apex.workflow.json",
      "--slug=hardening",
      "--cmd=node -e \"console.log('OPENAI_API_KEY=sk-fakefakefakefake'); console.error('Bearer ghp_fakefakefakefake')\"",
    ],
    { cwd: target },
  );
  const redactedRun = latestRun(target, "hardening");
  const redactedLog = readFileSync(join(target, redactedRun.logPath), "utf8");
  assert(!redactedLog.includes("sk-fakefakefakefake"), "OpenAI token should be redacted from log");
  assert(!redactedLog.includes("ghp_fakefakefakefake"), "GitHub token should be redacted from log");
  assert(!redactedRun.command.includes("sk-fakefakefakefake"), "token should be redacted from recorded command");

  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "run-check",
      "--config=apex.workflow.json",
      "--slug=hardening",
      "--cmd=node --version",
    ],
    { cwd: target },
  );
  const cleanClose = run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "close",
      "--config=apex.workflow.json",
      "--slug=hardening",
      "--skip-required",
      "--next=none",
    ],
    { cwd: target },
  );
  assert(cleanClose.status === 0, "fresh evidence should not be stale because Apex wrote manifest/log/lock files");

  const originalPackageLock = JSON.stringify({ name: "fixture", lockfileVersion: 3 }, null, 2);
  writeFileSync(
    join(target, "package-lock.json"),
    JSON.stringify({ name: "fixture", lockfileVersion: 3, changed: true }, null, 2),
  );
  const stale = run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "close",
      "--config=apex.workflow.json",
      "--slug=hardening",
      "--skip-required",
      "--next=none",
    ],
    { cwd: target, allowFailure: true },
  );
  assert(stale.status !== 0, "package-lock change should stale required evidence");
  assert(
    `${stale.stdout}\n${stale.stderr}`.includes("stale required evidence"),
    "stale evidence output should be clear",
  );
  writeFileSync(join(target, "package-lock.json"), originalPackageLock);

  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "run-check",
      "--config=apex.workflow.json",
      "--slug=hardening",
      "--cmd=node --version",
    ],
    { cwd: target },
  );
  const configPath = join(target, "apex.workflow.json");
  const originalConfig = readFileSync(configPath, "utf8");
  const changedConfig = JSON.parse(originalConfig);
  changedConfig.operatorCautions = ["profile changed after passing evidence"];
  writeFileSync(configPath, `${JSON.stringify(changedConfig, null, 2)}\n`);
  const profileStale = run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "close",
      "--config=apex.workflow.json",
      "--slug=hardening",
      "--skip-required",
      "--next=none",
    ],
    { cwd: target, allowFailure: true },
  );
  assert(profileStale.status !== 0, "apex.workflow.json change should stale required evidence");
  assert(
    `${profileStale.stdout}\n${profileStale.stderr}`.includes("stale required evidence"),
    "profile stale evidence output should be clear",
  );
  writeFileSync(configPath, originalConfig);

  run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "run-check",
      "--config=apex.workflow.json",
      "--slug=hardening",
      "--cmd=node --version",
    ],
    { cwd: target },
  );
  const commandChangedManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  commandChangedManifest.checks.required = ['node -e "console.log(process.version)"'];
  writeFileSync(manifestPath, `${JSON.stringify(commandChangedManifest, null, 2)}\n`);
  const commandChanged = run(
    [
      join(APEX_ROOT, "scripts/apex-manifest.mjs"),
      "close",
      "--config=apex.workflow.json",
      "--slug=hardening",
      "--skip-required",
      "--next=none",
    ],
    { cwd: target, allowFailure: true },
  );
  assert(commandChanged.status !== 0, "required command string change should require new evidence");
  assert(
    `${commandChanged.stdout}\n${commandChanged.stderr}`.includes("required check has no passing evidence"),
    "command change stale evidence output should be clear",
  );

  const rollbackTarget = join(root, "rollback-target");
  mkdirSync(rollbackTarget, { recursive: true });
  writeFileSync(
    join(rollbackTarget, "package.json"),
    JSON.stringify({ name: "rollback-target", private: true }, null, 2),
  );
  writeFileSync(join(rollbackTarget, "AGENTS.md"), "original agents\n");
  writeFileSync(join(rollbackTarget, ".gitignore"), "original ignore\n");
  mkdirSync(join(rollbackTarget, "docs"), { recursive: true });
  writeFileSync(join(rollbackTarget, "docs/CODEBASE_MAP.md"), "original map\n");
  const rollbackSkillDir = join(root, "skills-rollback");
  const rollbackSkillPath = join(rollbackSkillDir, "apex-workflow");
  mkdirSync(rollbackSkillPath, { recursive: true });
  writeFileSync(join(rollbackSkillPath, "SKILL.md"), "original skill\n");
  const rollback = runCommand(
    process.execPath,
    [
      join(APEX_ROOT, "scripts/init-harness.mjs"),
      `--target=${rollbackTarget}`,
      `--skill-dir=${rollbackSkillDir}`,
      "--config-mode=custom",
      "--tracker=none",
      "--code-intelligence=focused-search",
      "--browser=none",
      "--create-codebase-map",
      "--force",
      "--yes",
    ],
    { env: { APEX_INIT_FAIL_AFTER_COMMIT: "1" }, allowFailure: true },
  );
  assert(rollback.status !== 0, "forced late init failure should fail");
  assert(!existsSync(join(rollbackTarget, "apex.workflow.json")), "rollback should remove generated profile");
  assert(
    readFileSync(join(rollbackTarget, "AGENTS.md"), "utf8") === "original agents\n",
    "rollback should restore AGENTS",
  );
  assert(
    readFileSync(join(rollbackTarget, ".gitignore"), "utf8") === "original ignore\n",
    "rollback should restore .gitignore",
  );
  assert(
    readFileSync(join(rollbackTarget, "docs/CODEBASE_MAP.md"), "utf8") === "original map\n",
    "rollback should restore CODEBASE_MAP",
  );
  assert(
    readFileSync(join(rollbackSkillPath, "SKILL.md"), "utf8") === "original skill\n",
    "rollback should restore existing skill path",
  );

  const doctor = run(
    [
      join(APEX_ROOT, "scripts/apex-doctor.mjs"),
      `--target=${target}`,
      `--skill-dir=${skillDir}`,
      "--skip-commands",
      "--json",
    ],
    { allowFailure: true },
  );
  const doctorJson = JSON.parse(doctor.stdout);
  assert(Array.isArray(doctorJson.blockers), "doctor JSON should include blockers");
  assert(Array.isArray(doctorJson.warnings), "doctor JSON should include warnings");
  assert(Array.isArray(doctorJson.info), "doctor JSON should include info");
}

function main() {
  mkdirSync(join(APEX_ROOT, "tmp"), { recursive: true });
  const root = mkdtempSync(join(APEX_ROOT, "tmp/apex-installer-fixtures-"));
  try {
    mkdirSync(root, { recursive: true });
    fixture("no-adapters doctor", () => testNoAdaptersDoctor(root));
    fixture("stale evidence detection", () => testStaleEvidenceDetection(root));
    fixture("command preview and placeholder failure", () => testCommandPreviewAndPlaceholderFailure(root));
    fixture("reconciliation owned files only", () => testReconciliationOwnedFilesOnly(root));
    fixture("linear gitnexus wrapper", () => testLinearGitNexusWrapper(root));
    fixture("gitnexus freshness gate", () => testGitNexusFreshnessGate(root));
    fixture("gitnexus mcp preferred", () => testGitNexusMcpPreferred(root));
    fixture("existing agents managed block", () => testExistingAgentsManagedBlock(root));
    fixture("schema validation", () => testSchemaValidation(root));
    fixture("path casing mismatch", () => testPathCasingMismatch(root));
    fixture("dry-run no writes", () => testDryRunNoWrites(root));
    fixture("codebase map workflow", () => testCodebaseMapWorkflow(root));
    fixture("portable cli entrypoints", () => testPortableCliEntrypoints(root));
    fixture("control-plane hardening", () => testControlPlaneHardening(root));
    fixture("portability scan", () => testPortabilityScan());
    fixture("trust model docs", () => testTrustModelDocs());
    console.log("[apex-fixtures] ok");
  } finally {
    cleanupFixtureRoot(root);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `::error file=scripts/test-installer-fixtures.mjs,title=${escapeWorkflowCommand(
      "fixture runner failed",
    )}::${escapeWorkflowCommand(message)}`,
  );
  throw error;
}
