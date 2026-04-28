#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APEX_ROOT = resolve(SCRIPT_DIR, "..");
const START_MARKER = "<!-- apex-workflow:start -->";
const END_MARKER = "<!-- apex-workflow:end -->";

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

function run(command, cwd) {
  return spawnSync(command, { cwd, shell: true, encoding: "utf8", stdio: "pipe" });
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
      return normalized === "tmp/" || normalized === "tmp" || normalized === "tmp/apex-workflow/" || normalized === "tmp/apex-workflow";
    });
}

function commandCheck(checks, label, command, targetRoot, args) {
  if (!command) {
    add(checks, "warn", label, "no status command is configured; verify host connector availability in-session");
    return;
  }
  if (args["skip-commands"]) {
    add(checks, "warn", label, `not executed because --skip-commands was passed: ${command}`);
    return;
  }

  const result = run(command, targetRoot);
  if (result.status === 0) add(checks, "pass", label, command);
  else add(checks, "fail", label, `${command} exited ${result.status ?? "unknown"}${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
}

function checkTracker(checks, config, targetRoot, args) {
  const tracker = config.tracker ?? {};
  if (!tracker.provider || tracker.provider === "none") {
    add(checks, "pass", "tracker readiness", "tracker provider is none");
    return;
  }
  commandCheck(checks, "tracker readiness", tracker.statusCommand ?? tracker.checkCommand, targetRoot, args);
}

function wrapperReady(wrapper) {
  return Boolean(wrapper?.enabled && (wrapper.statusCommand || wrapper.queryCommand || wrapper.detectCommand));
}

function checkCodeIntelligence(checks, config, targetRoot, args) {
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
    commandCheck(checks, "GitNexus wrapper readiness", code.wrapperFallback?.statusCommand ?? code.statusCommand, targetRoot, args);
  }
}

function checkBrowser(checks, config, targetRoot, args) {
  const browser = config.verification?.browser ?? {};
  if (!browser.provider || browser.provider === "none") {
    add(checks, "pass", "browser readiness", "browser provider is none");
    return;
  }
  commandCheck(checks, "browser readiness", browser.statusCommand ?? browser.checkCommand ?? "command -v agent-browser", targetRoot, args);
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

function runConfigCheck(checks, configPath, targetRoot) {
  const result = spawnSync(process.execPath, [join(APEX_ROOT, "scripts/check-config.mjs"), `--config=${configPath}`, `--target=${targetRoot}`], {
    cwd: targetRoot,
    encoding: "utf8",
  });

  if (result.status === 0) add(checks, "pass", "profile validation", "check-config passed");
  else add(checks, "fail", "profile validation", (result.stderr || result.stdout || "check-config failed").trim());
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetRoot = resolve(process.cwd(), String(args.target ?? "."));
  const configPath = resolve(targetRoot, String(args.config ?? "apex.workflow.json"));
  const checks = [];

  if (!existsSync(configPath)) throw new Error(`config not found: ${configPath}`);

  const config = readJson(configPath);
  runConfigCheck(checks, configPath, targetRoot);

  const reviewNeeded = config.setup?.reviewNeeded ?? [];
  if (reviewNeeded.length === 0) add(checks, "pass", "setup.reviewNeeded", "no unresolved installer review items");
  else add(checks, "fail", "setup.reviewNeeded", reviewNeeded.join("; "));

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

  checkTracker(checks, config, targetRoot, args);
  checkCodeIntelligence(checks, config, targetRoot, args);
  checkBrowser(checks, config, targetRoot, args);
  checkSkillLink(checks, config, args);
  checkBaseline(checks, targetRoot);

  const failCount = checks.filter((check) => check.status === "fail" || (args.strict && check.status === "warn")).length;
  const warnCount = checks.filter((check) => check.status === "warn").length;

  console.log("[apex-doctor] readiness report");
  for (const check of checks) {
    console.log(`- [${check.status}] ${check.label}: ${check.detail}`);
  }

  if (failCount > 0) {
    console.error(`[apex-doctor] not ready: ${failCount} failure(s), ${warnCount} warning(s)`);
    process.exit(1);
  }

  console.log(`[apex-doctor] ready: ${warnCount} warning(s)`);
}

try {
  main();
} catch (error) {
  console.error(`[apex-doctor] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
