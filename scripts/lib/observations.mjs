import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveInsideRoot } from "./paths.mjs";
import { normalizeProfileDiscovery } from "./profile-model.mjs";

const MAX_STRING_LENGTH = 500;
const DROPPED_RAW_FIELDS = new Set(["stdout", "stderr", "output", "raw", "log", "logs", "stdoutTail", "stderrTail"]);
const SECRET_FIELD_PATTERN = /token|password|secret|bearer/i;
const ALLOWED_TOP_LEVEL_FIELDS = new Set([
  "type",
  "slug",
  "sliceType",
  "mode",
  "template",
  "verificationPreset",
  "changedFiles",
  "ownedFiles",
  "checks",
  "check",
  "detect",
  "codeIntel",
  "finishPacket",
  "status",
  "durationMs",
  "durationSeconds",
  "command",
  "reason",
  "error",
  "metadata",
]);

function redactString(value) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(token|password|secret)\b\s*[:=]\s*([^\s"',}]+)/gi, "$1=[REDACTED]")
    .slice(0, MAX_STRING_LENGTH);
}

function sanitizeValue(value, stats) {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitizeValue(entry, stats));
  if (!value || typeof value !== "object") return value;

  const sanitized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (DROPPED_RAW_FIELDS.has(key)) {
      stats.droppedFieldCount += 1;
      continue;
    }
    if (SECRET_FIELD_PATTERN.test(key)) {
      sanitized[key] = "[REDACTED]";
      continue;
    }
    sanitized[key] = sanitizeValue(entry, stats);
  }
  return sanitized;
}

export function sanitizeObservation(observation) {
  const stats = { droppedFieldCount: 0 };
  const sanitized = {};
  for (const [key, value] of Object.entries(observation ?? {})) {
    if (!ALLOWED_TOP_LEVEL_FIELDS.has(key) || DROPPED_RAW_FIELDS.has(key)) {
      stats.droppedFieldCount += 1;
      continue;
    }
    sanitized[key] = sanitizeValue(value, stats);
  }
  if (stats.droppedFieldCount > 0) sanitized.sanitizer = { droppedFieldCount: stats.droppedFieldCount };
  return sanitized;
}

export function observationPath(targetRoot, config) {
  const discovery = normalizeProfileDiscovery(config);
  return resolveInsideRoot(targetRoot, discovery.observationLog, { label: "observation log", file: true });
}

export function appendObservation(targetRoot, config, observation) {
  const discovery = normalizeProfileDiscovery(config);
  if (!discovery.enabled) return { skipped: true, reason: "profileDiscovery.enabled is false" };
  const path = observationPath(targetRoot, config);
  mkdirSync(dirname(path.absolute), { recursive: true });
  appendFileSync(
    path.absolute,
    `${JSON.stringify({ timestamp: new Date().toISOString(), ...sanitizeObservation(observation) })}\n`,
  );
  return { skipped: false, path: path.relative };
}
