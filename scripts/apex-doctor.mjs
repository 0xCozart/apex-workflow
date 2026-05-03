#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import {
  DEFAULT_CODEBASE_MAP_PATH,
  GENERATED_MAP_DRAFT_REVIEW_ITEM,
  evaluateCodebaseMap,
} from "./lib/codebase-map.mjs";
import { resolveInsideRoot } from "./lib/paths.mjs";
import { runTrustedCommand } from "./lib/runner.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APEX_ROOT = resolve(SCRIPT_DIR, "..");
const START_MARKER = "<!-- apex-workflow:start -->";
const END_MARKER = "<!-- apex-workflow:end -->";
const COMMAND_KEY_PATTERN =
  /(?:^|\.)(?:.*Command|.*Commands|detectCommand|statusCommand|refreshCommand|queryCommand|contextCommand|impactCommand|checkCommand)$/;
const SUSPICIOUS_SHELL_PATTERN = /(?:&&|\|\||;|`|\$\(|\|)/;

function usage(exitCode = 0) {
  const message = `
Usage:
  node scripts/apex-doctor.mjs --config=apex.workflow.json --target=/path/to/app

Options:
  --config=<path>       Profile path. Defaults to apex.workflow.json under target.
  --target=<path>       Target app repo. Defaults to current directory.
  --skill-dir=<path>    Codex skills directory. Defaults to $CODEX_HOME/skills or ~/.codex/skills.
  --skip-commands       Check config presence without executing status commands.
  --mcp-available       Mark GitNexus MCP as available for this host/session.
  --strict              Treat warnings as failures.
  --json                Print machine-readable readiness output.
`;
  (exitCode === 0 ? console.log : console.error)(message.trim());
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") usage(0);
    if (!arg.startsWith("--")) continue;
    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) args[arg.slice(2)] = true;
    else args[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function add(checks, status, label, detail) {
  checks.push({ status, label, detail });
}

async function run(command, cwd, config) {
  const result = await runTrustedCommand(command, {
    cwd,
    commandSource: "doctor-status",
    timeoutMs: 120000,
    commandPolicy: config?.security?.commandPolicy,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
}

function collectGuessedPaths(value, prefix = "setup.inferredPaths") {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectGuessedPaths(entry, `${prefix}[${index}]`));
  }
  const current =
    value.confidence === "guessed" && value.path
      ? [`${prefix}: ${value.path}${value.reason ? ` (${value.reason})` : ""}`]
      : [];
  return [
    ...current,
    ...Object.entries(value).flatMap(([key, entry]) => collectGuessedPaths(entry, `${prefix}.${key}`)),
  ];
}

function isCommandPath(path) {
  return COMMAND_KEY_PATTERN.test(path.replace(/\[\d+\]/g, ""));
}

function collectStringEntries(value, prefix = "") {
  if (typeof value === "string") return [{ path: prefix, value }];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectStringEntries(entry, `${prefix}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, entry]) =>
    collectStringEntries(entry, prefix ? `${prefix}.${key}` : key),
  );
}

function checkTrustBoundary(checks, config) {
  const strings = collectStringEntries(config);
  const commandEntries = strings.filter((entry) => isCommandPath(entry.path) && entry.value.trim() !== "");
  if (commandEntries.length > 0) {
    add(
      checks,
      "warn",
      "executable trust boundary",
      `${commandEntries.length} configured command value(s); review SECURITY.md before running untrusted profiles or manifests`,
    );
  } else {
    add(checks, "pass", "executable trust boundary", "no configured command values found");
  }

  const suspicious = strings.filter(
    (entry) => !isCommandPath(entry.path) && SUSPICIOUS_SHELL_PATTERN.test(entry.value),
  );
  if (suspicious.length > 0) {
    add(
      checks,
      "warn",
      "suspicious non-command strings",
      suspicious
        .map((entry) => entry.path)
        .slice(0, 8)
        .join("; "),
    );
  } else {
    add(checks, "pass", "suspicious non-command strings", "none found");
  }
}

function checkGitignored(targetRoot, pathToCheck) {
  const gitResult = spawnSync("git", ["-C", targetRoot, "check-ignore", "-q", pathToCheck], {
    encoding: "utf8",
  });
  if (gitResult.status === 0) return true;

  const gitignore = readText(join(targetRoot, ".gitignore"));
  return gitignore
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .some((line) => {
      const normalized = line.replace(/^\//, "");
      return (
        normalized === "tmp/" ||
        normalized === "tmp" ||
        normalized === "tmp/apex-workflow/" ||
        normalized === "tmp/apex-workflow"
      );
    });
}

async function commandCheck(checks, label, command, targetRoot, args) {
  if (!command) {
    add(checks, "warn", label, "no status command is configured; verify host connector availability in-session");
    return;
  }
  if (args["skip-commands"]) {
    add(checks, "warn", label, `not executed because --skip-commands was passed: ${command}`);
    return;
  }

  const result = await run(command, targetRoot, args.configObject);
  if (result.status === 0) add(checks, "pass", label, command);
  else
    add(
      checks,
      "fail",
      label,
      `${command} exited ${result.status ?? "unknown"}${result.stderr ? `: ${result.stderr.trim()}` : ""}`,
    );
}

function commandPolicy(config) {
  const policy = config.security?.commandPolicy;
  return {
    mode: String(policy?.mode ?? "trusted-shell"),
    allowedCommands: Array.isArray(policy?.allowedCommands) ? policy.allowedCommands : [],
    blockedShellTokens: Array.isArray(policy?.blockedShellTokens) ? policy.blockedShellTokens : [],
  };
}

function checkCommandPolicy(checks, config) {
  const policy = commandPolicy(config);
  if (policy.mode === "trusted-shell") {
    const setupReviewed =
      config.setup?.reviewRequiredBeforeFirstSlice === false &&
      Array.isArray(config.setup?.reviewNeeded) &&
      config.setup.reviewNeeded.length === 0;
    const status = setupReviewed ? "pass" : "warn";
    add(
      checks,
      status,
      "command policy",
      setupReviewed
        ? "trusted-shell default with reviewed setup"
        : "trusted-shell default; review configured commands before running unreviewed profiles",
    );
    return;
  }

  if (policy.mode === "allowlisted-shell") {
    const status = policy.allowedCommands.length > 0 ? "pass" : "fail";
    add(
      checks,
      status,
      "command policy",
      `allowlisted-shell with ${policy.allowedCommands.length} allowed command pattern(s)`,
    );
    return;
  }

  if (policy.mode === "restricted-shell") {
    add(
      checks,
      "pass",
      "command policy",
      `restricted-shell with ${policy.blockedShellTokens.length || "default"} blocked shell token(s)`,
    );
    return;
  }

  if (policy.mode === "exec-array-only") {
    add(
      checks,
      "warn",
      "command policy",
      "exec-array-only is schema-supported but raw command execution is not yet supported",
    );
    return;
  }

  add(checks, "fail", "command policy", `unknown mode: ${policy.mode}`);
}

async function checkTracker(checks, config, targetRoot, args) {
  const tracker = config.tracker ?? {};
  if (!tracker.provider || tracker.provider === "none") {
    add(checks, "pass", "tracker readiness", "tracker provider is none");
    return;
  }
  await commandCheck(checks, "tracker readiness", tracker.statusCommand ?? tracker.checkCommand, targetRoot, {
    ...args,
    configObject: config,
  });
}

function wrapperReady(wrapper) {
  return Boolean(wrapper?.enabled && (wrapper.statusCommand || wrapper.queryCommand || wrapper.detectCommand));
}

async function checkCodeIntelligence(checks, config, targetRoot, args) {
  const code = config.codeIntelligence ?? {};
  const availability = code.availability ?? {};
  const provider = code.provider ?? "missing";

  if (provider === "focused-search") {
    add(checks, "pass", "code intelligence readiness", "focused-search does not require external tooling");
    return;
  }

  if (provider === "gitnexus-mcp") {
    const hostAvailable = Boolean(args["mcp-available"] || availability.currentHostAvailability === "available");
    if (hostAvailable) {
      add(checks, "pass", "GitNexus MCP host availability", "host/session reports MCP tools available");
    } else {
      const severity = wrapperReady(code.wrapperFallback) ? "warn" : "fail";
      add(
        checks,
        severity,
        "GitNexus MCP host availability",
        "profile prefers MCP, but this CLI cannot see host MCP tools; pass --mcp-available after verifying tools/resources in the agent",
      );
    }
  }

  if (provider === "gitnexus-wrapper" || wrapperReady(code.wrapperFallback)) {
    await commandCheck(
      checks,
      "GitNexus wrapper readiness",
      code.wrapperFallback?.statusCommand ?? code.statusCommand,
      targetRoot,
      { ...args, configObject: config },
    );
  }
}

async function checkBrowser(checks, config, targetRoot, args) {
  const browser = config.verification?.browser ?? {};
  if (!browser.provider || browser.provider === "none") {
    add(checks, "pass", "browser readiness", "browser provider is none");
    return;
  }
  await commandCheck(
    checks,
    "browser readiness",
    browser.statusCommand ?? browser.checkCommand ?? "command -v agent-browser",
    targetRoot,
    { ...args, configObject: config },
  );
}

function checkSkillLink(checks, config, args) {
  const skillRoot = args["skill-dir"]
    ? resolve(process.cwd(), String(args["skill-dir"]))
    : join(process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME) : join(homedir(), ".codex"), "skills");
  const linkPath = join(skillRoot, "apex-workflow");
  const expectedSource = join(config.setup?.apexRoot ?? APEX_ROOT, "skills/apex-workflow");

  if (!existsSync(linkPath)) {
    add(checks, "fail", "skill symlink", `missing: ${linkPath}`);
    return;
  }

  const stat = lstatSync(linkPath);
  if (!stat.isSymbolicLink()) {
    add(checks, "fail", "skill symlink", `exists but is not a symlink: ${linkPath}`);
    return;
  }

  const actual = realpathSync(linkPath);
  const expected = realpathSync(expectedSource);
  if (actual === expected) add(checks, "pass", "skill symlink", linkPath);
  else add(checks, "fail", "skill symlink", `points to ${actual}, expected ${expected}`);
}

function checkBaseline(checks, targetRoot) {
  const result = spawnSync("git", ["-C", targetRoot, "status", "--short", "--", "AGENTS.md", "apex.workflow.json"], {
    encoding: "utf8",
  });

  if (result.error || result.status !== 0) {
    add(checks, "warn", "baseline checkpoint", "git status unavailable; cannot prove setup checkpoint");
    return;
  }

  const lines = result.stdout.split("\n").filter(Boolean);
  if (lines.length === 0) add(checks, "pass", "baseline checkpoint", "AGENTS.md and apex.workflow.json are clean");
  else add(checks, "fail", "baseline checkpoint", `setup files are uncommitted: ${lines.join("; ")}`);
}

function codebaseMapRefs(config) {
  return [...(config.orientation?.readBeforeBroadSearch ?? []), ...(config.authority?.workflowRules ?? [])]
    .map((entry) => (typeof entry === "string" ? entry.split("#")[0].trim() : ""))
    .filter((entry) => entry === DEFAULT_CODEBASE_MAP_PATH || /(^|\/)CODEBASE_MAP\.md$/i.test(entry));
}

function readMapEvaluation(targetRoot, config) {
  const refs = codebaseMapRefs(config);
  if (refs.length === 0) return null;
  const mapPath = join(targetRoot, refs[0]);
  if (!existsSync(mapPath)) {
    return {
      refs,
      exists: false,
      reviewed: false,
      detail: `configured codebase map is missing: ${refs[0]}`,
    };
  }
  const text = readText(mapPath);
  const evaluation = evaluateCodebaseMap(text);
  return {
    refs,
    exists: true,
    reviewed:
      evaluation.status === "reviewed" && evaluation.errors.length === 0 && evaluation.reviewMarkers.length === 0,
    evaluation,
  };
}

function checkCodebaseMap(checks, targetRoot, config, mapEvaluation) {
  if (!mapEvaluation) {
    add(checks, "pass", "codebase map", "no docs/CODEBASE_MAP.md reference configured");
    return;
  }

  if (!mapEvaluation.exists) {
    add(checks, "fail", "codebase map", mapEvaluation.detail);
    return;
  }

  const evaluation = mapEvaluation.evaluation;
  if (evaluation.status === "reviewed" && evaluation.errors.length === 0 && evaluation.reviewMarkers.length === 0) {
    add(checks, "pass", "codebase map", "reviewed codebase map is ready");
    return;
  }

  const details = [
    `status=${evaluation.status}`,
    ...evaluation.errors,
    ...evaluation.warnings,
    ...(evaluation.reviewMarkers.length > 0 ? [`review markers=${evaluation.reviewMarkers.length}`] : []),
  ];
  add(checks, "warn", "codebase map", details.join("; "));
}

function runConfigCheck(checks, configPath, targetRoot) {
  const result = spawnSync(
    process.execPath,
    [join(APEX_ROOT, "scripts/check-config.mjs"), `--config=${configPath}`, `--target=${targetRoot}`],
    {
      cwd: targetRoot,
      encoding: "utf8",
    },
  );

  if (result.status === 0) add(checks, "pass", "profile validation", "check-config passed");
  else add(checks, "fail", "profile validation", (result.stderr || result.stdout || "check-config failed").trim());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetRoot = resolve(process.cwd(), String(args.target ?? "."));
  const configPath = resolveInsideRoot(targetRoot, String(args.config ?? "apex.workflow.json"), {
    label: "config path",
    file: true,
  }).absolute;
  const checks = [];

  if (!existsSync(configPath)) throw new Error(`config not found: ${configPath}`);

  const config = readJson(configPath);
  runConfigCheck(checks, configPath, targetRoot);
  checkTrustBoundary(checks, config);
  checkCommandPolicy(checks, config);
  const mapEvaluation = readMapEvaluation(targetRoot, config);

  const reviewNeeded = config.setup?.reviewNeeded ?? [];
  const generatedMapReviewResolved = reviewNeeded.includes(GENERATED_MAP_DRAFT_REVIEW_ITEM) && mapEvaluation?.reviewed;
  const activeReviewNeeded = generatedMapReviewResolved
    ? reviewNeeded.filter((item) => item !== GENERATED_MAP_DRAFT_REVIEW_ITEM)
    : reviewNeeded;
  if (activeReviewNeeded.length === 0)
    add(checks, "pass", "setup.reviewNeeded", "no unresolved installer review items");
  else add(checks, "fail", "setup.reviewNeeded", activeReviewNeeded.join("; "));
  if (generatedMapReviewResolved) {
    add(
      checks,
      "warn",
      "setup.reviewNeeded codebase map sync",
      "reviewed map still has stale setup review item; run apex-map-codebase --target=. --mark-reviewed --sync-profile",
    );
  }

  const guessedPaths = collectGuessedPaths(config.setup?.inferredPaths);
  if (guessedPaths.length === 0) add(checks, "pass", "setup.inferredPaths", "no guessed paths remain");
  else add(checks, "fail", "setup.inferredPaths", guessedPaths.join("; "));

  if (checkGitignored(targetRoot, "tmp/apex-workflow/.doctor-check")) {
    add(checks, "pass", "tmp/apex-workflow gitignore", "tmp/apex-workflow is ignored");
  } else {
    add(checks, "fail", "tmp/apex-workflow gitignore", "add tmp/ or tmp/apex-workflow/ to .gitignore");
  }

  const agents = readText(join(targetRoot, "AGENTS.md"));
  if (agents.includes(START_MARKER) && agents.includes(END_MARKER)) {
    add(checks, "pass", "AGENTS managed block", "managed Apex block exists");
  } else {
    add(checks, "fail", "AGENTS managed block", "AGENTS.md is missing the Apex managed block");
  }

  await checkTracker(checks, config, targetRoot, args);
  await checkCodeIntelligence(checks, config, targetRoot, args);
  await checkBrowser(checks, config, targetRoot, args);
  checkCodebaseMap(checks, targetRoot, config, mapEvaluation);
  checkSkillLink(checks, config, args);
  checkBaseline(checks, targetRoot);

  const strict = Boolean(args.strict);
  const decoratedChecks = checks.map((check) => ({
    ...check,
    effectiveStatus: strict && check.status === "warn" ? "fail" : check.status,
  }));
  const failCount = decoratedChecks.filter((check) => check.effectiveStatus === "fail").length;
  const warnCount = checks.filter((check) => check.status === "warn").length;

  if (args.json) {
    const report = {
      ok: failCount === 0,
      strict,
      target: targetRoot,
      config: configPath,
      blockers: decoratedChecks.filter((check) => check.effectiveStatus === "fail"),
      warnings: decoratedChecks.filter((check) => check.status === "warn"),
      info: decoratedChecks.filter((check) => check.status === "pass"),
      checks: decoratedChecks,
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exit(1);
    return;
  }

  console.log("[apex-doctor] readiness report");
  for (const check of decoratedChecks) {
    const status = check.effectiveStatus !== check.status ? `${check.status}->${check.effectiveStatus}` : check.status;
    console.log(`- [${status}] ${check.label}: ${check.detail}`);
  }

  if (failCount > 0) {
    console.error(`[apex-doctor] not ready: ${failCount} failure(s), ${warnCount} warning(s)`);
    process.exit(1);
  }

  console.log(`[apex-doctor] ready: ${warnCount} warning(s)`);
}

try {
  await main();
} catch (error) {
  console.error(`[apex-doctor] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
