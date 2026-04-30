import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const DEFAULT_STALE_LOCK_MS = 10 * 60 * 1000;

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function timestampIdPart(date = new Date()) {
  return date.toISOString().replace(/\D/g, "").slice(0, 17);
}

export function makeRunId(prefix = "run") {
  return `${prefix}-${timestampIdPart()}-p${process.pid}-${randomUUID().slice(0, 8)}`;
}

export function readManifestFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function writeManifestAtomic(filePath, manifest) {
  const absolute = resolve(filePath);
  mkdirSync(dirname(absolute), { recursive: true });
  const tempPath = join(dirname(absolute), `.${basename(absolute)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(tempPath, absolute);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

export function lockPathForManifest(filePath, root = process.cwd()) {
  const key = sha256(resolve(filePath));
  return join(root, "tmp/apex-workflow/locks", `${key}.lock`);
}

function lockAgeMs(lockPath) {
  try {
    const payload = JSON.parse(readFileSync(lockPath, "utf8"));
    const createdAt = Date.parse(payload.createdAt ?? "");
    if (!Number.isFinite(createdAt)) return 0;
    return Date.now() - createdAt;
  } catch {
    return 0;
  }
}

export function withManifestLock(filePath, callback, options = {}) {
  const lockPath = options.lockPath ?? lockPathForManifest(filePath, options.root ?? process.cwd());
  const staleMs = Number(options.staleMs ?? DEFAULT_STALE_LOCK_MS);
  mkdirSync(dirname(lockPath), { recursive: true });
  let fd = null;
  let acquired = false;
  let removedStaleLock = false;
  try {
    try {
      fd = openSync(lockPath, "wx");
    } catch (error) {
      if (error?.code === "EEXIST" && staleMs >= 0 && lockAgeMs(lockPath) > staleMs) {
        rmSync(lockPath, { force: true });
        removedStaleLock = true;
        fd = openSync(lockPath, "wx");
      } else {
        throw error;
      }
    }
    acquired = true;
    writeFileSync(
      fd,
      JSON.stringify(
        {
          manifest: resolve(filePath),
          pid: process.pid,
          hostname: hostname(),
          token: randomUUID(),
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    closeSync(fd);
    fd = null;
    return callback();
  } catch (error) {
    if (fd !== null) closeSync(fd);
    if (error?.code === "EEXIST") {
      throw new Error(
        `manifest lock exists: ${lockPath}. If no Apex process is running, wait for the stale lock timeout or remove the lock.`,
      );
    }
    throw error;
  } finally {
    if (fd !== null) closeSync(fd);
    if (acquired && existsSync(lockPath)) rmSync(lockPath, { force: true });
    if (removedStaleLock && existsSync(lockPath)) rmSync(lockPath, { force: true });
  }
}
