#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";

function usage(exitCode = 0) {
  const message = `
Usage:
  node scripts/apex-manifest.mjs new --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json --issue=APP-1 --mode=route-local --surface="owner" --downshift="route-local: one owner and focused checks cover the slice"
  node scripts/apex-manifest.mjs check --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json
  node scripts/apex-manifest.mjs files --file=tmp/apex-workflow/<slug>.json
  node scripts/apex-manifest.mjs detect --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json
  node scripts/apex-manifest.mjs summary --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json
`;
  (exitCode === 0 ? console.log : console.error)(message.trim());
  process.exit(exitCode);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") usage(0);

  const args = { _: [], command };
  for (const arg of rest) {
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }

    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) {
      args[arg.slice(2)] = true;
    } else {
      args[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
    }
  }

  return args;
}

function repoPath(filePath) {
  return relative(process.cwd(), resolve(process.cwd(), filePath));
}

function readJson(filePath) {
  const absolute = resolve(process.cwd(), filePath);
  return JSON.parse(readFileSync(absolute, "utf8"));
}

function readManifest(filePath) {
  if (!filePath) throw new Error("--file is required");
  const absolute = resolve(process.cwd(), filePath);
  if (!existsSync(absolute)) throw new Error(`manifest not found: ${filePath}`);
  return JSON.parse(readFileSync(absolute, "utf8"));
}

function writeManifest(filePath, manifest) {
  const absolute = resolve(process.cwd(), filePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(manifest, null, 2)}\n`);
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
  if (!existsSync(resolve(process.cwd(), configPath))) {
    throw new Error(`config not found: ${configPath}`);
  }

  return readJson(configPath);
}

function getMode(config, modeId) {
  return (config.modes ?? []).find((mode) => mode.id === modeId);
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

function makeTemplate(args, config) {
  const mode = String(args.mode ?? "route-local");
  if (!getMode(config, mode)) {
    throw new Error(`invalid mode "${mode}". Expected one of: ${(config.modes ?? []).map((entry) => entry.id).join(", ")}`);
  }

  const issue = String(args.issue ?? "none");
  const trackerDisposition =
    String(args.tracker ?? args["tracker-disposition"] ?? (issue !== "none" ? "existing" : "none"));

  return {
    version: 1,
    app: config.name,
    issue,
    mode,
    surface: String(args.surface ?? "TODO: owning surface"),
    contracts: normalizeStringArray(args.contracts),
    ownedFiles: normalizeStringArray(args.files),
    noTouch: normalizeStringArray(args.noTouch ?? args["no-touch"]),
    codeIntelligence: {
      provider: config.codeIntelligence?.provider ?? "none",
      impacts: makeImpactEntries(args.impact ?? args.impacts),
      detect: null,
    },
    checks: {
      required: normalizeStringArray(args.required),
      optional: normalizeStringArray(args.optional),
      browser: String(args.browser ?? "TODO: route or explicit skip reason"),
      typecheck: String(args.typecheck ?? "TODO: required, known-noisy, or explicit skip reason"),
    },
    tracker: {
      provider: config.tracker?.provider ?? "none",
      disposition: trackerDisposition,
      id: issue !== "none" ? issue : null,
    },
    downshiftProof: String(args.downshift ?? args["downshift-proof"] ?? "TODO: why this is the lightest safe mode"),
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
  if (!manifest.codeIntelligence?.provider) failures.push("codeIntelligence.provider is required");
  if (!Array.isArray(manifest.codeIntelligence?.impacts)) failures.push("codeIntelligence.impacts must be an array");
  if (!manifest.checks || !Array.isArray(manifest.checks.required)) failures.push("checks.required must be an array");
  if (!Array.isArray(manifest.checks?.optional)) failures.push("checks.optional must be an array");
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
  const filePath = args.file;
  if (!filePath) throw new Error("--file is required");
  if (existsSync(resolve(process.cwd(), filePath)) && !args.force) {
    throw new Error(`manifest already exists: ${filePath}. Pass --force to overwrite.`);
  }

  const manifest = makeTemplate(args, config);
  writeManifest(filePath, manifest);
  console.log(`[apex-manifest] wrote ${repoPath(filePath)}`);
}

function commandCheck(args, config) {
  const manifest = readManifest(args.file);
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

function runDetectCommand(command, changedFilesFile) {
  const rendered = command.replaceAll("{changedFilesFile}", changedFilesFile);
  const result = spawnSync(rendered, {
    cwd: process.cwd(),
    shell: true,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function commandDetect(args, config) {
  const manifest = readManifest(args.file);
  const failures = validateManifest(manifest, config);
  if (failures.length > 0) {
    console.error("[apex-manifest] manifest check failed; refusing detect:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  const outputPath = join("/tmp", `apex-workflow-files-${Date.now()}.txt`);
  writeFileSync(outputPath, `${manifest.ownedFiles.join("\n")}\n`);
  console.error(`[apex-manifest] changed-files list: ${outputPath}`);

  const detectCommand = config.codeIntelligence?.detectCommand;
  if (!detectCommand) {
    console.error("[apex-manifest] no detectCommand configured; changed files:");
    console.log(manifest.ownedFiles.join("\n"));
    return;
  }

  runDetectCommand(detectCommand, outputPath);
}

function commandSummary(args, config) {
  const manifest = readManifest(args.file);
  console.log(`App: ${manifest.app ?? config.name}`);
  console.log(`Issue: ${manifest.issue}`);
  console.log(`Mode: ${manifest.mode}`);
  console.log(`Surface: ${manifest.surface}`);
  console.log(`Owned files: ${(manifest.ownedFiles ?? []).length}`);
  console.log(`Contracts: ${(manifest.contracts ?? []).join(", ") || "none listed"}`);
  console.log(`Tracker: ${manifest.tracker?.provider ?? "missing"} / ${manifest.tracker?.disposition ?? "missing"}${manifest.tracker?.id ? ` (${manifest.tracker.id})` : ""}`);
  console.log(`Code intelligence: ${manifest.codeIntelligence?.provider ?? "missing"}`);
  console.log(`Downshift proof: ${manifest.downshiftProof ?? "missing"}`);
  console.log(`Browser: ${manifest.checks?.browser ?? "missing"}`);
  console.log(`Typecheck: ${manifest.checks?.typecheck ?? "missing"}`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const needsConfig = !["files"].includes(args.command);
  const config = needsConfig ? loadConfig(args) : null;

  switch (args.command) {
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
    case "summary":
      commandSummary(args, config);
      break;
    default:
      usage(1);
  }
} catch (error) {
  console.error(`[apex-manifest] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
