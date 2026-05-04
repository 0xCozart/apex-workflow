#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APEX_ROOT = resolve(SCRIPT_DIR, "..");
const OUT_PATH = join(APEX_ROOT, "tmp/apex-workflow/target-benchmark.json");

function parseArgs(argv) {
  const options = {
    target: null,
    allowDirtyTarget: false,
    write: false,
  };
  for (const arg of argv) {
    if (arg === "--allow-dirty-target") {
      options.allowDirtyTarget = true;
    } else if (arg === "--write") {
      options.write = true;
    } else if (arg.startsWith("--target=")) {
      options.target = arg.slice("--target=".length);
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function usage() {
  return `Usage:
  node scripts/bench-target-repo.mjs --target=/path/to/app [--allow-dirty-target]

Options:
  --target=<path>          Local target repo or fixture to inspect.
  --allow-dirty-target     Do not fail readiness only because the target has dirty git state.
  --write                  Reserved for future mutating benchmark modes. Current benchmark stays read-only.`;
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    return { parseError: error.message };
  }
}

function listExisting(target, candidates) {
  return candidates.filter((candidate) => existsSync(join(target, candidate)));
}

function listDirNames(target, dirPath) {
  const fullPath = join(target, dirPath);
  if (!existsSync(fullPath)) return [];
  return readdirSync(fullPath)
    .filter((entry) => {
      try {
        return statSync(join(fullPath, entry)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? APEX_ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
  return {
    command: [command, ...args].join(" "),
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function gitStatus(target) {
  if (!existsSync(join(target, ".git"))) {
    return {
      available: false,
      dirty: false,
      entries: [],
      note: "target is not a git repo",
    };
  }
  const result = run("git", ["status", "--porcelain=v1"], { cwd: target });
  if (result.status !== 0) {
    return {
      available: false,
      dirty: false,
      entries: [],
      error: `${result.stdout}${result.stderr}`.trim(),
    };
  }
  const entries = result.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  return {
    available: true,
    dirty: entries.length > 0,
    entries,
  };
}

function packageScripts(packageJson) {
  if (!packageJson || packageJson.parseError) return [];
  return Object.keys(packageJson.scripts ?? {}).sort();
}

function inspectProfile(profile) {
  if (!profile || profile.parseError) return null;
  const observationLog = profile.profileDiscovery?.observationLog ?? "tmp/apex-workflow/observations.jsonl";
  const observationPath = observationLog ? join(dirname(profile.__path ?? ""), observationLog) : null;
  const observationRows =
    observationPath && existsSync(observationPath)
      ? readFileSync(observationPath, "utf8").split("\n").filter(Boolean).length
      : 0;
  return {
    tracker: profile.tracker?.provider ?? null,
    codeIntelligence: profile.codeIntelligence?.provider ?? null,
    browser: profile.verification?.browser?.provider ?? profile.browser?.provider ?? profile.browser?.mode ?? null,
    manifestDefaultDir: profile.manifest?.defaultDir ?? null,
    productTruth: profile.authority?.productTruth ?? [],
    executionTruth: profile.authority?.executionTruth ?? [],
    workflowRules: profile.authority?.workflowRules ?? [],
    readFirst: profile.orientation?.readFirst ?? [],
    readBeforeBroadSearch: profile.orientation?.readBeforeBroadSearch ?? [],
    requiredCommands: profile.verification?.requiredCommands ?? [],
    adaptive: {
      operatingModel: profile.operatingModel?.default ?? null,
      executeCommandDefault: profile.operatingModel?.executeCommandDefault ?? null,
      manifestPolicyDirectory: profile.manifestPolicy?.directory ?? null,
      verificationDefaultPreset: profile.verification?.defaultPreset ?? null,
      verificationPresetCount: Object.keys(profile.verification?.presets ?? {}).length,
      sliceTemplateCount: Object.keys(profile.sliceTemplates ?? {}).length,
      observationLog,
      observationRows,
      recommendationReady:
        Boolean(profile.profileDiscovery?.enabled) &&
        observationRows >= Number(profile.profileDiscovery?.recommendAfterManifests ?? 10),
    },
  };
}

function runDoctor(target, profilePath) {
  if (!profilePath) return null;
  const result = run(
    process.execPath,
    [
      join(APEX_ROOT, "scripts/apex-doctor.mjs"),
      `--target=${target}`,
      `--config=${profilePath}`,
      "--skip-commands",
      "--json",
    ],
    { cwd: APEX_ROOT },
  );
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = null;
  }
  return {
    command: "apex-doctor --skip-commands --json",
    status: result.status,
    ok: result.status === 0,
    json,
    stderr: result.stderr.trim(),
  };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }

  if (options.help) {
    console.log(usage());
    return;
  }

  if (!options.target) {
    console.error("--target is required");
    console.error(usage());
    process.exit(2);
  }

  const target = isAbsolute(options.target) ? resolve(options.target) : resolve(process.cwd(), options.target);
  const targetExists = existsSync(target);
  const targetIsDirectory = targetExists && statSync(target).isDirectory();

  const profilePath = targetIsDirectory ? join(target, "apex.workflow.json") : null;
  const profile = profilePath ? readJsonIfExists(profilePath) : null;
  if (profile && !profile.parseError) profile.__path = profilePath;
  const packageJson = targetIsDirectory ? readJsonIfExists(join(target, "package.json")) : null;
  const git = targetIsDirectory ? gitStatus(target) : { available: false, dirty: false, entries: [] };
  const docs = targetIsDirectory
    ? listExisting(target, [
        "AGENTS.md",
        "CLAUDE.md",
        "README.md",
        "CONTRIBUTING.md",
        "SECURITY.md",
        "docs/CODEBASE_MAP.md",
        "docs/ROUTES.md",
        "docs/adoption.md",
      ])
    : [];
  const scripts = packageScripts(packageJson);
  const checks = scripts.filter((script) =>
    /^(test|check|lint|typecheck|build|format|self-check|hardening-check)/.test(script),
  );
  const adapters = {
    githubWorkflows: targetIsDirectory ? listExisting(target, [".github/workflows/ci.yml"]) : [],
    docsDirectories: targetIsDirectory ? listDirNames(target, "docs") : [],
    fixtureDirectories: targetIsDirectory ? listDirNames(target, "fixtures") : [],
  };

  const missing = [];
  if (!targetExists) missing.push("target path does not exist");
  if (targetExists && !targetIsDirectory) missing.push("target path is not a directory");
  if (targetIsDirectory && !profile) missing.push("apex.workflow.json is not present in target");
  if (profile?.parseError) missing.push(`apex.workflow.json is not valid JSON: ${profile.parseError}`);
  if (packageJson?.parseError) missing.push(`package.json is not valid JSON: ${packageJson.parseError}`);
  if (targetIsDirectory && docs.length === 0) missing.push("no common orientation docs found");
  if (targetIsDirectory && checks.length === 0) missing.push("no package.json check/test scripts found");
  if (git.dirty && !options.allowDirtyTarget) missing.push("target has dirty git state");

  const doctor = targetIsDirectory && profile && !profile.parseError ? runDoctor(target, profilePath) : null;
  if (doctor && !doctor.ok) missing.push("apex-doctor --skip-commands did not pass");

  const fatal = [];
  if (!targetExists) fatal.push("target path does not exist");
  if (targetExists && !targetIsDirectory) fatal.push("target path is not a directory");
  if (profile?.parseError) fatal.push(`apex.workflow.json is not valid JSON: ${profile.parseError}`);
  if (packageJson?.parseError) fatal.push(`package.json is not valid JSON: ${packageJson.parseError}`);

  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    target,
    readOnly: true,
    writeRequested: options.write,
    ok: fatal.length === 0,
    profile: {
      exists: Boolean(profile && !profile.parseError),
      path: profilePath,
      parseError: profile?.parseError ?? null,
      summary: inspectProfile(profile),
    },
    readiness: {
      ready: missing.length === 0,
      missing,
      fatal,
      docs,
      checks,
      adapters,
      git,
      doctor,
    },
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);

  console.log("[apex-bench] target benchmark summary");
  console.log(`- target: ${target}`);
  console.log(`- apex profile: ${output.profile.exists ? "present" : "missing"}`);
  console.log(`- orientation docs: ${docs.length}`);
  console.log(`- check scripts: ${checks.length}`);
  console.log(`- dirty target: ${git.dirty}`);
  console.log(`- doctor skip-commands: ${doctor ? doctor.status : "skipped"}`);
  console.log(`- operating model: ${output.profile.summary?.adaptive?.operatingModel ?? "unknown"}`);
  console.log(`- verification presets: ${output.profile.summary?.adaptive?.verificationPresetCount ?? 0}`);
  console.log(`- observations: ${output.profile.summary?.adaptive?.observationRows ?? 0}`);
  console.log(`- readiness ready: ${output.readiness.ready}`);
  console.log(`- ok: ${output.ok}`);
  console.log(`[apex-bench] wrote ${OUT_PATH.replace(`${APEX_ROOT}/`, "")}`);

  if (!output.ok) process.exit(1);
}

main();
