#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, parse, resolve, sep } from "node:path";
import process from "node:process";

function usage(exitCode = 0) {
  const message = `
Usage:
  node scripts/check-config.mjs --config=profiles/minty.workflow.json
  node scripts/check-config.mjs --config=profiles/minty.workflow.json --target=/path/to/app
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
    if (eqIndex === -1) {
      args[arg.slice(2)] = true;
    } else {
      args[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
    }
  }

  return args;
}

function readJson(filePath) {
  const absolute = resolve(process.cwd(), filePath);
  return {
    absolute,
    value: JSON.parse(readFileSync(absolute, "utf8")),
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireObject(root, key, failures) {
  if (!isPlainObject(root[key])) {
    failures.push(`${key} must be an object`);
    return {};
  }

  return root[key];
}

function requireArray(root, key, failures) {
  if (!Array.isArray(root[key])) {
    failures.push(`${key} must be an array`);
    return [];
  }

  return root[key];
}

function requireString(root, key, failures) {
  if (typeof root[key] !== "string" || root[key].trim() === "") {
    failures.push(`${key} must be a non-empty string`);
    return "";
  }

  return root[key];
}

function collectDocPath(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") return null;
  return rawValue.split("#")[0].trim();
}

function exactPathInfo(filePath) {
  const absolute = resolve(filePath);
  if (!existsSync(absolute)) return { exists: false, exact: false, actualPath: null };

  const parsed = parse(absolute);
  const parts = absolute.slice(parsed.root.length).split(sep).filter(Boolean);
  let current = parsed.root;

  for (const [index, part] of parts.entries()) {
    let names;
    try {
      names = readdirSync(current);
    } catch {
      return { exists: true, exact: false, actualPath: join(current, ...parts.slice(index)) };
    }

    if (!names.includes(part)) {
      const caseInsensitiveMatch = names.find((name) => name.toLowerCase() === part.toLowerCase());
      const actualPath = join(current, caseInsensitiveMatch ?? part, ...parts.slice(index + 1));
      return { exists: true, exact: false, actualPath };
    }

    current = join(current, part);
  }

  return { exists: true, exact: true, actualPath: absolute };
}

function collectPathEntries(config) {
  const entries = [];

  for (const group of ["productTruth", "executionTruth", "workflowRules"]) {
    for (const filePath of config.authority?.[group] ?? []) {
      entries.push({ path: collectDocPath(filePath), required: true, source: `authority.${group}` });
    }
  }

  for (const filePath of config.authority?.doNotUseAsAuthority ?? []) {
    entries.push({ path: collectDocPath(filePath), required: false, source: "authority.doNotUseAsAuthority" });
  }

  for (const filePath of config.orientation?.readFirst ?? []) {
    entries.push({ path: collectDocPath(filePath), required: true, source: "orientation.readFirst" });
  }

  for (const filePath of config.orientation?.readBeforeBroadSearch ?? []) {
    entries.push({ path: collectDocPath(filePath), required: true, source: "orientation.readBeforeBroadSearch" });
  }

  for (const sectioned of config.orientation?.sectionedDocs ?? []) {
    entries.push({ path: collectDocPath(sectioned.path), required: true, source: "orientation.sectionedDocs.path" });
  }

  for (const group of ["featureArtifacts", "stateContracts", "surrogates"]) {
    for (const filePath of config.contracts?.[group] ?? []) {
      entries.push({ path: collectDocPath(filePath), required: group !== "surrogates", source: `contracts.${group}` });
    }
  }

  if (config.verification?.knownFailures) {
    entries.push({ path: collectDocPath(config.verification.knownFailures), required: false, source: "verification.knownFailures" });
  }

  for (const filePath of config.uiUx?.designSystemDocs ?? []) {
    entries.push({ path: collectDocPath(filePath), required: false, source: "uiUx.designSystemDocs" });
  }

  return entries.filter((entry) => entry.path);
}

function resolveTargetPath(targetRoot, filePath) {
  if (isAbsolute(filePath)) return filePath;
  return join(targetRoot, filePath);
}

function validateConfig(config, options) {
  const failures = [];
  const warnings = [];

  if (config.version !== 1) failures.push("version must be 1");
  requireString(config, "name", failures);
  if (config.operatorCautions !== undefined) requireArray(config, "operatorCautions", failures);

  const authority = requireObject(config, "authority", failures);
  requireArray(authority, "productTruth", failures);
  requireArray(authority, "executionTruth", failures);
  requireArray(authority, "workflowRules", failures);
  requireArray(authority, "doNotUseAsAuthority", failures);

  const orientation = requireObject(config, "orientation", failures);
  requireArray(orientation, "readFirst", failures);
  requireArray(orientation, "readBeforeBroadSearch", failures);
  requireArray(orientation, "sectionedDocs", failures);

  const modes = requireArray(config, "modes", failures);
  const modeIds = new Set();
  for (const [index, mode] of modes.entries()) {
    if (!isPlainObject(mode)) {
      failures.push(`modes[${index}] must be an object`);
      continue;
    }
    const id = typeof mode.id === "string" && mode.id.trim() !== "" ? mode.id : "";
    if (!id) failures.push(`modes[${index}].id must be a non-empty string`);
    if (modeIds.has(id)) failures.push(`duplicate mode id: ${id}`);
    modeIds.add(id);
    if (typeof mode.useWhen !== "string" || mode.useWhen.trim() === "") {
      failures.push(`modes[${index}].useWhen must be a non-empty string`);
    }
    requireArray(mode, "requiredGates", failures);
    if (typeof mode.codeFacing !== "boolean") failures.push(`modes[${index}].codeFacing must be boolean`);
  }

  const tracker = requireObject(config, "tracker", failures);
  requireString(tracker, "provider", failures);
  requireString(tracker, "authorityRule", failures);
  requireArray(tracker, "recordWhen", failures);
  requireArray(tracker, "dispositions", failures);
  if (!tracker.dispositions?.includes("none")) failures.push("tracker.dispositions must include none");

  const codeIntelligence = requireObject(config, "codeIntelligence", failures);
  requireString(codeIntelligence, "provider", failures);
  requireString(codeIntelligence, "fallback", failures);
  if (!["focused-search", "gitnexus-mcp", "gitnexus-wrapper"].includes(codeIntelligence.provider)) {
    failures.push("codeIntelligence.provider must be focused-search, gitnexus-mcp, or gitnexus-wrapper");
  }
  if (codeIntelligence.availability !== undefined && !isPlainObject(codeIntelligence.availability)) {
    failures.push("codeIntelligence.availability must be an object when present");
  }
  if (codeIntelligence.provider === "gitnexus-mcp" && !isPlainObject(codeIntelligence.mcp)) {
    failures.push("codeIntelligence.mcp must be configured when provider is gitnexus-mcp");
  }

  const contracts = requireObject(config, "contracts", failures);
  requireArray(contracts, "featureArtifacts", failures);
  requireArray(contracts, "stateContracts", failures);
  requireArray(contracts, "surrogates", failures);

  const verification = requireObject(config, "verification", failures);
  if (typeof verification.focusedChecksFirst !== "boolean") failures.push("verification.focusedChecksFirst must be boolean");
  requireArray(verification, "requiredCommands", failures);
  requireArray(verification, "optionalCommands", failures);
  const browser = requireObject(verification, "browser", failures);
  requireString(browser, "provider", failures);
  requireString(browser, "policy", failures);

  const uiUx = requireObject(config, "uiUx", failures);
  requireArray(uiUx, "designSystemDocs", failures);
  requireString(uiUx, "visualSignoff", failures);
  requireString(uiUx, "browserEvidencePolicy", failures);

  const manifest = requireObject(config, "manifest", failures);
  requireString(manifest, "defaultDir", failures);
  requireArray(manifest, "finishPacket", failures);

  if (options.target) {
    const targetRoot = resolve(process.cwd(), options.target);
    if (!existsSync(targetRoot)) failures.push(`target does not exist: ${targetRoot}`);

    for (const entry of collectPathEntries(config)) {
      const absolute = resolveTargetPath(targetRoot, entry.path);
      const info = exactPathInfo(absolute);
      if (!info.exists) {
        const message = `${entry.source} points to missing path under target: ${entry.path}`;
        if (entry.required) failures.push(message);
        else warnings.push(message);
      } else if (!info.exact) {
        const actualPath =
          info.actualPath && info.actualPath.startsWith(targetRoot)
            ? info.actualPath.slice(targetRoot.length + 1)
            : info.actualPath;
        const message = `${entry.source} path casing does not match filesystem: ${entry.path}${
          actualPath ? ` (actual: ${actualPath})` : ""
        }`;
        if (entry.required) failures.push(message);
        else warnings.push(message);
      }
    }
  }

  return { failures, warnings };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.config) usage(1);

  const { absolute, value: config } = readJson(args.config);
  const { failures, warnings } = validateConfig(config, { target: args.target });

  if (warnings.length > 0) {
    console.warn("[apex-config] warnings:");
    for (const warning of warnings) console.warn(`- ${warning}`);
  }

  if (failures.length > 0) {
    console.error("[apex-config] config check failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  const relativeConfig = absolute.startsWith(process.cwd()) ? absolute.slice(process.cwd().length + 1) : absolute;
  console.log(`[apex-config] ok: ${relativeConfig}`);
}

main();
