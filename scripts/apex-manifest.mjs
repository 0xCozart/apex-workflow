#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";

function usage(exitCode = 0) {
  const message = `
Usage:
  node scripts/apex-manifest.mjs new --config=apex.workflow.json --slug=<slug> --issue=APP-1 --mode=route-local --surface="owner" --downshift="route-local: one owner and focused checks cover the slice"
  node scripts/apex-manifest.mjs new --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json --issue=APP-1 --mode=route-local --surface="owner" --downshift="route-local: one owner and focused checks cover the slice"
  node scripts/apex-manifest.mjs check --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json
  node scripts/apex-manifest.mjs files --file=tmp/apex-workflow/<slug>.json
  node scripts/apex-manifest.mjs detect --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json
  node scripts/apex-manifest.mjs summary --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json
  node scripts/apex-manifest.mjs finish --config=apex.workflow.json --file=tmp/apex-workflow/<slug>.json --verified="npm test" --next="APP-2"
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

  return join(defaultDir, slug.endsWith(".json") ? slug : `${slug}.json`);
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
  const filePath = manifestPathFromArgs(args, config);
  if (existsSync(resolve(process.cwd(), filePath)) && !args.force) {
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
  const manifest = readManifest(manifestPathFromArgs(args, config));
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
  const manifest = readManifest(manifestPathFromArgs(args, config));
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
  return `${manifest.codeIntelligence?.provider ?? "missing"}; impacts: ${impactText}; detect: ${detect}`;
}

function finishValue(label, manifest, config, args) {
  const normalized = label.toLowerCase();
  if (normalized === "what landed") return args.landed || manifest.notes || `${manifest.surface} slice`;
  if (normalized === "mode") return manifest.mode ?? "missing";
  if (normalized === "downshift proof") return manifest.downshiftProof ?? "missing";
  if (normalized === "owned files") return formatList(listValue(args.files ?? manifest.ownedFiles));
  if (normalized === "no-touch preserved") return formatList(listValue(args["no-touch"] ?? manifest.noTouch));
  if (normalized === "verified") return formatList(listValue(args.verified ?? manifest.checks?.required));
  if (normalized === "verified commands") return formatList(listValue(args.verified ?? manifest.checks?.required));
  if (normalized === "failed / skipped checks") {
    const failed = normalizeStringArray(args.failed).map((entry) => `failed: ${entry}`);
    const skipped = normalizeStringArray(args.skipped).map((entry) => `skipped: ${entry}`);
    const known = normalizeStringArray(manifest.knownFailures).map((entry) => `known: ${entry}`);
    return formatList([...failed, ...skipped, ...known].length > 0 ? [...failed, ...skipped, ...known] : ["none"]);
  }
  if (normalized === "known failures / not verified") {
    const skipped = normalizeStringArray(args.skipped);
    return formatList([...skipped, ...(manifest.knownFailures ?? [])].length > 0 ? [...skipped, ...(manifest.knownFailures ?? [])] : ["none"]);
  }
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

  const labels = config.manifest?.finishPacket?.length > 0 ? config.manifest.finishPacket : [
    "What landed",
    "Mode",
    "Downshift proof",
    "Owned files",
    "No-touch preserved",
    "Verified commands",
    "Failed / skipped checks",
    "Code-intelligence scope",
    "Tracker update",
    "Next safe slice",
  ];
  const output = [`# Finish Packet`, "", ...labels.flatMap((label) => [`## ${label}`, finishValue(label, manifest, config, args), ""])].join("\n");

  if (args.out) {
    const outPath = resolve(process.cwd(), String(args.out));
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, output.endsWith("\n") ? output : `${output}\n`);
    console.log(`[apex-manifest] wrote ${repoPath(outPath)}`);
    return;
  }

  console.log(output);
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
