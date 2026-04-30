#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { repoRelative as repoRelativePath, resolveInsideRoot } from "./lib/paths.mjs";
import { runTrustedCommand } from "./lib/runner.mjs";
import { makeRunId, withManifestLock, writeManifestAtomic } from "./lib/manifest-store.mjs";

function usage(exitCode = 0) {
  const message = `
Usage:
  node scripts/apex-manifest.mjs new --config=apex.workflow.json --slug=<slug> --issue=APP-1 --mode=route-local --surface="owner" --downshift="route-local: one owner and focused checks cover the slice"
  node scripts/apex-manifest.mjs new --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json --issue=APP-1 --mode=route-local --surface="owner" --downshift="route-local: one owner and focused checks cover the slice"
  node scripts/apex-manifest.mjs check --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json
  node scripts/apex-manifest.mjs files --file=tmp/apex-workflow/<slug>.json
  node scripts/apex-manifest.mjs detect --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json
  node scripts/apex-manifest.mjs run-check --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json --cmd="npm test"
  node scripts/apex-manifest.mjs record-check --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json --cmd="browser: manual QA" --status=skipped --note="no UI change"
  node scripts/apex-manifest.mjs record-evidence --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json --kind=manual-terminal --summary="TUI flow exercised" --source="local terminal"
  node scripts/apex-manifest.mjs record-gitnexus-freshness --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json --phase=pre-status --status=fresh --command="npm run gitnexus:status"
  node scripts/apex-manifest.mjs close --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json --next="APP-2" --preview-commands
  node scripts/apex-manifest.mjs close --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json --next="APP-2" --allow-stale-evidence="reason when required checks were intentionally not rerun"
  node scripts/apex-manifest.mjs summary --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json
  node scripts/apex-manifest.mjs finish --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json --verified="npm test" --next="APP-2"
`;
  (exitCode === 0 ? console.log : console.error)(message.trim());
  process.exit(exitCode);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") usage(0);

  const args = { _: [], _command: command };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }

    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) {
      const next = rest[index + 1];
      if (next && !next.startsWith("--")) {
        args[arg.slice(2)] = next;
        index += 1;
      } else {
        args[arg.slice(2)] = true;
      }
    } else {
      args[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
    }
  }

  return args;
}

function repoPath(filePath) {
  return repoRelativePath(process.cwd(), resolve(process.cwd(), filePath));
}

function readJson(filePath) {
  const absolute = resolveInsideRoot(process.cwd(), filePath, { label: "config path", file: true }).absolute;
  return JSON.parse(readFileSync(absolute, "utf8"));
}

function readManifest(filePath) {
  if (!filePath) throw new Error("--file is required");
  const absolute = resolveInsideRoot(process.cwd(), filePath, { label: "manifest file", file: true }).absolute;
  if (!existsSync(absolute)) throw new Error(`manifest not found: ${filePath}`);
  return JSON.parse(readFileSync(absolute, "utf8"));
}

function manifestPathFromArgs(args, config) {
  if (args.file) return String(args.file);
  if (!args.slug) throw new Error("--file or --slug is required");

  const defaultDir = config?.manifest?.defaultDir;
  if (typeof defaultDir !== "string" || defaultDir.trim() === "") {
    throw new Error("config.manifest.defaultDir is required when using --slug");
  }

  const slug = String(args.slug).trim();
  if (!slug || slug.includes("/") || slug.includes("\\")) {
    throw new Error("--slug must be a non-empty file slug, not a path");
  }

  return resolveInsideRoot(process.cwd(), join(defaultDir, slug.endsWith(".json") ? slug : `${slug}.json`), {
    label: "manifest file",
    file: true,
  }).relative;
}

function writeManifest(filePath, manifest) {
  const absolute = resolveInsideRoot(process.cwd(), filePath, { label: "manifest file", file: true }).absolute;
  mkdirSync(dirname(absolute), { recursive: true });
  withManifestLock(absolute, () => writeManifestAtomic(absolute, manifest), { root: process.cwd() });
}

function repoRelative(filePath) {
  return repoRelativePath(process.cwd(), resolve(process.cwd(), filePath));
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function redacted(value) {
  let output = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (match, prefix) => `${prefix}[REDACTED]`);
  }
  return output;
}

function tail(value, limit = TAIL_LIMIT) {
  const text = redacted(value);
  return text.length > limit ? text.slice(text.length - limit) : text;
}

function timestampIdPart(date = new Date()) {
  return date.toISOString().replace(/\D/g, "").slice(0, 17);
}

function slugFromManifestPath(filePath) {
  return basename(String(filePath), ".json").replace(/[^A-Za-z0-9._-]/g, "-");
}

function logPathForRun(filePath, runId) {
  return join("tmp/apex-workflow/logs", slugFromManifestPath(filePath), `${runId}.log`).replace(/\\/g, "/");
}

function normalizeStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function loadConfig(args) {
  const configPath = args.config ?? "apex.workflow.json";
  const absolute = resolveInsideRoot(process.cwd(), configPath, { label: "config path", file: true }).absolute;
  if (!existsSync(absolute)) {
    throw new Error(`config not found: ${configPath}`);
  }

  return readJson(configPath);
}

function getMode(config, modeId) {
  return (config.modes ?? []).find((mode) => mode.id === modeId);
}

function isCodeFacingMode(config, modeId) {
  return Boolean(getMode(config, modeId)?.codeFacing);
}

function makeImpactEntries(value) {
  return normalizeStringArray(value).map((entry) => {
    const [target, risk = "UNKNOWN", ...notesParts] = entry.split(":");
    return {
      target: target.trim(),
      risk: risk.trim(),
      notes: notesParts.join(":").trim(),
    };
  });
}

const DIRTY_POLICIES = new Set(["fail-unowned", "owned-files-only"]);
const GITNEXUS_PROVIDERS = new Set(["gitnexus-mcp", "gitnexus-wrapper"]);
const FRESHNESS_PHASES = new Set(["pre-status", "pre-refresh", "post-refresh", "post-skip"]);
const FRESHNESS_STATUSES = new Set(["fresh", "stale", "missing", "unavailable", "refreshed", "skipped"]);
const RUN_SOURCES = new Set([
  "manifest-required",
  "manual-run-check",
  "manual-record-check",
  "close-required",
  "close-diff",
  "detect-command",
]);
const SECRET_PATTERNS = [
  /\b((?:API|ACCESS|AUTH|ID|REFRESH)?_?(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD))=([^\s"'`]+)/gi,
  /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
];
const TAIL_LIMIT = 4000;
const FINGERPRINT_IGNORE_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", "tmp", ".turbo", ".cache"]);
const FINGERPRINT_MAX_FILE_BYTES = 1024 * 1024;

function defaultDirtyPolicy(mode) {
  return mode === "reconciliation" ? "owned-files-only" : "fail-unowned";
}

function normalizeDirtyPolicy(value, mode) {
  const policy = String(value ?? defaultDirtyPolicy(mode));
  if (!DIRTY_POLICIES.has(policy)) {
    throw new Error(`invalid dirty policy "${policy}". Expected one of: ${[...DIRTY_POLICIES].join(", ")}`);
  }
  return policy;
}

function dirtyPolicyFor(manifest, args = {}) {
  return normalizeDirtyPolicy(args["dirty-policy"] ?? manifest.scope?.dirtyPolicy, manifest.mode);
}

function defaultBrowserDisposition(config) {
  const browser = config.verification?.browser;
  if (!browser || browser.provider === "none") return "skip: browser provider is none for this profile";
  return `skip: no browser route declared for this slice; profile policy is ${browser.policy}`;
}

function defaultTypecheckDisposition(config, mode) {
  if (mode === "planning" || mode === "reconciliation") return "skip: non-code workflow mode";
  const required = normalizeStringArray(config.verification?.requiredCommands);
  const optional = normalizeStringArray(config.verification?.optionalCommands);
  const typecheckCommand = [...required, ...optional].find((command) => /typecheck|tsc/.test(command));
  return typecheckCommand ? `configured: ${typecheckCommand}` : "skip: no typecheck command configured in profile";
}

function makeFreshnessTemplate() {
  return {
    preSliceStatus: null,
    preSliceRefresh: null,
    postSliceRefresh: null,
    postSliceSkipReason: null,
  };
}

function makeTemplate(args, config) {
  const mode = String(args.mode ?? "route-local");
  if (!getMode(config, mode)) {
    throw new Error(`invalid mode "${mode}". Expected one of: ${(config.modes ?? []).map((entry) => entry.id).join(", ")}`);
  }

  const issue = String(args.issue ?? "none");
  const trackerDisposition =
    String(args.tracker ?? args["tracker-disposition"] ?? (issue !== "none" ? "existing" : "none"));

  const dirtyPolicy = normalizeDirtyPolicy(args["dirty-policy"], mode);
  const browserDisposition = args.browser ?? defaultBrowserDisposition(config);
  const typecheckDisposition = args.typecheck ?? defaultTypecheckDisposition(config, mode);
  const codeFacing = Boolean(getMode(config, mode)?.codeFacing);
  const requiredChecks = normalizeStringArray(args.required);
  const optionalChecks = normalizeStringArray(args.optional);

  return {
    version: 1,
    app: config.name,
    issue,
    mode,
    surface: String(args.surface ?? (mode === "reconciliation" ? "reconciliation evidence" : "TODO: owning surface")),
    contracts: normalizeStringArray(args.contracts),
    ownedFiles: normalizeStringArray(args.files),
    noTouch: normalizeStringArray(args.noTouch ?? args["no-touch"]),
    scope: {
      dirtyPolicy,
      externalDirtyFiles: [],
    },
    codeIntelligence: {
      provider: config.codeIntelligence?.provider ?? "none",
      impacts: makeImpactEntries(args.impact ?? args.impacts),
      detect: null,
      freshness: makeFreshnessTemplate(),
    },
    checks: {
      required: requiredChecks.length > 0 ? requiredChecks : codeFacing ? normalizeStringArray(config.verification?.requiredCommands) : [],
      optional: optionalChecks.length > 0 ? optionalChecks : codeFacing ? normalizeStringArray(config.verification?.optionalCommands) : [],
      browser: String(browserDisposition),
      typecheck: String(typecheckDisposition),
      runs: [],
    },
    evidence: [],
    tracker: {
      provider: config.tracker?.provider ?? "none",
      disposition: trackerDisposition,
      id: issue !== "none" ? issue : null,
    },
    downshiftProof: String(args.downshift ?? args["downshift-proof"] ?? (mode === "reconciliation" ? "reconciliation: no code implementation in this slice" : "TODO: why this is the lightest safe mode")),
    knownFailures: [],
    notes: "",
  };
}

function validateManifest(manifest, config) {
  const failures = [];
  const mode = getMode(config, manifest.mode);
  const trackerDispositions = new Set(config.tracker?.dispositions ?? ["none", "existing", "new", "blocked"]);

  if (manifest.version !== 1) failures.push("version must be 1");
  if (manifest.app && manifest.app !== config.name) failures.push(`app must match config.name (${config.name})`);
  if (!manifest.issue) failures.push("issue is required; use \"none\" intentionally");
  if (!mode) failures.push(`mode must be one of: ${(config.modes ?? []).map((entry) => entry.id).join(", ")}`);
  if (!manifest.surface || String(manifest.surface).startsWith("TODO")) failures.push("surface must name the owner");
  if (!Array.isArray(manifest.contracts)) failures.push("contracts must be an array");
  if (!Array.isArray(manifest.ownedFiles)) failures.push("ownedFiles must be an array");
  if (!Array.isArray(manifest.noTouch)) failures.push("noTouch must be an array");
  if (manifest.scope?.dirtyPolicy && !DIRTY_POLICIES.has(manifest.scope.dirtyPolicy)) {
    failures.push(`scope.dirtyPolicy must be one of: ${[...DIRTY_POLICIES].join(", ")}`);
  }
  if (!manifest.codeIntelligence?.provider) failures.push("codeIntelligence.provider is required");
  if (!Array.isArray(manifest.codeIntelligence?.impacts)) failures.push("codeIntelligence.impacts must be an array");
  if (manifest.codeIntelligence?.freshness && typeof manifest.codeIntelligence.freshness !== "object") {
    failures.push("codeIntelligence.freshness must be an object when present");
  }
  if (!manifest.checks || !Array.isArray(manifest.checks.required)) failures.push("checks.required must be an array");
  if (!Array.isArray(manifest.checks?.optional)) failures.push("checks.optional must be an array");
  if (manifest.evidence && !Array.isArray(manifest.evidence)) failures.push("evidence must be an array");
  if (!manifest.checks?.browser || String(manifest.checks.browser).startsWith("TODO")) {
    failures.push("checks.browser must be a route or explicit skip reason");
  }
  if (!manifest.checks?.typecheck || String(manifest.checks.typecheck).startsWith("TODO")) {
    failures.push("checks.typecheck must be required, known-noisy, or explicit skip reason");
  }
  if (!manifest.tracker?.provider) failures.push("tracker.provider is required");
  if (!trackerDispositions.has(manifest.tracker?.disposition)) {
    failures.push(`tracker.disposition must be one of: ${[...trackerDispositions].join(", ")}`);
  }
  if (!manifest.downshiftProof || String(manifest.downshiftProof).startsWith("TODO")) {
    failures.push("downshiftProof must explain why this mode is the lightest safe workflow");
  }

  const codeFacing = Boolean(mode?.codeFacing);
  if (codeFacing && manifest.ownedFiles.length === 0) {
    failures.push("ownedFiles must list current-slice files for code-facing modes");
  }
  if (codeFacing && manifest.checks.required.length === 0) {
    failures.push("checks.required must list at least one focused verification command for code-facing modes");
  }
  for (const filePath of manifest.ownedFiles ?? []) {
    if (String(filePath).startsWith("TODO")) failures.push(`ownedFiles contains placeholder: ${filePath}`);
  }

  return failures;
}

function commandNew(args, config) {
  const filePath = manifestPathFromArgs(args, config);
  const absolute = resolveInsideRoot(process.cwd(), filePath, { label: "manifest file", file: true }).absolute;
  if (existsSync(absolute) && !args.force) {
    throw new Error(`manifest already exists: ${filePath}. Pass --force to overwrite.`);
  }

  const manifest = makeTemplate(args, config);
  writeManifest(filePath, manifest);
  console.log(`[apex-manifest] wrote ${repoPath(filePath)}`);
}

function commandCheck(args, config) {
  const manifest = readManifest(manifestPathFromArgs(args, config));
  const failures = validateManifest(manifest, config);
  if (failures.length > 0) {
    console.error("[apex-manifest] manifest check failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("[apex-manifest] manifest ok");
}

function commandFiles(args) {
  const manifest = readManifest(args.file);
  for (const filePath of manifest.ownedFiles ?? []) console.log(filePath);
}

function validateRenderedCommand(command) {
  const unresolved = String(command).match(/\{[^}]+\}/g);
  if (unresolved) throw new Error(`command contains unresolved placeholder(s): ${unresolved.join(", ")}`);
}

function runDetectCommand(manifest, manifestPath, command, changedFilesFile, config, args = {}) {
  const rendered = command.replaceAll("{changedFilesFile}", changedFilesFile);
  validateRenderedCommand(rendered);
  const status = runAndRecord(manifest, manifestPath, rendered, {
    ...args,
    configObject: config,
    commandSource: "detect-command",
    note: `changedFilesFile=${changedFilesFile}`,
  });

  return status;
}

function gitChangedFiles() {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.error || result.status !== 0) {
    return {
      available: false,
      files: [],
      detail: result.error ? String(result.error.message ?? result.error) : result.stderr.trim(),
    };
  }

  const files = result.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const rawPath = line.slice(3);
      const renameIndex = rawPath.indexOf(" -> ");
      return (renameIndex === -1 ? rawPath : rawPath.slice(renameIndex + 4)).replace(/^"|"$/g, "");
    })
    .filter(Boolean);

  return { available: true, files: [...new Set(files)], detail: "" };
}

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function gitStatusText(paths = []) {
  const args = ["status", "--porcelain=v1"];
  if (paths.length > 0) args.push("--", ...paths);
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) return "";
  return result.stdout;
}

function gitStatusFingerprint(paths = []) {
  return sha256(gitStatusText(paths));
}

function gitStatusTextForEvidence(manifestPath) {
  const manifestFile = manifestPath ? repoRelative(manifestPath) : null;
  return gitStatusText()
    .split("\n")
    .filter(Boolean)
    .filter((line) => {
      const rawPath = line.slice(3).replace(/\\/g, "/");
      if (manifestFile && rawPath === manifestFile) return false;
      if (rawPath.startsWith("tmp/apex-workflow/")) return false;
      return true;
    })
    .join("\n");
}

function existingOwnedFiles(manifest) {
  return normalizeStringArray(manifest.ownedFiles).filter((filePath) => existsSync(resolve(process.cwd(), filePath)));
}

function fingerprintPath(filePath) {
  const absolute = resolve(process.cwd(), filePath);
  const stats = statSync(absolute);
  if (stats.isDirectory()) {
    if (FINGERPRINT_IGNORE_DIRS.has(basename(absolute))) return [`ignored-dir:${filePath}`];
    const children = readdirSync(absolute)
      .sort()
      .flatMap((entry) => fingerprintPath(join(filePath, entry)));
    return [`dir:${filePath}`, ...children];
  }
  if (!stats.isFile()) return [`other:${filePath}`];
  if (stats.size > FINGERPRINT_MAX_FILE_BYTES) {
    throw new Error(`freshness input exceeds limit: ${filePath}; configure a narrower verification.freshnessInputs entry`);
  }
  return [`file:${filePath}:${sha256(readFileSync(absolute))}`];
}

function ownedFilesFingerprint(manifest) {
  const files = existingOwnedFiles(manifest);
  const entries = files.flatMap((filePath) => fingerprintPath(filePath));
  return sha256(entries.join("\n"));
}

function existingFreshnessInputs(config) {
  return normalizeStringArray(config?.verification?.freshnessInputs).filter((filePath) =>
    existsSync(resolve(process.cwd(), filePath)),
  );
}

function freshnessInputsFingerprint(config) {
  const entries = existingFreshnessInputs(config).flatMap((filePath) => fingerprintPath(filePath));
  return sha256(entries.join("\n"));
}

function profileFingerprint(args = {}) {
  const configPath = args.configPath ?? args.config ?? "apex.workflow.json";
  const absolute = resolve(process.cwd(), configPath);
  if (!existsSync(absolute)) return sha256("profile:missing");
  return sha256(readFileSync(absolute));
}

function envAllowlistFingerprint(config) {
  const entries = normalizeStringArray(config?.verification?.envAllowlist).map((key) => {
    const value = process.env[key] ?? "";
    return `${key}:${sha256(value)}`;
  });
  return sha256(entries.sort().join("\n"));
}

function makeEvidenceFingerprint(manifest, config, command, args = {}) {
  const parts = [
    `ownedFiles=${ownedFilesFingerprint(manifest)}`,
    `freshnessInputs=${freshnessInputsFingerprint(config)}`,
    `command=${sha256(command)}`,
    `profile=${profileFingerprint(args)}`,
    `gitHead=${gitHead() ?? "none"}`,
    `gitStatus=${sha256(gitStatusTextForEvidence(args.manifestPath))}`,
    `env=${envAllowlistFingerprint(config)}`,
  ];
  return {
    evidenceFingerprint: sha256(parts.sort().join("\n")),
    freshnessInputsFingerprint: parts.find((part) => part.startsWith("freshnessInputs="))?.split("=")[1] ?? sha256(""),
    profileFingerprint: parts.find((part) => part.startsWith("profile="))?.split("=")[1] ?? sha256(""),
    commandFingerprint: sha256(command),
    envFingerprint: parts.find((part) => part.startsWith("env="))?.split("=")[1] ?? sha256(""),
    fingerprintInputs: {
      ownedFiles: existingOwnedFiles(manifest),
      freshnessInputs: existingFreshnessInputs(config),
      envAllowlist: normalizeStringArray(config?.verification?.envAllowlist),
    },
  };
}

function builtInDetect(manifest, manifestPath, args = {}) {
  const owned = new Set((manifest.ownedFiles ?? []).map((entry) => String(entry).replace(/\\/g, "/")));
  const manifestFile = repoRelative(manifestPath);
  const changed = gitChangedFiles();
  const missingOwnedFiles = [...owned].filter((filePath) => !existsSync(resolve(process.cwd(), filePath)));
  const unownedChangedFiles = changed.files.filter((filePath) => filePath !== manifestFile && !owned.has(filePath));
  const dirtyPolicy = dirtyPolicyFor(manifest, args);
  const failures = [];
  const warnings = [];

  if (!changed.available) warnings.push(`git status unavailable: ${changed.detail || "unknown error"}`);
  if (missingOwnedFiles.length > 0 && args.strict) {
    failures.push(`ownedFiles entries do not exist: ${missingOwnedFiles.join(", ")}`);
  } else if (missingOwnedFiles.length > 0) {
    warnings.push(`ownedFiles entries do not exist yet: ${missingOwnedFiles.join(", ")}`);
  }
  if (unownedChangedFiles.length > 0 && dirtyPolicy === "fail-unowned") {
    failures.push(`changed files not listed in ownedFiles: ${unownedChangedFiles.join(", ")}`);
  } else if (unownedChangedFiles.length > 0) {
    warnings.push(`external dirty files recorded outside this slice: ${unownedChangedFiles.join(", ")}`);
  }

  return {
    provider: "built-in",
    checkedAt: new Date().toISOString(),
    dirtyPolicy,
    gitStatusAvailable: changed.available,
    changedFiles: changed.files,
    ownedFiles: [...owned],
    manifestFile,
    unownedChangedFiles,
    externalDirtyFiles: unownedChangedFiles,
    missingOwnedFiles,
    warnings,
    failures,
    ok: failures.length === 0,
  };
}

function printBuiltInDetect(result) {
  console.log("[apex-manifest] built-in detect:");
  console.log(`- dirty policy: ${result.dirtyPolicy}`);
  console.log(`- changed files: ${result.changedFiles.length}`);
  console.log(`- owned files: ${result.ownedFiles.length}`);
  if (result.unownedChangedFiles.length > 0) {
    console.log(result.dirtyPolicy === "owned-files-only" ? "- external dirty files:" : "- unowned changed files:");
    for (const filePath of result.unownedChangedFiles) console.log(`  - ${filePath}`);
  }
  if (result.missingOwnedFiles.length > 0) {
    console.log("- missing owned files:");
    for (const filePath of result.missingOwnedFiles) console.log(`  - ${filePath}`);
  }
  for (const warning of result.warnings) console.warn(`[apex-manifest] warning: ${warning}`);
}

function updateDetectResult(manifest, detectResult) {
  manifest.scope = {
    ...(manifest.scope ?? {}),
    dirtyPolicy: detectResult.dirtyPolicy,
    externalDirtyFiles: detectResult.externalDirtyFiles ?? [],
  };
  manifest.codeIntelligence = {
    ...(manifest.codeIntelligence ?? {}),
    detect: detectResult,
  };
}

function runDetect(args, config, options = {}) {
  const filePath = manifestPathFromArgs(args, config);
  const manifest = readManifest(filePath);
  const failures = validateManifest(manifest, config);
  if (failures.length > 0) {
    console.error("[apex-manifest] manifest check failed; refusing detect:");
    for (const failure of failures) console.error(`- ${failure}`);
    return { ok: false, status: 1, manifest, filePath, failures };
  }

  const outputPath = resolveInsideRoot(
    process.cwd(),
    join("tmp/apex-workflow/detect", `${makeRunId("changed-files")}.txt`),
    { label: "changed-files handoff", file: true },
  ).absolute;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${manifest.ownedFiles.join("\n")}\n`);
  console.error(`[apex-manifest] changed-files list: ${repoRelative(outputPath)}`);

  const builtInResult = builtInDetect(manifest, filePath, args);
  printBuiltInDetect(builtInResult);
  updateDetectResult(manifest, builtInResult);
  if (args.write || options.write) writeManifest(filePath, manifest);

  const detectCommand = config.codeIntelligence?.detectCommand;
  if (!detectCommand) {
    if (!builtInResult.ok) {
      console.error("[apex-manifest] built-in detect failed:");
      for (const failure of builtInResult.failures) console.error(`- ${failure}`);
      return { ok: false, status: 1, manifest, filePath, failures: builtInResult.failures };
    }
    console.error("[apex-manifest] no detectCommand configured; built-in coverage passed");
    return { ok: true, status: 0, manifest, filePath, failures: [] };
  }

  const detectStatus = runDetectCommand(manifest, filePath, detectCommand, outputPath, config, args);
  if (detectStatus === 0) rmSync(outputPath, { force: true });
  writeManifest(filePath, manifest);
  return {
    ok: builtInResult.ok && detectStatus === 0,
    status: builtInResult.ok && detectStatus === 0 ? 0 : detectStatus || 1,
    manifest,
    filePath,
    failures: builtInResult.failures,
  };
}

function commandDetect(args, config) {
  const result = runDetect(args, config, { write: Boolean(args.write) });
  if (!result.ok) process.exit(result.status);
}

function commandSummary(args, config) {
  const manifest = readManifest(manifestPathFromArgs(args, config));
  console.log(`App: ${manifest.app ?? config.name}`);
  console.log(`Issue: ${manifest.issue}`);
  console.log(`Mode: ${manifest.mode}`);
  console.log(`Surface: ${manifest.surface}`);
  console.log(`Dirty policy: ${dirtyPolicyFor(manifest, args)}`);
  console.log(`Owned files: ${(manifest.ownedFiles ?? []).length}`);
  console.log(`Contracts: ${(manifest.contracts ?? []).join(", ") || "none listed"}`);
  console.log(`Tracker: ${manifest.tracker?.provider ?? "missing"} / ${manifest.tracker?.disposition ?? "missing"}${manifest.tracker?.id ? ` (${manifest.tracker.id})` : ""}`);
  console.log(`Code intelligence: ${manifest.codeIntelligence?.provider ?? "missing"}`);
  console.log(`Downshift proof: ${manifest.downshiftProof ?? "missing"}`);
  console.log(`Browser: ${manifest.checks?.browser ?? "missing"}`);
  console.log(`Typecheck: ${manifest.checks?.typecheck ?? "missing"}`);
  console.log(`Recorded check runs: ${checkRuns(manifest).length}`);
  console.log(`Evidence records: ${evidenceRecords(manifest).length}`);
}

function listValue(value) {
  const entries = normalizeStringArray(value);
  return entries.length > 0 ? entries : ["none"];
}

function formatList(entries) {
  return entries.map((entry) => `- ${entry}`).join("\n");
}

function codeIntelligenceScope(manifest) {
  const impacts = manifest.codeIntelligence?.impacts ?? [];
  const impactText =
    impacts.length > 0
      ? impacts.map((impact) => `${impact.target} (${impact.risk}${impact.notes ? `: ${impact.notes}` : ""})`).join("; ")
      : "none recorded";
  const detect = manifest.codeIntelligence?.detect ? JSON.stringify(manifest.codeIntelligence.detect) : "not recorded";
  const freshness = manifest.codeIntelligence?.freshness ? JSON.stringify(manifest.codeIntelligence.freshness) : "not recorded";
  return `${manifest.codeIntelligence?.provider ?? "missing"}; impacts: ${impactText}; freshness: ${freshness}; detect: ${detect}`;
}

function checkRuns(manifest) {
  return Array.isArray(manifest.checks?.runs) ? manifest.checks.runs : [];
}

function verifiedFromRuns(manifest) {
  return checkRuns(manifest)
    .filter((run) => run.status === "passed")
    .map((run) => run.command);
}

function failedSkippedFromRuns(manifest) {
  return checkRuns(manifest)
    .filter((run) => run.status === "failed" || run.status === "skipped")
    .map((run) => `${run.status}: ${run.command}${run.note ? ` (${run.note})` : ""}`);
}

function evidenceRecords(manifest) {
  return Array.isArray(manifest.evidence) ? manifest.evidence : [];
}

function formatEvidence(manifest) {
  const records = evidenceRecords(manifest);
  if (records.length === 0) return formatList(["none"]);
  return formatList(records.map((record) => `${record.kind}: ${record.summary}${record.source ? ` (${record.source})` : ""}${record.note ? ` - ${record.note}` : ""}`));
}

function formatGitNexusFreshness(manifest, config) {
  if (!GITNEXUS_PROVIDERS.has(manifest.codeIntelligence?.provider)) return formatList(["not required"]);
  if (!needsGitNexusFreshnessGate(manifest, config)) return formatList(["not required for this mode"]);
  const freshness = manifest.codeIntelligence?.freshness ?? {};
  const entries = [];
  entries.push(`preSliceStatus: ${freshness.preSliceStatus ? `${freshness.preSliceStatus.status}${freshness.preSliceStatus.note ? ` (${freshness.preSliceStatus.note})` : ""}` : "not recorded"}`);
  entries.push(`preSliceRefresh: ${freshness.preSliceRefresh ? `${freshness.preSliceRefresh.status}${freshness.preSliceRefresh.note ? ` (${freshness.preSliceRefresh.note})` : ""}` : "not recorded"}`);
  entries.push(`postSliceRefresh: ${freshness.postSliceRefresh ? `${freshness.postSliceRefresh.status}${freshness.postSliceRefresh.note ? ` (${freshness.postSliceRefresh.note})` : ""}` : "not recorded"}`);
  entries.push(`postSliceSkipReason: ${freshness.postSliceSkipReason ? freshness.postSliceSkipReason.reason : "not recorded"}`);
  return formatList(entries);
}

function finishValue(label, manifest, config, args) {
  const normalized = label.toLowerCase();
  if (normalized === "what landed") return args.landed || manifest.notes || `${manifest.surface} slice`;
  if (normalized === "mode") return manifest.mode ?? "missing";
  if (normalized === "downshift proof") return manifest.downshiftProof ?? "missing";
  if (normalized === "owned files") return formatList(listValue(args.files ?? manifest.ownedFiles));
  if (normalized === "no-touch preserved") return formatList(listValue(args["no-touch"] ?? manifest.noTouch));
  if (normalized === "verified") return formatList(listValue(args.verified ?? verifiedFromRuns(manifest)));
  if (normalized === "verified commands") return formatList(listValue(args.verified ?? verifiedFromRuns(manifest)));
  if (normalized === "failed / skipped checks") {
    const failed = normalizeStringArray(args.failed).map((entry) => `failed: ${entry}`);
    const skipped = normalizeStringArray(args.skipped).map((entry) => `skipped: ${entry}`);
    const known = normalizeStringArray(manifest.knownFailures).map((entry) => `known: ${entry}`);
    const recorded = failedSkippedFromRuns(manifest);
    return formatList([...failed, ...skipped, ...known, ...recorded].length > 0 ? [...failed, ...skipped, ...known, ...recorded] : ["none"]);
  }
  if (normalized === "known failures / not verified") {
    const skipped = normalizeStringArray(args.skipped);
    return formatList([...skipped, ...(manifest.knownFailures ?? [])].length > 0 ? [...skipped, ...(manifest.knownFailures ?? [])] : ["none"]);
  }
  if (normalized === "manual evidence" || normalized === "evidence") return formatEvidence(manifest);
  if (normalized === "gitnexus freshness") return formatGitNexusFreshness(manifest, config);
  if (normalized === "code-intelligence scope" || normalized === "gitnexus scope") return codeIntelligenceScope(manifest);
  if (normalized === "tracker update" || normalized === "linear update") {
    return args["tracker-update"] ?? `${manifest.tracker?.provider ?? config.tracker?.provider ?? "missing"} / ${manifest.tracker?.disposition ?? "missing"}${manifest.tracker?.id ? ` (${manifest.tracker.id})` : ""}`;
  }
  if (normalized === "next safe slice") return args.next ?? "not specified";
  return args[label] ?? "not recorded";
}

function commandFinish(args, config) {
  const manifest = readManifest(manifestPathFromArgs(args, config));
  const failures = validateManifest(manifest, config);
  if (failures.length > 0) {
    console.error("[apex-manifest] manifest check failed; refusing finish:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  const freshnessFailures = validateGitNexusFreshnessForClose(manifest, config);
  if (freshnessFailures.length > 0) {
    console.error("[apex-manifest] GitNexus freshness gate failed; refusing finish:");
    for (const failure of freshnessFailures) console.error(`- ${failure}`);
    process.exit(1);
  }

  const labels = config.manifest?.finishPacket?.length > 0 ? config.manifest.finishPacket : [
    "What landed",
    "Mode",
    "Downshift proof",
    "Owned files",
    "No-touch preserved",
    "Verified commands",
    "Failed / skipped checks",
    "Manual evidence",
    "GitNexus freshness",
    "Code-intelligence scope",
    "Tracker update",
    "Next safe slice",
  ];
  const output = [`# Finish Packet`, "", ...labels.flatMap((label) => [`## ${label}`, finishValue(label, manifest, config, args), ""])].join("\n");

  if (args.out) {
    const outPath = resolveInsideRoot(process.cwd(), String(args.out), { label: "finish packet output", file: true }).absolute;
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, output.endsWith("\n") ? output : `${output}\n`);
    console.log(`[apex-manifest] wrote ${repoPath(outPath)}`);
    return;
  }

  console.log(output);
}

function ensureRuns(manifest) {
  if (!manifest.checks) manifest.checks = { required: [], optional: [], browser: "missing", typecheck: "missing" };
  if (!Array.isArray(manifest.checks.runs)) manifest.checks.runs = [];
}

function makeRunRecord(manifest, manifestPath, command, status, exitCode, startedAt, finishedAt, durationMs, options = {}) {
  const commandSource = String(options.commandSource ?? "manual-record-check");
  if (!RUN_SOURCES.has(commandSource)) {
    throw new Error(`commandSource must be one of: ${[...RUN_SOURCES].join(", ")}`);
  }
  const evidence = options.config
    ? makeEvidenceFingerprint(manifest, options.config, command, {
        ...options,
        manifestPath,
      })
    : {};
  return {
    id: String(options.id ?? nextRunId(manifest)),
    command,
    commandSource,
    status,
    exitCode,
    startedAt,
    finishedAt,
    durationMs,
    cwd: ".",
    shell: true,
    timeoutMs: options.timeoutMs ?? null,
    timedOut: Boolean(options.timedOut),
    signal: options.signal ?? null,
    outputTruncated: Boolean(options.outputTruncated),
    gitHead: gitHead(),
    gitStatusFingerprint: gitStatusFingerprint(),
    ownedFilesFingerprint: ownedFilesFingerprint(manifest),
    ...evidence,
    stdoutTail: tail(options.stdout ?? ""),
    stderrTail: tail(options.stderr ?? ""),
    logPath: options.logPath ?? null,
    logSha256: options.logSha256 ?? null,
    note: String(options.note ?? ""),
  };
}

function nextRunId(manifest) {
  return makeRunId("run");
}

function writeRunLog(logPath, record, stdout, stderr) {
  const absolute = resolve(process.cwd(), logPath);
  mkdirSync(dirname(absolute), { recursive: true });
  const body = [
    `id: ${record.id}`,
    `commandSource: ${record.commandSource}`,
    `command: ${record.command}`,
    `cwd: ${record.cwd}`,
    `startedAt: ${record.startedAt}`,
    `finishedAt: ${record.finishedAt}`,
    `exitCode: ${record.exitCode ?? ""}`,
    "",
    "## stdout",
    redacted(stdout),
    "",
    "## stderr",
    redacted(stderr),
    "",
  ].join("\n");
  writeFileSync(absolute, body);
  return sha256(body);
}

function appendRun(manifest, record) {
  ensureRuns(manifest);
  manifest.checks.runs.push(record);
}

function appendEvidence(manifest, record) {
  if (!Array.isArray(manifest.evidence)) manifest.evidence = [];
  manifest.evidence.push(record);
}

function ensureFreshness(manifest) {
  if (!manifest.codeIntelligence) manifest.codeIntelligence = { provider: "none", impacts: [], detect: null };
  if (!manifest.codeIntelligence.freshness || typeof manifest.codeIntelligence.freshness !== "object") {
    manifest.codeIntelligence.freshness = makeFreshnessTemplate();
  }
  return manifest.codeIntelligence.freshness;
}

function booleanArg(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  return ["1", "true", "yes", "y"].includes(String(value).toLowerCase());
}

function makeFreshnessRecord(args) {
  const status = String(args.status ?? "");
  if (!FRESHNESS_STATUSES.has(status)) {
    throw new Error(`--status must be one of: ${[...FRESHNESS_STATUSES].join(", ")}`);
  }
  return {
    status,
    command: String(args.cmd ?? args.command ?? ""),
    note: String(args.note ?? ""),
    refreshRequired: booleanArg(args["refresh-required"]),
    graphRelevant: booleanArg(args["graph-relevant"]),
    recordedAt: new Date().toISOString(),
  };
}

function commandRecordGitNexusFreshness(args, config) {
  const phase = String(args.phase ?? "");
  if (!FRESHNESS_PHASES.has(phase)) {
    throw new Error(`--phase must be one of: ${[...FRESHNESS_PHASES].join(", ")}`);
  }
  const filePath = manifestPathFromArgs(args, config);
  const manifest = readManifest(filePath);
  const freshness = ensureFreshness(manifest);
  const record = makeFreshnessRecord(args);

  if (phase === "pre-status") freshness.preSliceStatus = record;
  if (phase === "pre-refresh") freshness.preSliceRefresh = record;
  if (phase === "post-refresh") {
    freshness.postSliceRefresh = record;
    freshness.postSliceSkipReason = null;
  }
  if (phase === "post-skip") {
    freshness.postSliceSkipReason = {
      reason: String(args.reason ?? args.note ?? ""),
      graphRelevant: booleanArg(args["graph-relevant"]),
      recordedAt: record.recordedAt,
    };
    if (!freshness.postSliceSkipReason.reason) throw new Error("--reason or --note is required for --phase=post-skip");
  }

  writeManifest(filePath, manifest);
  console.log(`[apex-manifest] recorded GitNexus freshness ${phase}: ${record.status}`);
}

function needsGitNexusFreshnessGate(manifest, config) {
  return GITNEXUS_PROVIDERS.has(manifest.codeIntelligence?.provider) && isCodeFacingMode(config, manifest.mode) && manifest.mode !== "tiny";
}

function validateGitNexusFreshnessForClose(manifest, config) {
  if (!needsGitNexusFreshnessGate(manifest, config)) return [];

  const failures = [];
  const freshness = manifest.codeIntelligence?.freshness ?? {};
  const preStatus = freshness.preSliceStatus;
  const preRefresh = freshness.preSliceRefresh;
  const postRefresh = freshness.postSliceRefresh;
  const postSkip = freshness.postSliceSkipReason;

  if (!preStatus) {
    failures.push("GitNexus freshness preSliceStatus is required for GitNexus-enabled non-tiny code slices");
  }

  const staleOrRequired =
    preStatus && (["stale", "missing"].includes(preStatus.status) || preStatus.refreshRequired);
  if (staleOrRequired && !preRefresh) {
    failures.push("GitNexus freshness preSliceRefresh is required when preSliceStatus is stale, missing, or refreshRequired");
  }
  if (staleOrRequired && preRefresh && preRefresh.status !== "refreshed") {
    failures.push("GitNexus freshness preSliceRefresh must have status=refreshed when refresh is required");
  }
  if (postRefresh && postRefresh.status !== "refreshed") {
    failures.push("GitNexus freshness postSliceRefresh must have status=refreshed");
  }

  if (!postRefresh && !postSkip) {
    failures.push("GitNexus freshness requires postSliceRefresh or postSliceSkipReason before close");
  }
  if (postSkip?.graphRelevant) {
    failures.push("GitNexus freshness postSliceRefresh is required when graphRelevant=true; postSliceSkipReason cannot close the gate");
  }

  return failures;
}

function latestPassedRun(manifest, command) {
  return [...checkRuns(manifest)].reverse().find((run) => run.command === command && run.status === "passed");
}

function validateRequiredEvidenceFreshness(manifest, config, args = {}) {
  const failures = [];
  const required = normalizeStringArray(manifest.checks?.required);
  if (required.length === 0) return failures;

  for (const command of required) {
    const run = latestPassedRun(manifest, command);
    if (!run) {
      failures.push(`required check has no passing evidence: ${command}`);
      continue;
    }
    const current = makeEvidenceFingerprint(manifest, config, command, {
      ...args,
      manifestPath: manifest.__filePath,
      configPath: args.config ?? "apex.workflow.json",
    }).evidenceFingerprint;
    if (!run.evidenceFingerprint) {
      failures.push(`required check evidence is legacy and must be rerun: ${command}`);
    } else if (run.evidenceFingerprint !== current) {
      failures.push(`required check evidence is stale: ${command}`);
    }
  }

  if (failures.length > 0 && args["allow-stale-evidence"]) {
    appendEvidence(manifest, {
      kind: "stale-evidence-override",
      summary: String(args["allow-stale-evidence"]),
      source: "apex-manifest close",
      note: failures.join("; "),
      recordedAt: new Date().toISOString(),
    });
    return [];
  }

  return failures;
}

function runAndRecord(manifest, manifestPath, command, args = {}) {
  validateRenderedCommand(command);
  const runId = nextRunId(manifest);
  const logPath = logPathForRun(manifestPath, runId);
  const result = runTrustedCommand(command, {
    cwd: process.cwd(),
    commandSource: args.commandSource ?? "manual-run-check",
    timeoutMs: args["timeout-ms"] ?? args.timeoutMs,
    logPath,
  });
  const status = result.status === 0 ? "passed" : "failed";
  const record = makeRunRecord(manifest, manifestPath, result.command, status, result.status, result.startedAt, result.finishedAt, result.durationMs, {
    id: runId,
    commandSource: args.commandSource ?? "manual-run-check",
    stdout: result.stdout,
    stderr: result.stderr,
    logPath,
    logSha256: result.logSha256,
    timeoutMs: result.timeoutMs,
    timedOut: result.timedOut,
    signal: result.signal,
    outputTruncated: result.outputTruncated,
    config: args.configObject,
    configPath: args.config ?? "apex.workflow.json",
    note: args.note ?? "",
  });
  record.logSha256 = result.logSha256;
  appendRun(manifest, record);
  console.log(`[apex-manifest] ${status}: ${result.command} (${logPath})`);
  if (result.stderr && status === "failed") console.error(tail(result.stderr, 1200));
  return result.status;
}

function commandRecordEvidence(args, config) {
  const filePath = manifestPathFromArgs(args, config);
  const manifest = readManifest(filePath);
  const summary = args.summary;
  if (!summary) throw new Error("--summary is required");
  const kind = String(args.kind ?? "manual");
  appendEvidence(manifest, {
    kind,
    summary: String(summary),
    source: String(args.source ?? ""),
    note: String(args.note ?? ""),
    recordedAt: new Date().toISOString(),
  });
  writeManifest(filePath, manifest);
  console.log(`[apex-manifest] recorded evidence: ${kind}: ${summary}`);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function ownedDiffCheckCommand(manifest) {
  const files = normalizeStringArray(manifest.ownedFiles);
  if (files.length === 0) return null;
  return `git diff --check -- ${files.map(shellQuote).join(" ")}`;
}

function closeCommandPlan(manifest, config, args = {}) {
  const commands = [];
  const detectCommand = config.codeIntelligence?.detectCommand;
  if (detectCommand) {
    commands.push({
      command: detectCommand.replaceAll("{changedFilesFile}", "<changedFilesFile>"),
      commandSource: "detect-command",
    });
  }
  if (!args["skip-required"]) {
    for (const command of manifest.checks?.required ?? []) {
      commands.push({ command, commandSource: "close-required" });
    }
  }
  const dirtyPolicy = dirtyPolicyFor(manifest, args);
  const diffCommand = dirtyPolicy === "owned-files-only" ? ownedDiffCheckCommand(manifest) : "git diff --check";
  commands.push({
    command: diffCommand ?? "git diff --check",
    commandSource: "close-diff",
    status: diffCommand ? "will-run" : "will-skip",
  });
  return commands;
}

function commandPreviewClose(manifest, config, args = {}) {
  console.log("[apex-manifest] close command preview");
  for (const entry of closeCommandPlan(manifest, config, args)) {
    console.log(`- [${entry.commandSource}${entry.status ? `/${entry.status}` : ""}] ${entry.command}`);
  }
}

function commandRunCheck(args, config) {
  const filePath = manifestPathFromArgs(args, config);
  const manifest = readManifest(filePath);
  const command = args.cmd ?? args.command;
  if (!command) throw new Error("--cmd is required");
  const status = runAndRecord(manifest, filePath, String(command), { ...args, configObject: config, commandSource: "manual-run-check" });
  writeManifest(filePath, manifest);
  process.exit(status);
}

function commandRecordCheck(args, config) {
  const filePath = manifestPathFromArgs(args, config);
  const manifest = readManifest(filePath);
  const command = args.cmd ?? args.command;
  if (!command) throw new Error("--cmd is required");
  validateRenderedCommand(String(command));
  const status = String(args.status ?? "passed");
  if (!["passed", "failed", "skipped"].includes(status)) throw new Error("--status must be passed, failed, or skipped");
  const exitCode = status === "passed" ? 0 : status === "failed" ? Number(args["exit-code"] ?? 1) : null;
  const now = new Date().toISOString();
  appendRun(
    manifest,
    makeRunRecord(manifest, filePath, String(command), status, exitCode, now, now, 0, {
      commandSource: "manual-record-check",
      config,
      configPath: args.config ?? "apex.workflow.json",
      note: String(args.note ?? ""),
    }),
  );
  writeManifest(filePath, manifest);
  console.log(`[apex-manifest] recorded ${status}: ${command}`);
}

function commandClose(args, config) {
  const filePath = manifestPathFromArgs(args, config);
  let manifest = readManifest(filePath);
  const failures = validateManifest(manifest, config);
  if (failures.length > 0) {
    console.error("[apex-manifest] manifest check failed; refusing close:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  const freshnessFailures = validateGitNexusFreshnessForClose(manifest, config);
  if (freshnessFailures.length > 0) {
    console.error("[apex-manifest] GitNexus freshness gate failed; refusing close:");
    for (const failure of freshnessFailures) console.error(`- ${failure}`);
    process.exit(1);
  }
  if (args["preview-commands"]) {
    commandPreviewClose(manifest, config, args);
    return;
  }

  const detectResult = runDetect({ ...args, file: filePath, write: true, strict: true }, config, { write: true });
  if (!detectResult.ok) process.exit(detectResult.status);
  manifest = readManifest(filePath);
  const dirtyPolicy = dirtyPolicyFor(manifest, args);
  let hadFailure = false;

  if (!args["skip-required"]) {
    for (const command of manifest.checks?.required ?? []) {
      const status = runAndRecord(manifest, filePath, command, { ...args, configObject: config, commandSource: "close-required" });
      writeManifest(filePath, manifest);
      if (status !== 0) hadFailure = true;
      if (status !== 0 && !args["keep-going"]) process.exit(status);
    }
  }

  manifest.__filePath = filePath;
  const staleEvidenceFailures = validateRequiredEvidenceFreshness(manifest, config, args);
  delete manifest.__filePath;
  writeManifest(filePath, manifest);
  if (staleEvidenceFailures.length > 0) {
    console.error("[apex-manifest] stale required evidence; refusing close:");
    for (const failure of staleEvidenceFailures) console.error(`- ${failure}`);
    console.error("- rerun required checks or pass --allow-stale-evidence=<reason>");
    process.exit(1);
  }

  const diffCommand = dirtyPolicy === "owned-files-only" ? ownedDiffCheckCommand(manifest) : "git diff --check";
  if (diffCommand) {
    const diffStatus = runAndRecord(manifest, filePath, diffCommand, { ...args, configObject: config, commandSource: "close-diff" });
    writeManifest(filePath, manifest);
    if (diffStatus !== 0) hadFailure = true;
    if (diffStatus !== 0 && !args["keep-going"]) process.exit(diffStatus);
  } else {
    appendRun(
      manifest,
      makeRunRecord(
        manifest,
        filePath,
        "git diff --check",
        "skipped",
        null,
        new Date().toISOString(),
        new Date().toISOString(),
        0,
        {
          commandSource: "close-diff",
          config,
          configPath: args.config ?? "apex.workflow.json",
          note: "dirtyPolicy=owned-files-only and no ownedFiles were listed",
        },
      ),
    );
    writeManifest(filePath, manifest);
  }

  commandFinish({ ...args, file: filePath }, config);
  if (hadFailure) process.exit(1);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const needsConfig = !["files"].includes(args._command);
  const config = needsConfig ? loadConfig(args) : null;

  switch (args._command) {
    case "new":
      commandNew(args, config);
      break;
    case "check":
      commandCheck(args, config);
      break;
    case "files":
      commandFiles(args);
      break;
    case "detect":
      commandDetect(args, config);
      break;
    case "run-check":
      commandRunCheck(args, config);
      break;
    case "record-check":
      commandRecordCheck(args, config);
      break;
    case "record-evidence":
      commandRecordEvidence(args, config);
      break;
    case "record-gitnexus-freshness":
      commandRecordGitNexusFreshness(args, config);
      break;
    case "close":
      commandClose(args, config);
      break;
    case "summary":
      commandSummary(args, config);
      break;
    case "finish":
      commandFinish(args, config);
      break;
    default:
      usage(1);
  }
} catch (error) {
  console.error(`[apex-manifest] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
