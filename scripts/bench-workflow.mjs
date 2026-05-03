#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APEX_ROOT = resolve(SCRIPT_DIR, "..");
const FIXTURES_ROOT = join(APEX_ROOT, "fixtures/installer");
const BENCHMARK_FIXTURE = join(APEX_ROOT, "benchmarks/workflow-fixtures.json");
const OUT_PATH = join(APEX_ROOT, "tmp/apex-workflow/workflow-benchmark.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? APEX_ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`,
    );
  }
  return result;
}

function nodeScript(name, args, options = {}) {
  return run(process.execPath, [join(APEX_ROOT, "scripts", name), ...args], options);
}

function git(target, args, options = {}) {
  return run("git", args, { cwd: target, ...options });
}

function makeTarget(root, fixtureName, name) {
  const target = join(root, name);
  cpSync(join(FIXTURES_ROOT, fixtureName), target, { recursive: true });
  return target;
}

function initTarget(root, fixtureName, name, args = []) {
  const target = makeTarget(root, fixtureName, name);
  const skillDir = join(root, `${name}-skills`);
  nodeScript(
    "init-harness.mjs",
    [
      `--target=${target}`,
      `--skill-dir=${skillDir}`,
      "--config-mode=custom",
      "--tracker=none",
      "--browser=none",
      ...args,
      "--yes",
    ],
    { cwd: APEX_ROOT },
  );
  git(target, ["init"]);
  git(target, ["add", "."]);
  git(target, ["-c", "user.email=apex@example.local", "-c", "user.name=Apex Bench", "commit", "-m", "baseline"]);
  return target;
}

function readManifest(target, slug) {
  return JSON.parse(readFileSync(join(target, `tmp/apex-workflow/${slug}.json`), "utf8"));
}

function readConfig(target) {
  return JSON.parse(readFileSync(join(target, "apex.workflow.json"), "utf8"));
}

function changedFiles(target) {
  const result = git(target, ["status", "--porcelain=v1"]);
  return result.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/\\/g, "/"))
    .filter((filePath) => filePath && !filePath.startsWith("tmp/apex-workflow/"));
}

function scopeEscapes(target, manifest) {
  const owned = new Set((manifest.ownedFiles ?? []).map((entry) => String(entry).replace(/\\/g, "/")));
  return changedFiles(target).filter((filePath) => !owned.has(filePath));
}

function finishComplete(output, config) {
  const labels = config.manifest?.finishPacket ?? [];
  if (labels.length === 0) return false;
  return labels.every((label) => output.includes(`## ${label}`));
}

function hasVerification(manifest) {
  const runs = manifest.checks?.runs ?? [];
  const required = manifest.checks?.required ?? [];
  if (required.length === 0) return runs.some((run) => run.status === "skipped") || manifest.evidence?.length > 0;
  return required.every((command) =>
    runs.some((run) => run.command === command && ["passed", "skipped"].includes(run.status)),
  );
}

function hasResumeState(closeOutput, manifest) {
  return Boolean(
    closeOutput.includes("## Next safe slice") && manifest.mode && manifest.surface && manifest.downshiftProof,
  );
}

function newManifest(target, slug, mode, options = {}) {
  const files = options.files ?? "PRODUCT.md";
  return nodeScript(
    "apex-manifest.mjs",
    [
      "new",
      "--config=apex.workflow.json",
      `--slug=${slug}`,
      "--issue=none",
      `--mode=${mode}`,
      `--surface=${options.surface ?? "fixture product doc"}`,
      `--files=${files}`,
      `--downshift=${mode}: benchmark fixture`,
      "--browser=skip: benchmark has no browser route",
      "--typecheck=skip: benchmark fixture has no typecheck",
      "--required=node --version",
      ...(options.extra ?? []),
    ],
    { cwd: target },
  );
}

function closeSlice(target, slug, args = []) {
  return nodeScript(
    "apex-manifest.mjs",
    ["close", "--config=apex.workflow.json", `--slug=${slug}`, "--next=none", ...args],
    {
      cwd: target,
    },
  );
}

function standardCodeScenario(root, scenario, mode, options = {}) {
  const target = initTarget(root, "no-adapters", scenario, ["--code-intelligence=focused-search"]);
  const slug = scenario;
  newManifest(target, slug, mode, options);
  writeFileSync(join(target, "PRODUCT.md"), `# Product\n\nBenchmark update for ${scenario}.\n`);
  const close = closeSlice(target, slug);
  const manifest = readManifest(target, slug);
  const config = readConfig(target);
  return {
    name: scenario,
    passed: true,
    scopeEscapes: scopeEscapes(target, manifest),
    verificationCaptured: hasVerification(manifest),
    finishComplete: finishComplete(close.stdout, config),
    staleEvidenceDetected: null,
    dirtyBranchFalseFailure: null,
    resumeComplete: hasResumeState(close.stdout, manifest),
  };
}

function dirtyBranchReconciliation(root) {
  const target = initTarget(root, "no-adapters", "dirty-branch-reconciliation", ["--code-intelligence=focused-search"]);
  writeFileSync(join(target, "UNRELATED.md"), "external dirty work\n");
  nodeScript(
    "apex-manifest.mjs",
    [
      "new",
      "--config=apex.workflow.json",
      "--slug=dirty-branch-reconciliation",
      "--issue=none",
      "--mode=reconciliation",
      "--surface=benchmark reconciliation",
    ],
    { cwd: target },
  );
  nodeScript(
    "apex-manifest.mjs",
    [
      "record-evidence",
      "--config=apex.workflow.json",
      "--slug=dirty-branch-reconciliation",
      "--kind=manual-terminal",
      "--summary=benchmark reconciliation evidence recorded",
      "--source=bench-workflow",
    ],
    { cwd: target },
  );
  const close = closeSlice(target, "dirty-branch-reconciliation");
  const manifest = readManifest(target, "dirty-branch-reconciliation");
  const config = readConfig(target);
  return {
    name: "dirty-branch-reconciliation",
    passed: true,
    scopeEscapes: [],
    verificationCaptured: hasVerification(manifest),
    finishComplete: finishComplete(close.stdout, config),
    staleEvidenceDetected: null,
    dirtyBranchFalseFailure: false,
    resumeComplete: hasResumeState(close.stdout, manifest),
  };
}

function staleEvidenceInvalidation(root) {
  const target = initTarget(root, "no-adapters", "stale-evidence-invalidation", ["--code-intelligence=focused-search"]);
  newManifest(target, "stale-evidence-invalidation", "tiny");
  nodeScript(
    "apex-manifest.mjs",
    ["run-check", "--config=apex.workflow.json", "--slug=stale-evidence-invalidation", "--cmd=node --version"],
    { cwd: target },
  );
  writeFileSync(join(target, "PRODUCT.md"), "# Product\n\nChanged after verification.\n");
  const stale = nodeScript(
    "apex-manifest.mjs",
    ["close", "--config=apex.workflow.json", "--slug=stale-evidence-invalidation", "--skip-required", "--next=none"],
    { cwd: target, allowFailure: true },
  );
  return {
    name: "stale-evidence-invalidation",
    passed: stale.status !== 0,
    scopeEscapes: [],
    verificationCaptured: true,
    finishComplete: true,
    staleEvidenceDetected: stale.status !== 0 && `${stale.stdout}\n${stale.stderr}`.includes("stale required evidence"),
    dirtyBranchFalseFailure: null,
    resumeComplete: true,
  };
}

function gitnexusWrapperFreshness(root) {
  const target = initTarget(root, "linear-gitnexus-wrapper", "gitnexus-wrapper-freshness-gate", [
    "--code-intelligence=gitnexus-wrapper",
  ]);
  newManifest(target, "gitnexus-wrapper-freshness-gate", "route-local");
  nodeScript(
    "apex-manifest.mjs",
    [
      "record-gitnexus-freshness",
      "--config=apex.workflow.json",
      "--slug=gitnexus-wrapper-freshness-gate",
      "--phase=pre-status",
      "--status=fresh",
      "--command=npm run gitnexus:status",
    ],
    { cwd: target },
  );
  nodeScript(
    "apex-manifest.mjs",
    [
      "record-gitnexus-freshness",
      "--config=apex.workflow.json",
      "--slug=gitnexus-wrapper-freshness-gate",
      "--phase=post-skip",
      "--status=skipped",
      "--reason=benchmark fixture does not need graph refresh",
    ],
    { cwd: target },
  );
  writeFileSync(join(target, "PRODUCT.md"), "# Product\n\nGitNexus benchmark update.\n");
  const close = closeSlice(target, "gitnexus-wrapper-freshness-gate");
  const manifest = readManifest(target, "gitnexus-wrapper-freshness-gate");
  const config = readConfig(target);
  return {
    name: "gitnexus-wrapper-freshness-gate",
    passed: true,
    scopeEscapes: scopeEscapes(target, manifest),
    verificationCaptured: hasVerification(manifest),
    finishComplete: finishComplete(close.stdout, config),
    staleEvidenceDetected: null,
    dirtyBranchFalseFailure: null,
    resumeComplete: hasResumeState(close.stdout, manifest),
  };
}

function browserSkipDisposition(root) {
  const result = standardCodeScenario(root, "browser-skip-disposition", "tiny");
  const manifest = readManifest(join(root, "browser-skip-disposition"), "browser-skip-disposition");
  result.verificationCaptured = result.verificationCaptured && String(manifest.checks.browser).startsWith("skip:");
  return result;
}

function missingContractFallback(root) {
  const result = standardCodeScenario(root, "missing-contract-fallback", "route-local", { extra: ["--contracts="] });
  const manifest = readManifest(join(root, "missing-contract-fallback"), "missing-contract-fallback");
  result.verificationCaptured =
    result.verificationCaptured &&
    manifest.contracts.length === 0 &&
    manifest.codeIntelligence.provider === "focused-search";
  return result;
}

function summarize(results, fixture) {
  const closeable = results.filter((result) => result.finishComplete !== null);
  const stale = results.filter((result) => result.staleEvidenceDetected !== null);
  const dirty = results.filter((result) => result.dirtyBranchFalseFailure !== null);
  const summary = {
    scenarioCount: results.length,
    scopeEscapeRate: results.filter((result) => result.scopeEscapes.length > 0).length / results.length,
    verificationCaptureRate: results.filter((result) => result.verificationCaptured).length / results.length,
    finishPacketCompleteness: closeable.filter((result) => result.finishComplete).length / closeable.length,
    staleEvidenceDetection: stale.filter((result) => result.staleEvidenceDetected).length / stale.length,
    dirtyBranchFalseFailureRate: dirty.filter((result) => result.dirtyBranchFalseFailure).length / dirty.length,
    resumeCompleteness: results.filter((result) => result.resumeComplete).length / results.length,
  };
  const thresholds = fixture.metrics;
  const failures = [];
  if (summary.scopeEscapeRate > thresholds.scopeEscapeRate.target) failures.push("scope escape rate exceeded target");
  if (summary.verificationCaptureRate < thresholds.verificationCaptureRate.target) {
    failures.push("verification capture rate below target");
  }
  if (summary.finishPacketCompleteness < thresholds.finishPacketCompleteness.target) {
    failures.push("finish packet completeness below target");
  }
  if (summary.staleEvidenceDetection < thresholds.staleEvidenceDetection.target) {
    failures.push("stale evidence detection below target");
  }
  if (summary.dirtyBranchFalseFailureRate > thresholds.dirtyBranchFalseFailureRate.target) {
    failures.push("dirty branch false failure rate exceeded target");
  }
  if (summary.resumeCompleteness < thresholds.resumeCompleteness.target)
    failures.push("resume completeness below target");
  return { summary, failures };
}

function main() {
  const fixture = JSON.parse(readFileSync(BENCHMARK_FIXTURE, "utf8"));
  const root = mkdtempSync(join(APEX_ROOT, "tmp/apex-workflow/bench-"));
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  try {
    const results = [
      standardCodeScenario(root, "tiny-one-file-fix", "tiny"),
      standardCodeScenario(root, "route-local-code-slice", "route-local"),
      standardCodeScenario(root, "shared-surface-change", "shared-surface", {
        files: "PRODUCT.md,apex.workflow.json",
      }),
      dirtyBranchReconciliation(root),
      staleEvidenceInvalidation(root),
      gitnexusWrapperFreshness(root),
      browserSkipDisposition(root),
      missingContractFallback(root),
    ];
    assert(
      fixture.scenarios.every((scenario) => results.some((result) => result.name === scenario)),
      "benchmark fixture scenario list is not fully covered",
    );
    const { summary, failures } = summarize(results, fixture);
    const output = {
      version: 1,
      generatedAt: new Date().toISOString(),
      ok: failures.length === 0 && results.every((result) => result.passed),
      thresholds: fixture.metrics,
      summary,
      failures,
      scenarios: results,
    };
    writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
    console.log("[apex-bench] workflow benchmark summary");
    console.log(`- scenarios: ${summary.scenarioCount}`);
    console.log(`- scope escape rate: ${summary.scopeEscapeRate}`);
    console.log(`- verification capture rate: ${summary.verificationCaptureRate}`);
    console.log(`- finish packet completeness: ${summary.finishPacketCompleteness}`);
    console.log(`- stale evidence detection: ${summary.staleEvidenceDetection}`);
    console.log(`- dirty branch false failure rate: ${summary.dirtyBranchFalseFailureRate}`);
    console.log(`- resume completeness: ${summary.resumeCompleteness}`);
    console.log(`[apex-bench] wrote ${OUT_PATH.replace(`${APEX_ROOT}/`, "")}`);
    if (!output.ok) {
      for (const failure of failures) console.error(`[apex-bench] ${failure}`);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

main();
