import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { redact, tailRedacted } from "./redact.mjs";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT = 1_000_000;
const DEFAULT_TAIL_LIMIT = 4000;

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function writeLog(logPath, body) {
  if (!logPath) return null;
  const absolute = resolve(process.cwd(), logPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, body);
  return sha256(body);
}

function appendCapped(current, chunk, limit) {
  const next = current + chunk;
  if (next.length <= limit) return { value: next, truncated: false };
  return {
    value: next.slice(next.length - limit),
    truncated: true,
  };
}

function taskkill(pid) {
  return new Promise((resolveTaskkill) => {
    execFile("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true }, () => resolveTaskkill());
  });
}

async function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === "win32") {
    await taskkill(child.pid);
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      return;
    }
  }

  await new Promise((resolveKill) => setTimeout(resolveKill, 250));
  if (child.exitCode !== null || child.signalCode !== null) return;

  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process already exited or cannot be signalled by this host.
    }
  }
}

export async function runTrustedCommand(command, options = {}) {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const outputLimit = Number(options.outputLimit ?? DEFAULT_OUTPUT_LIMIT);
  const tailLimit = Number(options.tailLimit ?? DEFAULT_TAIL_LIMIT);
  const shell = options.shell ?? true;
  const cwd = options.cwd ? resolve(String(options.cwd)) : process.cwd();
  const commandSource = String(options.commandSource ?? "unknown");
  const env = options.env ? { ...process.env, ...options.env } : process.env;

  let stdout = "";
  let stderr = "";
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let timedOut = false;
  let timeout = null;
  let error = null;

  const child = spawn(String(command), [], {
    stdio: "pipe",
    cwd,
    shell,
    env,
    detached: process.platform !== "win32",
    windowsHide: true,
  });

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    const next = appendCapped(stdout, chunk, outputLimit);
    stdout = next.value;
    stdoutTruncated = stdoutTruncated || next.truncated;
  });
  child.stderr?.on("data", (chunk) => {
    const next = appendCapped(stderr, chunk, outputLimit);
    stderr = next.value;
    stderrTruncated = stderrTruncated || next.truncated;
  });

  const exitResult = await new Promise((resolveExit) => {
    timeout = setTimeout(async () => {
      timedOut = true;
      await terminateProcessTree(child);
    }, timeoutMs);

    child.on("error", (spawnError) => {
      error = spawnError;
    });

    child.on("close", (status, signal) => {
      resolveExit({ status, signal });
    });
  });

  if (timeout) clearTimeout(timeout);

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - started;
  const stdoutTail = tailRedacted(stdout, tailLimit);
  const stderrTail = tailRedacted(stderr, tailLimit);
  const safeCommand = redact(command);
  const status = exitResult.status ?? (error || timedOut ? 1 : 0);
  const signal = exitResult.signal ?? null;
  const logBody = [
    `commandSource: ${commandSource}`,
    `command: ${safeCommand}`,
    `cwd: ${cwd}`,
    `shell: ${shell}`,
    `timeoutMs: ${timeoutMs}`,
    `startedAt: ${startedAt}`,
    `finishedAt: ${finishedAt}`,
    `exitCode: ${status ?? ""}`,
    `signal: ${signal ?? ""}`,
    `timedOut: ${timedOut}`,
    "",
    "## stdout",
    stdoutTruncated || stdoutTail.truncated ? "[output truncated]\n" : "",
    stdoutTail.text,
    "",
    "## stderr",
    stderrTruncated || stderrTail.truncated ? "[output truncated]\n" : "",
    stderrTail.text,
    "",
  ].join("\n");
  const logSha256 = writeLog(options.logPath, logBody);

  return {
    command: safeCommand,
    commandSource,
    cwd,
    shell,
    status,
    signal,
    timedOut,
    timeoutMs,
    durationMs,
    startedAt,
    finishedAt,
    stdoutTail: stdoutTail.text,
    stderrTail: stderrTail.text,
    stdout: stdoutTail.text,
    stderr: stderrTail.text,
    stdoutTruncated: stdoutTruncated || stdoutTail.truncated,
    stderrTruncated: stderrTruncated || stderrTail.truncated,
    outputTruncated: stdoutTruncated || stderrTruncated || stdoutTail.truncated || stderrTail.truncated,
    logPath: options.logPath ?? null,
    logSha256,
    error,
  };
}
