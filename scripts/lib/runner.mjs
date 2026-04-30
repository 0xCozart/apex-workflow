import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { redact, tailRedacted } from "./redact.mjs";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT = 4000;
const DEFAULT_MAX_BUFFER = 2 * 1024 * 1024;

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

export function runTrustedCommand(command, options = {}) {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const outputLimit = Number(options.outputLimit ?? DEFAULT_OUTPUT_LIMIT);
  const shell = options.shell ?? true;
  const cwd = options.cwd ? resolve(String(options.cwd)) : process.cwd();
  const commandSource = String(options.commandSource ?? "unknown");

  const result = spawnSync(String(command), {
    cwd,
    shell,
    encoding: "utf8",
    stdio: "pipe",
    timeout: timeoutMs,
    maxBuffer: Number(options.maxBuffer ?? DEFAULT_MAX_BUFFER),
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - started;
  const timedOut = result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM";
  const stdoutTail = tailRedacted(result.stdout ?? "", outputLimit);
  const stderrTail = tailRedacted(result.stderr ?? "", outputLimit);
  const safeCommand = redact(command);
  const logBody = [
    `commandSource: ${commandSource}`,
    `command: ${safeCommand}`,
    `cwd: ${cwd}`,
    `shell: ${shell}`,
    `timeoutMs: ${timeoutMs}`,
    `startedAt: ${startedAt}`,
    `finishedAt: ${finishedAt}`,
    `exitCode: ${result.status ?? ""}`,
    `signal: ${result.signal ?? ""}`,
    `timedOut: ${timedOut}`,
    "",
    "## stdout",
    stdoutTail.truncated ? "[output truncated]\n" : "",
    stdoutTail.text,
    "",
    "## stderr",
    stderrTail.truncated ? "[output truncated]\n" : "",
    stderrTail.text,
    "",
  ].join("\n");
  const logSha256 = writeLog(options.logPath, logBody);

  return {
    command: safeCommand,
    rawCommand: String(command),
    commandSource,
    cwd,
    shell,
    status: result.status ?? (result.error ? 1 : 0),
    signal: result.signal ?? null,
    timedOut,
    timeoutMs,
    durationMs,
    startedAt,
    finishedAt,
    stdout: stdoutTail.text,
    stderr: stderrTail.text,
    stdoutTruncated: stdoutTail.truncated,
    stderrTruncated: stderrTail.truncated,
    outputTruncated: stdoutTail.truncated || stderrTail.truncated,
    logPath: options.logPath ?? null,
    logSha256,
    error: result.error ?? null,
  };
}
