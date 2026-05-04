const OPERATING_MODELS = new Set(["ledger", "assisted", "executor"]);
const EXECUTE_COMMAND_DEFAULTS = new Set(["disabled", "manual", "enabled"]);
const CODE_INTELLIGENCE_CONFIDENCE = new Set(["high", "medium", "low", "advisory", "measure", "skip"]);

export const ADAPTIVE_ENUMS = {
  operatingModels: OPERATING_MODELS,
  executeCommandDefaults: EXECUTE_COMMAND_DEFAULTS,
  codeIntelligenceConfidence: CODE_INTELLIGENCE_CONFIDENCE,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function objectValue(value) {
  return isPlainObject(value) ? value : {};
}

export function normalizeOperatingModel(config = {}) {
  const raw = objectValue(config.operatingModel);
  const allowed = stringArray(raw.allowed).length > 0 ? stringArray(raw.allowed) : ["ledger", "assisted", "executor"];
  const defaultModel = typeof raw.default === "string" && raw.default ? raw.default : "ledger";
  return {
    default: defaultModel,
    allowed,
    executeCommandDefault:
      typeof raw.executeCommandDefault === "string" && raw.executeCommandDefault
        ? raw.executeCommandDefault
        : "disabled",
    reason:
      typeof raw.reason === "string" && raw.reason
        ? raw.reason
        : "Default to ledger mode until repo observations prove a stronger operating model is useful.",
  };
}

export function normalizeManifestPolicy(config = {}) {
  const raw = objectValue(config.manifestPolicy);
  const manifest = objectValue(config.manifest);
  return {
    directory:
      typeof raw.directory === "string" && raw.directory.trim() !== ""
        ? raw.directory
        : typeof manifest.defaultDir === "string" && manifest.defaultDir.trim() !== ""
          ? manifest.defaultDir
          : "tmp/apex-workflow",
    requiredWhen: stringArray(raw.requiredWhen),
    optionalWhen: stringArray(raw.optionalWhen),
    deferWhen: stringArray(raw.deferWhen),
    deferredMode: objectValue(raw.deferredMode),
  };
}

export function normalizeVerificationPresets(config = {}) {
  const verification = objectValue(config.verification);
  const rawPresets = objectValue(verification.presets);
  const presets = { ...rawPresets };
  const requiredCommands = stringArray(verification.requiredCommands);
  const optionalCommands = stringArray(verification.optionalCommands);
  if (!presets.focused) {
    presets.focused = {
      commands: requiredCommands.length > 0 ? requiredCommands : ["git diff --check"],
      optionalCommands,
    };
  }
  const defaultPreset =
    typeof verification.defaultPreset === "string" && verification.defaultPreset.trim() !== ""
      ? verification.defaultPreset
      : "focused";
  return {
    defaultPreset,
    broadChecksRunLast: Boolean(verification.broadChecksRunLast),
    expensiveCommandPolicy: objectValue(verification.expensiveCommandPolicy),
    presets,
  };
}

export function normalizeCodeIntelligencePolicy(config = {}) {
  const codeIntelligence = objectValue(config.codeIntelligence);
  return {
    provider: codeIntelligence.provider ?? "focused-search",
    confidenceByTarget: objectValue(codeIntelligence.confidenceByTarget),
    requireFor: stringArray(codeIntelligence.requireFor),
    advisoryFor: stringArray(codeIntelligence.advisoryFor),
    skipFor: stringArray(codeIntelligence.skipFor),
    fallbackEvidence:
      typeof codeIntelligence.fallbackEvidence === "string" && codeIntelligence.fallbackEvidence
        ? codeIntelligence.fallbackEvidence
        : "focused_source_review",
  };
}

export function normalizeFinishPacket(config = {}) {
  const raw = objectValue(config.finishPacket);
  const manifest = objectValue(config.manifest);
  const include = stringArray(raw.include).length > 0 ? stringArray(raw.include) : stringArray(manifest.finishPacket);
  return {
    requireOperatorQuestions: Boolean(raw.requireOperatorQuestions),
    include,
  };
}

export function normalizeProfileDiscovery(config = {}) {
  const raw = objectValue(config.profileDiscovery);
  return {
    enabled: raw.enabled !== false,
    observationLog:
      typeof raw.observationLog === "string" && raw.observationLog.trim() !== ""
        ? raw.observationLog
        : "tmp/apex-workflow/observations.jsonl",
    recommendAfterManifests: Number.isFinite(Number(raw.recommendAfterManifests))
      ? Number(raw.recommendAfterManifests)
      : 10,
    recommendAfterDays: Number.isFinite(Number(raw.recommendAfterDays)) ? Number(raw.recommendAfterDays) : 7,
  };
}

export function normalizeAdaptiveProfile(config = {}) {
  return {
    profileDiscovery: normalizeProfileDiscovery(config),
    operatingModel: normalizeOperatingModel(config),
    manifestPolicy: normalizeManifestPolicy(config),
    verification: normalizeVerificationPresets(config),
    codeIntelligence: normalizeCodeIntelligencePolicy(config),
    finishPacket: normalizeFinishPacket(config),
    sliceTemplates: objectValue(config.sliceTemplates),
  };
}
