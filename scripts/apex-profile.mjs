#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { discoverRepoProfile } from "./lib/profile-discovery.mjs";
import { normalizeAdaptiveProfile } from "./lib/profile-model.mjs";
import { buildRecommendations, readObservationRows } from "./lib/profile-recommendations.mjs";
import { resolveInsideRoot } from "./lib/paths.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(SCRIPT_DIR, "../templates/apex.workflow.json");

function usage(exitCode = 0) {
  const message = `
Usage:
  node scripts/apex-profile.mjs show --config=apex.workflow.json --target=/path/to/app [--json]
  node scripts/apex-profile.mjs discover --target=/path/to/app [--out=tmp/apex-workflow/discovered-profile.json] [--write] [--force]
  node scripts/apex-profile.mjs recommend --config=apex.workflow.json --target=/path/to/app
  node scripts/apex-profile.mjs diff --config=apex.workflow.json --target=/path/to/app --recommendations=tmp/apex-workflow/profile-recommendations.json
  node scripts/apex-profile.mjs accept --config=apex.workflow.json --target=/path/to/app --recommendations=tmp/apex-workflow/profile-recommendations.json --yes
`;
  (exitCode === 0 ? console.log : console.error)(message.trim());
  process.exit(exitCode);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") usage(0);
  const args = { _command: command };
  for (const arg of rest) {
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

function selectIds(args) {
  const raw = args.id ?? args.ids;
  if (!raw) return null;
  return new Set(
    String(raw)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function loadConfig(args, targetRoot) {
  const configPath = args.config ?? "apex.workflow.json";
  const resolved = resolveInsideRoot(
    targetRoot,
    args["allow-outside-config"] ? resolve(process.cwd(), String(configPath)) : configPath,
    {
      label: "profile config",
      file: true,
      allowOutside: Boolean(args["allow-outside-config"]),
    },
  );
  if (!existsSync(resolved.absolute)) throw new Error(`config not found: ${resolved.relative}`);
  return { config: readJson(resolved.absolute), path: resolved };
}

function printShow(config, targetRoot, json) {
  const effective = normalizeAdaptiveProfile(config);
  if (json) {
    console.log(JSON.stringify({ target: targetRoot, effective }, null, 2));
    return;
  }
  console.log("[apex-profile] effective profile");
  console.log(`- operating model: ${effective.operatingModel.default}`);
  console.log(`- allowed models: ${effective.operatingModel.allowed.join(", ")}`);
  console.log(`- execute command default: ${effective.operatingModel.executeCommandDefault}`);
  console.log(`- manifest directory: ${effective.manifestPolicy.directory}`);
  console.log(`- default verification preset: ${effective.verification.defaultPreset}`);
  console.log(`- verification presets: ${Object.keys(effective.verification.presets).join(", ") || "none"}`);
  console.log(`- code intelligence fallback evidence: ${effective.codeIntelligence.fallbackEvidence}`);
  console.log(`- observation log: ${effective.profileDiscovery.observationLog}`);
}

function commandDiscover(args, targetRoot) {
  const discovery = discoverRepoProfile(targetRoot);
  const candidateProfile = {
    ...readJson(TEMPLATE_PATH),
    name: discovery.name,
    profileDiscovery: discovery.profileDiscovery,
    operatingModel: discovery.operatingModel,
    manifestPolicy: discovery.manifestPolicy,
    verification: {
      ...readJson(TEMPLATE_PATH).verification,
      defaultPreset: discovery.verificationPreset.defaultPreset,
      broadChecksRunLast: discovery.verificationPreset.broadChecksRunLast,
      expensiveCommandPolicy: discovery.verificationPreset.expensiveCommandPolicy,
      presets: discovery.verificationPreset.presets,
    },
    setup: {
      ...(readJson(TEMPLATE_PATH).setup ?? {}),
      discovery: {
        enabled: true,
        ecosystems: discovery.ecosystems,
        generatedAt: new Date().toISOString(),
      },
    },
  };
  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    target: targetRoot,
    discovery,
    candidateProfile,
  };
  const outPath = resolveInsideRoot(targetRoot, args.out ?? "tmp/apex-workflow/discovered-profile.json", {
    label: "discovery output",
    file: true,
  });
  mkdirSync(dirname(outPath.absolute), { recursive: true });
  writeFileSync(outPath.absolute, `${JSON.stringify(output, null, 2)}\n`);
  let wroteProfile = null;
  if (args.write) {
    const profilePath = resolveInsideRoot(targetRoot, args.profile ?? "apex.workflow.json", {
      label: "profile output",
      file: true,
    });
    if (existsSync(profilePath.absolute) && !args.force) {
      throw new Error(`profile already exists: ${profilePath.relative}. Pass --force to overwrite.`);
    }
    writeFileSync(profilePath.absolute, `${JSON.stringify(candidateProfile, null, 2)}\n`);
    wroteProfile = profilePath.relative;
  }
  console.log("[apex-profile] discovery summary");
  console.log(`- ecosystems: ${discovery.ecosystems.map((entry) => `${entry.id}:${entry.confidence}`).join(", ")}`);
  console.log(`- operating model: ${discovery.operatingModel.default}`);
  console.log(`- wrote: ${outPath.relative}`);
  if (wroteProfile) console.log(`- profile: ${wroteProfile}`);
}

function commandRecommend(args, targetRoot) {
  const { config } = loadConfig(args, targetRoot);
  const effective = normalizeAdaptiveProfile(config);
  const observationLog = resolveInsideRoot(targetRoot, effective.profileDiscovery.observationLog, {
    label: "observation log",
    file: true,
  });
  const observations = readObservationRows(observationLog.absolute);
  const recommendations = buildRecommendations(config, observations);
  const outPath = resolveInsideRoot(targetRoot, "tmp/apex-workflow/profile-recommendations.json", {
    label: "profile recommendations",
    file: true,
  });
  mkdirSync(dirname(outPath.absolute), { recursive: true });
  writeFileSync(outPath.absolute, `${JSON.stringify(recommendations, null, 2)}\n`);
  console.log("[apex-profile] recommendation summary");
  console.log(`- observations: ${observations.rows.length}`);
  console.log(`- invalid observation rows: ${observations.invalidRows}`);
  console.log(`- recommendations: ${recommendations.recommendations.length}`);
  console.log(`- wrote: ${outPath.relative}`);
}

function loadRecommendations(args, targetRoot) {
  const recommendationPath = args.recommendations ?? "tmp/apex-workflow/profile-recommendations.json";
  const resolved = resolveInsideRoot(targetRoot, recommendationPath, {
    label: "profile recommendations",
    file: true,
  });
  if (!existsSync(resolved.absolute)) throw new Error(`recommendations not found: ${resolved.relative}`);
  return { recommendations: readJson(resolved.absolute), path: resolved };
}

function pathSegments(path) {
  return String(path)
    .split(".")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getPath(object, path) {
  return pathSegments(path).reduce((current, segment) => current?.[segment], object);
}

function setPath(object, path, value) {
  const segments = pathSegments(path);
  if (segments.length === 0) throw new Error("recommendation path must not be empty");
  let current = object;
  for (const segment of segments.slice(0, -1)) {
    if (!current[segment] || typeof current[segment] !== "object" || Array.isArray(current[segment])) {
      current[segment] = {};
    }
    current = current[segment];
  }
  current[segments[segments.length - 1]] = value;
}

function selectedRecommendations(recommendations, args) {
  const ids = selectIds(args);
  const entries = recommendations.recommendations ?? [];
  if (!ids) return entries;
  const selected = entries.filter((entry) => ids.has(entry.id));
  const selectedIds = new Set(selected.map((entry) => entry.id));
  const missing = [...ids].filter((id) => !selectedIds.has(id));
  if (missing.length > 0) throw new Error(`recommendation id(s) not found: ${missing.join(", ")}`);
  return selected;
}

function commandDiff(args, targetRoot) {
  const { config } = loadConfig(args, targetRoot);
  const { recommendations } = loadRecommendations(args, targetRoot);
  const selected = selectedRecommendations(recommendations, args);
  console.log("[apex-profile] recommendation diff");
  console.log(`- recommendations: ${selected.length}`);
  for (const recommendation of selected) {
    console.log(`\n## ${recommendation.id}`);
    console.log(`category: ${recommendation.category ?? "profile"}`);
    console.log(`path: ${recommendation.path}`);
    console.log(`reason: ${recommendation.reason ?? "not provided"}`);
    console.log(`current: ${JSON.stringify(getPath(config, recommendation.path))}`);
    console.log(`proposed: ${JSON.stringify(recommendation.proposedValue)}`);
  }
}

function commandAccept(args, targetRoot) {
  if (!args.yes) throw new Error("accept requires --yes");
  const { config, path: configPath } = loadConfig(args, targetRoot);
  const { recommendations } = loadRecommendations(args, targetRoot);
  const selected = selectedRecommendations(recommendations, args);
  const backupDir = resolveInsideRoot(targetRoot, "tmp/apex-workflow/profile-backups", {
    label: "profile backup directory",
  });
  mkdirSync(backupDir.absolute, { recursive: true });
  const backupPath = join(
    backupDir.absolute,
    `apex.workflow.${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}.json`,
  );
  cpSync(configPath.absolute, backupPath);
  for (const recommendation of selected) {
    if (!recommendation.path) throw new Error(`recommendation ${recommendation.id ?? "<unknown>"} has no path`);
    setPath(config, recommendation.path, recommendation.proposedValue);
  }
  writeFileSync(configPath.absolute, `${JSON.stringify(config, null, 2)}\n`);
  const validation = spawnSync(
    process.execPath,
    [join(SCRIPT_DIR, "check-config.mjs"), `--config=${configPath.relative}`, `--target=${targetRoot}`],
    {
      cwd: targetRoot,
      encoding: "utf8",
      stdio: "pipe",
    },
  );
  if (validation.status !== 0) {
    cpSync(backupPath, configPath.absolute);
    throw new Error(`accepted profile failed validation and was restored\n${validation.stdout}${validation.stderr}`);
  }
  console.log("[apex-profile] accepted recommendations");
  console.log(`- applied: ${selected.length}`);
  console.log(`- backup: ${backupDir.relative}/${backupPath.split(/[\\/]/).pop()}`);
  console.log(`- profile: ${configPath.relative}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetRoot = resolve(process.cwd(), String(args.target ?? "."));
  switch (args._command) {
    case "show": {
      const { config } = loadConfig(args, targetRoot);
      printShow(config, targetRoot, Boolean(args.json));
      break;
    }
    case "discover":
      commandDiscover(args, targetRoot);
      break;
    case "recommend":
      commandRecommend(args, targetRoot);
      break;
    case "diff":
      commandDiff(args, targetRoot);
      break;
    case "accept":
      commandAccept(args, targetRoot);
      break;
    default:
      usage(1);
  }
}

try {
  main();
} catch (error) {
  console.error(`[apex-profile] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
