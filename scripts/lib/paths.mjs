import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function normalizeRoot(root) {
  const resolved = resolve(String(root || "."));
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function existingAncestor(filePath) {
  let current = resolve(filePath);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function isInside(root, candidate) {
  const relativePath = relative(root, candidate);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") &&
      !isAbsolute(relativePath) &&
      !relativePath.match(/^[A-Za-z]:/))
  );
}

export function normalizeRepoPath(value) {
  return String(value ?? "").replace(/\\/g, "/").replace(/^\.\/+/, "");
}

export function repoRelative(root, absolutePath) {
  return normalizeRepoPath(relative(normalizeRoot(root), resolve(String(absolutePath))));
}

export function resolveInsideRoot(root, candidate, options = {}) {
  const label = options.label ?? "path";
  const raw = String(candidate ?? "").trim();
  if (!raw) throw new Error(`${label} is required`);

  const rootPath = normalizeRoot(root);
  const resolved = isAbsolute(raw) ? resolve(raw) : resolve(rootPath, raw);
  const ancestor = existingAncestor(resolved);
  const comparableAncestor = existsSync(ancestor) ? realpathSync(ancestor) : ancestor;
  const comparableResolved = resolved.replace(ancestor, comparableAncestor);

  if (!options.allowOutside && !isInside(rootPath, comparableResolved)) {
    throw new Error(`${label} must stay inside target repo: ${raw}`);
  }
  if (options.file && comparableResolved === rootPath) {
    throw new Error(`${label} must be a file path under target repo: ${raw}`);
  }

  return {
    absolute: comparableResolved,
    relative: normalizeRepoPath(relative(rootPath, comparableResolved)),
  };
}

export function ensureParentInsideRoot(root, candidate, options = {}) {
  const resolved = resolveInsideRoot(root, candidate, { ...options, file: true });
  resolveInsideRoot(root, dirname(resolved.absolute), {
    label: `${options.label ?? "path"} parent`,
  });
  return resolved;
}

export function assertPathInsideRoot(root, absolutePath, label = "path") {
  return resolveInsideRoot(root, absolutePath, { label, allowOutside: false });
}
