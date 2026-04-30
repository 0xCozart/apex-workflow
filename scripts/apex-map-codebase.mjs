#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import {
  DEFAULT_CODEBASE_MAP_PATH,
  GENERATED_END_MARKER,
  GENERATED_MAP_DRAFT_REVIEW_ITEM,
  GENERATED_START_MARKER,
  REQUIRED_CODEBASE_MAP_SECTIONS,
  evaluateCodebaseMap,
  findReviewMarkers,
  setCodebaseMapReviewed,
} from "./lib/codebase-map.mjs";

const IGNORED_DIRS = new Set([
  ".cache",
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "tmp",
]);
const SECRET_FILE_PATTERNS = [
  /^\.env(?:\.|$)/,
  /^id_(?:rsa|ed25519)$/,
  /\.key$/i,
  /\.pem$/i,
];
const MAX_TEXT_FILE_BYTES = 200_000;
const DOC_SCAN_DEPTH = 3;
const ROUTE_ROOT_CANDIDATES = ["src/app", "app", "pages", "src/pages", "routes", "src/routes", "src/app/api"];
const SOURCE_ROOT_CANDIDATES = ["src/lib", "src/components", "src/store", "src/hooks", "src/contexts", "src/types"];

function usage(exitCode = 0) {
  const message = `
Usage:
  apex-map-codebase --target=. --write
  apex-map-codebase --target=. --check
  apex-map-codebase --target=. --mark-reviewed --sync-profile

Options:
  --target=<path>            Target repo. Defaults to current directory.
  --output=<path>            Map path under target. Defaults to docs/CODEBASE_MAP.md.
  --config=<path>            Apex profile path. Defaults to apex.workflow.json under target when present.
  --write                    Write a draft map when missing.
  --refresh                  Write a refreshed draft. Existing maps write to a sibling .draft.md unless --force is passed.
  --check                    Validate the map.
  --require-reviewed         With --check, require Status: reviewed.
  --mark-reviewed            Mark map reviewed after REVIEW NEEDED markers are removed.
  --sync-profile             With --mark-reviewed, update apex.workflow.json orientation/setup fields.
  --force                    Allow overwriting an existing map.
  --date=<YYYY-MM-DD>        Override generation date for deterministic tests.
  --format=json              Print machine-readable output.
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

function insideRoot(root, candidate) {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith("/") && !relativePath.match(/^[A-Za-z]:/));
}

function resolveTargetPath(targetRoot, rawPath) {
  const resolved = resolve(targetRoot, String(rawPath));
  if (!insideRoot(targetRoot, resolved)) {
    throw new Error(`path must stay inside target: ${rawPath}`);
  }
  return resolved;
}

function relativeToTarget(targetRoot, absolutePath) {
  return relative(targetRoot, absolutePath).replace(/\\/g, "/");
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readTextIfExists(filePath) {
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf8");
}

function isIgnoredDir(name) {
  return IGNORED_DIRS.has(name);
}

function isSecretLikeFile(name) {
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

function isProbablyBinaryOrLarge(filePath) {
  const stats = statSync(filePath);
  return !stats.isFile() || stats.size > MAX_TEXT_FILE_BYTES;
}

function actualRelativePath(targetRoot, candidate) {
  const parts = String(candidate).split(/[\\/]+/).filter(Boolean);
  let current = targetRoot;
  const actualParts = [];

  for (const part of parts) {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return null;
    }

    const exact = entries.find((entry) => entry.name === part);
    const insensitive = exact ?? entries.find((entry) => entry.name.toLowerCase() === part.toLowerCase());
    if (!insensitive) return null;
    actualParts.push(insensitive.name);
    current = join(current, insensitive.name);
  }

  return actualParts.join("/");
}

function existingRelativePaths(targetRoot, candidates) {
  return [...new Set(candidates.map((candidate) => actualRelativePath(targetRoot, candidate)).filter(Boolean))].sort();
}

function collectTopLevelDirs(targetRoot) {
  return readdirSync(targetRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !isIgnoredDir(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function collectMarkdownDocs(targetRoot, root = targetRoot, depth = 0, out = []) {
  if (depth > DOC_SCAN_DEPTH) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (isIgnoredDir(entry.name)) continue;
      collectMarkdownDocs(targetRoot, join(root, entry.name), depth + 1, out);
      continue;
    }

    if (!entry.isFile()) continue;
    if (isSecretLikeFile(entry.name)) continue;
    if (!/\.(md|mdx)$/i.test(entry.name)) continue;
    const absolute = join(root, entry.name);
    if (isProbablyBinaryOrLarge(absolute)) continue;
    out.push(relativeToTarget(targetRoot, absolute));
  }
  return out.sort();
}

function detectPackageManager(targetRoot) {
  if (existsSync(join(targetRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(targetRoot, "yarn.lock"))) return "yarn";
  if (existsSync(join(targetRoot, "package-lock.json"))) return "npm";
  if (existsSync(join(targetRoot, "bun.lockb")) || existsSync(join(targetRoot, "bun.lock"))) return "bun";
  return null;
}

function detectFramework(pkg) {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  if (deps.next) return "Next.js";
  if (deps.vite) return "Vite";
  if (deps["@remix-run/node"] || deps["@remix-run/react"]) return "Remix";
  if (deps.express) return "Express";
  if (deps.react) return "React";
  return null;
}

function collectGitignoreEntries(targetRoot) {
  return readTextIfExists(join(targetRoot, ".gitignore"))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .slice(0, 40);
}

function collectEvidence(targetRoot, configPath) {
  const hasPackageJson = existsSync(join(targetRoot, "package.json"));
  const pkg = readJsonIfExists(join(targetRoot, "package.json"));
  const config = configPath && existsSync(configPath) ? readJsonIfExists(configPath) : null;
  const scripts = Object.keys(pkg?.scripts ?? {}).sort();
  const docs = collectMarkdownDocs(targetRoot);
  return {
    targetName: pkg?.name ?? basename(targetRoot),
    packageManager: detectPackageManager(targetRoot),
    hasPackageJson,
    framework: detectFramework(pkg),
    scripts,
    topLevelDirs: collectTopLevelDirs(targetRoot),
    docs,
    routeRoots: existingRelativePaths(targetRoot, ROUTE_ROOT_CANDIDATES),
    sourceRoots: existingRelativePaths(targetRoot, SOURCE_ROOT_CANDIDATES),
    gitignoreEntries: collectGitignoreEntries(targetRoot),
    apexProfile: config
      ? {
          path: relativeToTarget(targetRoot, configPath),
          authority: config.authority ?? null,
          orientation: config.orientation ?? null,
          contracts: config.contracts ?? null,
          verification: config.verification ?? null,
          codeIntelligence: config.codeIntelligence
            ? { provider: config.codeIntelligence.provider, fallback: config.codeIntelligence.fallback }
            : null,
        }
      : null,
  };
}

function bulletList(items, fallback = "- none detected") {
  if (!items || items.length === 0) return fallback;
  return items.map((item) => `- \`${item}\``).join("\n");
}

function scriptLine(pkgManager, scriptName) {
  const prefix = pkgManager === "yarn" ? "yarn" : pkgManager === "pnpm" ? "pnpm" : pkgManager === "bun" ? "bun run" : "npm run";
  if (pkgManager === "yarn") return `yarn ${scriptName}`;
  return `${prefix} ${scriptName}`;
}

function renderCodebaseMap(evidence, options = {}) {
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const verificationScripts = ["test", "typecheck", "lint", "build", "dev"].filter((scriptName) => evidence.scripts.includes(scriptName));
  const routeRoots = evidence.routeRoots.length > 0 ? evidence.routeRoots : ["REVIEW NEEDED: confirm route or command entry points for this repo."];
  const sourceRoots = evidence.sourceRoots.length > 0 ? evidence.sourceRoots : ["REVIEW NEEDED: confirm primary source roots for this repo."];
  const architectureDocs = evidence.docs.filter((doc) =>
    /(^|\/)(README|AGENTS|CLAUDE|ARCHITECTURE|architecture|PRODUCT|PRD|product|prd)(\.|$)/.test(doc),
  );

  return `# Codebase Map

Status: draft
Generated by: apex-map-codebase
Last generated: ${date}
Review rule: resolve every review marker, run \`apex-map-codebase --target=. --mark-reviewed --sync-profile\`, then run \`apex-map-codebase --target=. --check --require-reviewed\` before treating this map as authoritative.

Purpose: fast orientation for engineering work in this repository.

${GENERATED_START_MARKER}
## High-Level Layout

- Target name: \`${evidence.targetName}\`
${evidence.framework ? `- Detected framework: ${evidence.framework}` : "- Detected framework: REVIEW NEEDED: confirm framework or runtime."}
${evidence.packageManager ? `- Package manager hint: \`${evidence.packageManager}\`` : "- Package manager hint: none detected"}

Top-level directories:
${bulletList(evidence.topLevelDirs)}

Common source roots:
${bulletList(sourceRoots)}

## Architecture Anchors

Docs discovered as likely anchors:
${bulletList(architectureDocs, "- REVIEW NEEDED: rank the architecture/product/workflow docs that agents should read first.")}

All markdown docs discovered within the scan depth:
${bulletList(evidence.docs)}

## Routes, Commands, And Entry Points

Route or entry roots detected:
${bulletList(routeRoots)}

Package scripts:
${bulletList(evidence.scripts)}

${evidence.apexProfile ? `Apex profile: \`${evidence.apexProfile.path}\`` : "Apex profile: none detected"}

## Verification Path By Change Type

Detected verification-related scripts:
${verificationScripts.length > 0 ? verificationScripts.map((scriptName) => `- \`${scriptLine(evidence.packageManager, scriptName)}\``).join("\n") : "- REVIEW NEEDED: no standard test/typecheck/lint/build scripts were detected."}

## Generated Or Ignored Paths

Ignored paths from \`.gitignore\`:
${bulletList(evidence.gitignoreEntries)}

## Map Evidence

- package metadata inspected: ${evidence.hasPackageJson ? "`package.json`" : "none"}
- docs inspected by path only: ${evidence.docs.length}
- route roots detected: ${evidence.routeRoots.length}
- source roots detected: ${evidence.sourceRoots.length}
- ignored path entries inspected: ${evidence.gitignoreEntries.length}
${GENERATED_END_MARKER}

## Core Domains And Ownership Zones

- REVIEW NEEDED: identify the main product/runtime domains and the files or directories that own them.
- REVIEW NEEDED: mark any shared surfaces that require contract-first routing.

## Data, State, Auth, And External Boundaries

- REVIEW NEEDED: document data stores, auth/session boundaries, state containers, and external service clients.
- REVIEW NEEDED: call out public/private or secret-handling boundaries.

## Frequent Edit Hotspots

- REVIEW NEEDED: list high-change files or directories and the checks they require.

## Risk And Coupling Areas

- REVIEW NEEDED: document cross-cutting paths where a local edit can affect multiple routes, jobs, commands, or workflows.

## Keeping This Map Current

Update this map when:

- major directories or route families are added, removed, or renamed
- product authority or workflow docs move
- verification commands change
- ownership of shared state, auth, data, or UI shells changes
- generated evidence no longer matches the repo
`;
}

function resolveOutputPath(targetRoot, args) {
  return resolveTargetPath(targetRoot, args.output ?? DEFAULT_CODEBASE_MAP_PATH);
}

function resolveConfigPath(targetRoot, args) {
  const raw = args.config ?? "apex.workflow.json";
  const configPath = resolveTargetPath(targetRoot, raw);
  return existsSync(configPath) ? configPath : null;
}

function resultForCheck(outputPath, options = {}) {
  if (!existsSync(outputPath)) {
    return {
      ok: false,
      status: "missing",
      output: outputPath,
      errors: [`codebase map not found: ${outputPath}`],
      warnings: [],
      reviewMarkers: [],
      profileUpdated: false,
    };
  }
  const text = readFileSync(outputPath, "utf8");
  return {
    ...evaluateCodebaseMap(text, { requireReviewed: options.requireReviewed }),
    output: outputPath,
    profileUpdated: false,
  };
}

function syncProfile({ targetRoot, configPath, mapPath }) {
  if (!configPath || !existsSync(configPath)) return false;
  const config = readJsonIfExists(configPath);
  const mapRelative = relativeToTarget(targetRoot, mapPath);

  config.orientation ??= {};
  config.orientation.readBeforeBroadSearch ??= [];
  if (!config.orientation.readBeforeBroadSearch.includes(mapRelative)) {
    config.orientation.readBeforeBroadSearch.push(mapRelative);
  }

  config.setup ??= {};
  const reviewNeeded = Array.isArray(config.setup.reviewNeeded) ? config.setup.reviewNeeded : [];
  config.setup.reviewNeeded = reviewNeeded.filter((item) => item !== GENERATED_MAP_DRAFT_REVIEW_ITEM);
  config.setup.reviewRequiredBeforeFirstSlice = config.setup.reviewNeeded.length > 0;

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return true;
}

function printResult(result, args) {
  const serializable = {
    ...result,
    output: result.output ? String(result.output) : null,
  };

  if (args.format === "json") {
    console.log(JSON.stringify(serializable, null, 2));
    return;
  }

  const label = result.ok ? "ok" : "not ready";
  console.log(`[apex-map-codebase] ${label}: ${result.output}`);
  for (const warning of result.warnings ?? []) console.log(`- [warn] ${warning}`);
  for (const error of result.errors ?? []) console.log(`- [fail] ${error}`);
  if (result.reviewMarkers?.length > 0) {
    console.log(`- review markers: ${result.reviewMarkers.length}`);
  }
  if (result.profileUpdated) console.log("- profile updated");
}

function writeMap({ targetRoot, outputPath, configPath, args }) {
  let destination = outputPath;
  if (existsSync(outputPath) && !args.force) {
    if (!args.refresh) {
      throw new Error(`codebase map already exists: ${relativeToTarget(targetRoot, outputPath)}. Pass --force or --refresh.`);
    }
    const parsed = outputPath.match(/^(.*?)(\.[^./\\]+)?$/);
    destination = `${parsed?.[1] ?? outputPath}.draft${parsed?.[2] ?? ".md"}`;
    if (existsSync(destination)) {
      throw new Error(`draft refresh already exists: ${relativeToTarget(targetRoot, destination)}. Pass --force to replace it.`);
    }
  }

  const evidence = collectEvidence(targetRoot, configPath);
  const content = renderCodebaseMap(evidence, { date: args.date });
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);

  return {
    ok: true,
    status: "draft",
    output: destination,
    errors: [],
    warnings: destination === outputPath ? ["draft map written; review before treating as authority"] : ["draft refresh written to sibling file"],
    reviewMarkers: findReviewMarkers(content),
    profileUpdated: false,
  };
}

function markReviewed({ targetRoot, outputPath, configPath, args }) {
  if (!existsSync(outputPath)) throw new Error(`codebase map not found: ${relativeToTarget(targetRoot, outputPath)}`);
  const text = readFileSync(outputPath, "utf8");
  const currentCheck = evaluateCodebaseMap(text);
  if (currentCheck.errors.length > 0) {
    return {
      ...currentCheck,
      output: outputPath,
      profileUpdated: false,
    };
  }

  const reviewMarkers = findReviewMarkers(text);
  if (reviewMarkers.length > 0) {
    return {
      ok: false,
      status: "draft",
      output: outputPath,
      errors: [`cannot mark reviewed while REVIEW NEEDED markers remain: ${reviewMarkers.length}`],
      warnings: [],
      reviewMarkers,
      profileUpdated: false,
    };
  }

  const updated = setCodebaseMapReviewed(text);
  writeFileSync(outputPath, updated);
  const checked = evaluateCodebaseMap(updated, { requireReviewed: true });
  const profileUpdated = args["sync-profile"] ? syncProfile({ targetRoot, configPath, mapPath: outputPath }) : false;
  return {
    ...checked,
    output: outputPath,
    profileUpdated,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetRoot = resolve(process.cwd(), String(args.target ?? "."));
  if (!existsSync(targetRoot) || !lstatSync(targetRoot).isDirectory()) {
    throw new Error(`target must be an existing directory: ${targetRoot}`);
  }

  const outputPath = resolveOutputPath(targetRoot, args);
  const configPath = resolveConfigPath(targetRoot, args);
  let result = null;

  if (args.write || args.refresh) {
    result = writeMap({ targetRoot, outputPath, configPath, args });
  }

  if (args["mark-reviewed"]) {
    result = markReviewed({ targetRoot, outputPath, configPath, args });
    if (!result.ok) {
      printResult(result, args);
      process.exit(1);
    }
  }

  if (args.check || args["require-reviewed"]) {
    const previousProfileUpdated = Boolean(result?.profileUpdated);
    result = {
      ...resultForCheck(outputPath, { requireReviewed: Boolean(args["require-reviewed"]) }),
      profileUpdated: previousProfileUpdated,
    };
  }

  if (!result) usage(1);

  printResult(result, args);
  process.exit(result.ok ? 0 : 1);
}

try {
  main();
} catch (error) {
  if (process.argv.includes("--format=json")) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          status: "error",
          output: null,
          errors: [error instanceof Error ? error.message : String(error)],
          warnings: [],
          reviewMarkers: [],
          profileUpdated: false,
        },
        null,
        2,
      ),
    );
  } else {
    console.error(`[apex-map-codebase] ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(1);
}
