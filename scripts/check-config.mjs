#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import { resolveInsideRoot } from "./lib/paths.mjs";
import { ADAPTIVE_ENUMS } from "./lib/profile-model.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(SCRIPT_DIR, "../schemas/apex.workflow.schema.json");

function usage(exitCode = 0) {
  const message = `
Usage:
  node scripts/check-config.mjs --config=profiles/minty.workflow.json
  node scripts/check-config.mjs --config=profiles/minty.workflow.json --target=/path/to/app
  node scripts/check-config.mjs --config=apex.workflow.json --target=. --format=json
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

function readJson(filePath, options = {}) {
  const absolute = options.absolute ?? resolve(process.cwd(), filePath);
  return {
    absolute,
    value: JSON.parse(readFileSync(absolute, "utf8")),
  };
}

function validateSchema(config) {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const ok = validate(config);
  return {
    ok,
    errors: ok
      ? []
      : (validate.errors ?? []).map((error) => ({
          path: error.instancePath || "/",
          message: error.message ?? "schema validation failed",
          keyword: error.keyword,
          params: error.params,
        })),
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

function optionalObject(root, key, failures) {
  if (root[key] === undefined) return {};
  if (!isPlainObject(root[key])) {
    failures.push(`${key} must be an object when present`);
    return {};
  }
  return root[key];
}

function validateStringSet(values, allowed, label, failures) {
  for (const value of values ?? []) {
    if (!allowed.has(value)) failures.push(`${label} contains invalid value: ${value}`);
  }
}

function validateAdaptiveConfig(config, failures) {
  const operatingModel = optionalObject(config, "operatingModel", failures);
  const allowedModels = Array.isArray(operatingModel.allowed)
    ? operatingModel.allowed
    : ["ledger", "assisted", "executor"];
  validateStringSet(allowedModels, ADAPTIVE_ENUMS.operatingModels, "operatingModel.allowed", failures);
  if (
    operatingModel.default !== undefined &&
    (!ADAPTIVE_ENUMS.operatingModels.has(operatingModel.default) || !allowedModels.includes(operatingModel.default))
  ) {
    failures.push("operatingModel.default must be one of operatingModel.allowed");
  }
  if (
    operatingModel.executeCommandDefault !== undefined &&
    !ADAPTIVE_ENUMS.executeCommandDefaults.has(operatingModel.executeCommandDefault)
  ) {
    failures.push("operatingModel.executeCommandDefault must be disabled, manual, or enabled");
  }

  const manifestPolicy = optionalObject(config, "manifestPolicy", failures);
  if (
    typeof manifestPolicy.directory === "string" &&
    typeof config.manifest?.defaultDir === "string" &&
    manifestPolicy.directory !== config.manifest.defaultDir
  ) {
    failures.push("manifestPolicy.directory must match manifest.defaultDir when both are configured");
  }

  const confidenceByTarget = config.codeIntelligence?.confidenceByTarget;
  if (confidenceByTarget !== undefined) {
    if (!isPlainObject(confidenceByTarget)) {
      failures.push("codeIntelligence.confidenceByTarget must be an object when present");
    } else {
      for (const [target, confidence] of Object.entries(confidenceByTarget)) {
        if (!ADAPTIVE_ENUMS.codeIntelligenceConfidence.has(confidence)) {
          failures.push(`codeIntelligence.confidenceByTarget.${target} has invalid confidence: ${confidence}`);
        }
      }
    }
  }

  const verification = config.verification ?? {};
  const presets = verification.presets;
  const effectivePresetNames = new Set(isPlainObject(presets) ? Object.keys(presets) : ["focused"]);
  if (presets !== undefined && !isPlainObject(presets)) {
    failures.push("verification.presets must be an object when present");
  }
  if (isPlainObject(presets)) {
    if (verification.defaultPreset !== undefined && !presets[verification.defaultPreset]) {
      failures.push("verification.defaultPreset must reference a key in verification.presets");
    }
    for (const [name, preset] of Object.entries(presets)) {
      if (!isPlainObject(preset)) {
        failures.push(`verification.presets.${name} must be an object`);
        continue;
      }
      if (preset.commands !== undefined && !Array.isArray(preset.commands)) {
        failures.push(`verification.presets.${name}.commands must be an array when present`);
      }
      if (preset.requiredEvidence !== undefined && !Array.isArray(preset.requiredEvidence)) {
        failures.push(`verification.presets.${name}.requiredEvidence must be an array when present`);
      }
      if (preset.optionalEvidence !== undefined && !Array.isArray(preset.optionalEvidence)) {
        failures.push(`verification.presets.${name}.optionalEvidence must be an array when present`);
      }
    }
  }

  const sliceTemplates = config.sliceTemplates;
  if (sliceTemplates !== undefined) {
    if (!isPlainObject(sliceTemplates)) {
      failures.push("sliceTemplates must be an object when present");
    } else {
      for (const [name, template] of Object.entries(sliceTemplates)) {
        if (!isPlainObject(template)) {
          failures.push(`sliceTemplates.${name} must be an object`);
          continue;
        }
        if (template.verificationPreset && !effectivePresetNames.has(template.verificationPreset)) {
          failures.push(`sliceTemplates.${name}.verificationPreset must reference verification.presets`);
        }
        if (template.operatingModel && !ADAPTIVE_ENUMS.operatingModels.has(template.operatingModel)) {
          failures.push(`sliceTemplates.${name}.operatingModel has invalid value: ${template.operatingModel}`);
        }
      }
    }
  }
}

function collectDocPath(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") return null;
  return rawValue.split("#")[0].trim();
}

function exactPathInfo(filePath, root = null) {
  const absolute = resolve(filePath);
  const parsed = parse(absolute);
  let current = parsed.root;
  let parts = absolute.slice(parsed.root.length).split(sep).filter(Boolean);

  if (root) {
    current = resolve(root);
    const relativePath = relative(current, absolute);
    if (relativePath === "") return { exists: true, exact: true, actualPath: absolute };
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      return { exists: false, exact: false, actualPath: null };
    }
    parts = relativePath.split(sep).filter(Boolean);
  }

  for (const [index, part] of parts.entries()) {
    let names;
    try {
      names = readdirSync(current);
    } catch {
      return { exists: true, exact: false, actualPath: join(current, ...parts.slice(index)) };
    }

    if (!names.includes(part)) {
      const caseInsensitiveMatch = names.find((name) => name.toLowerCase() === part.toLowerCase());
      if (!caseInsensitiveMatch) {
        return { exists: false, exact: false, actualPath: null };
      }
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
    entries.push({
      path: collectDocPath(config.verification.knownFailures),
      required: false,
      source: "verification.knownFailures",
    });
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

function normalizeTargetRoot(target) {
  const targetRoot = resolve(process.cwd(), target);
  if (!existsSync(targetRoot)) return targetRoot;
  return realpathSync(targetRoot);
}

function validateConfig(config, options) {
  const failures = [];
  const warnings = [];

  if (config.version !== 1) failures.push("version must be 1");
  requireString(config, "name", failures);
  if (config.operatorCautions !== undefined) requireArray(config, "operatorCautions", failures);
  if (config.security !== undefined) {
    if (!isPlainObject(config.security)) {
      failures.push("security must be an object when present");
    } else if (config.security.commandPolicy !== undefined) {
      const policy = config.security.commandPolicy;
      if (!isPlainObject(policy)) {
        failures.push("security.commandPolicy must be an object when present");
      } else {
        const mode = typeof policy.mode === "string" ? policy.mode : "";
        if (!["trusted-shell", "allowlisted-shell", "restricted-shell", "exec-array-only"].includes(mode)) {
          failures.push(
            "security.commandPolicy.mode must be trusted-shell, allowlisted-shell, restricted-shell, or exec-array-only",
          );
        }
        if (policy.allowedCommands !== undefined) requireArray(policy, "allowedCommands", failures);
        if (policy.blockedShellTokens !== undefined) requireArray(policy, "blockedShellTokens", failures);
        if (
          mode === "allowlisted-shell" &&
          (!Array.isArray(policy.allowedCommands) || policy.allowedCommands.length === 0)
        ) {
          failures.push(
            "security.commandPolicy.allowedCommands must list at least one pattern in allowlisted-shell mode",
          );
        }
      }
    }
  }

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
  if (typeof verification.focusedChecksFirst !== "boolean")
    failures.push("verification.focusedChecksFirst must be boolean");
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

  validateAdaptiveConfig(config, failures);

  if (options.target) {
    const targetRoot = normalizeTargetRoot(options.target);
    if (!existsSync(targetRoot)) failures.push(`target does not exist: ${targetRoot}`);

    for (const entry of collectPathEntries(config)) {
      const absolute = resolveTargetPath(targetRoot, entry.path);
      const info = exactPathInfo(absolute, targetRoot);
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

  const targetRoot = args.target ? resolve(process.cwd(), String(args.target)) : process.cwd();
  let configPath;
  try {
    const rawConfigPath = Boolean(args["allow-outside-config"])
      ? resolve(process.cwd(), String(args.config))
      : args.config;
    configPath = resolveInsideRoot(targetRoot, rawConfigPath, {
      label: "config path",
      file: true,
      allowOutside: Boolean(args["allow-outside-config"]) || !args.target,
    }).absolute;
  } catch (error) {
    console.error(`[apex-config] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const { absolute, value: config } = readJson(args.config, { absolute: configPath });
  const schema = validateSchema(config);
  const repoChecks = schema.ok
    ? validateConfig(config, { target: args.target })
    : { failures: [], warnings: [], skipped: true };
  const jsonResult = {
    ok: schema.ok && repoChecks.failures.length === 0,
    config: absolute.startsWith(process.cwd()) ? absolute.slice(process.cwd().length + 1) : absolute,
    schema,
    repoChecks: {
      ok: !repoChecks.skipped && repoChecks.failures.length === 0,
      skipped: Boolean(repoChecks.skipped),
      errors: repoChecks.failures,
      warnings: repoChecks.warnings,
    },
  };

  if (args.format === "json") {
    console.log(JSON.stringify(jsonResult, null, 2));
    process.exit(jsonResult.ok ? 0 : 1);
  }

  if (!schema.ok) {
    console.error("[apex-config] schema validation failed:");
    for (const error of schema.errors) {
      console.error(`- ${error.path} ${error.message}`);
    }
    process.exit(1);
  }

  if (repoChecks.warnings.length > 0) {
    console.warn("[apex-config] warnings:");
    for (const warning of repoChecks.warnings) console.warn(`- ${warning}`);
  }

  if (repoChecks.failures.length > 0) {
    console.error("[apex-config] config check failed:");
    for (const failure of repoChecks.failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  const relativeConfig = absolute.startsWith(process.cwd()) ? absolute.slice(process.cwd().length + 1) : absolute;
  console.log(`[apex-config] ok: ${relativeConfig}`);
}

main();
