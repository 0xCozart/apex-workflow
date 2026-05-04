import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveInsideRoot } from "./paths.mjs";
import { normalizeProfileDiscovery } from "./profile-model.mjs";

export function observationPath(targetRoot, config) {
  const discovery = normalizeProfileDiscovery(config);
  return resolveInsideRoot(targetRoot, discovery.observationLog, { label: "observation log", file: true });
}

export function appendObservation(targetRoot, config, observation) {
  const discovery = normalizeProfileDiscovery(config);
  if (!discovery.enabled) return { skipped: true, reason: "profileDiscovery.enabled is false" };
  const path = observationPath(targetRoot, config);
  mkdirSync(dirname(path.absolute), { recursive: true });
  appendFileSync(path.absolute, `${JSON.stringify({ timestamp: new Date().toISOString(), ...observation })}\n`);
  return { skipped: false, path: path.relative };
}
