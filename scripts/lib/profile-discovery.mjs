import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function listFiles(targetRoot) {
  try {
    return new Set(readdirSync(targetRoot));
  } catch {
    return new Set();
  }
}

function hasAny(files, names) {
  return names.some((name) => files.has(name));
}

function packageScripts(pkg) {
  return pkg?.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
}

function commandIfScript(pkg, scriptName, command) {
  return packageScripts(pkg)[scriptName] ? command : null;
}

function detectedEcosystems(targetRoot, pkg) {
  const files = listFiles(targetRoot);
  const ecosystems = [];
  if (hasAny(files, ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml"])) {
    ecosystems.push({
      id: "rust",
      confidence: files.has("Cargo.toml") ? "high" : "medium",
      evidence: ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml"].filter((name) => files.has(name)),
      candidateChecks: ["cargo fmt --check", "cargo check", "cargo test"],
    });
  }
  if (pkg || hasAny(files, ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "tsconfig.json"])) {
    const checks = [
      commandIfScript(pkg, "format:check", "npm run format:check"),
      commandIfScript(pkg, "lint", "npm run lint"),
      commandIfScript(pkg, "typecheck", "npm run typecheck"),
      commandIfScript(pkg, "test", "npm test"),
      commandIfScript(pkg, "build", "npm run build"),
    ].filter(Boolean);
    ecosystems.push({
      id: "node",
      confidence: pkg ? "high" : "medium",
      evidence: ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "tsconfig.json"].filter((name) =>
        files.has(name),
      ),
      candidateChecks: checks,
    });
  }
  if (hasAny(files, ["pyproject.toml", "requirements.txt", "setup.py"])) {
    ecosystems.push({
      id: "python",
      confidence: files.has("pyproject.toml") ? "high" : "medium",
      evidence: ["pyproject.toml", "requirements.txt", "setup.py"].filter((name) => files.has(name)),
      candidateChecks: ["pytest", "ruff check", "mypy"],
    });
  }
  if (files.has("go.mod")) {
    ecosystems.push({
      id: "go",
      confidence: "high",
      evidence: ["go.mod"],
      candidateChecks: ["go test ./...", "go vet ./..."],
    });
  }
  if (hasAny(files, ["pom.xml", "build.gradle", "build.gradle.kts"])) {
    ecosystems.push({
      id: "java",
      confidence: "medium",
      evidence: ["pom.xml", "build.gradle", "build.gradle.kts"].filter((name) => files.has(name)),
      candidateChecks: files.has("pom.xml") ? ["mvn test"] : ["./gradlew test"],
    });
  }
  if (ecosystems.length === 0) {
    ecosystems.push({
      id: "docs-only",
      confidence: "measure",
      evidence: [...files].filter((name) => /\.(md|mdx)$/i.test(name)).slice(0, 8),
      candidateChecks: ["git diff --check"],
    });
  }
  return ecosystems;
}

export function discoverRepoProfile(targetRoot, options = {}) {
  const pkg = readJsonIfExists(join(targetRoot, "package.json"));
  const ecosystems = detectedEcosystems(targetRoot, pkg);
  const name = String(options.name ?? pkg?.name ?? basename(targetRoot))
    .replace(/^@/, "")
    .replace(/\//g, "-");
  const primary = ecosystems[0] ?? { id: "unknown", candidateChecks: ["git diff --check"] };
  return {
    name,
    ecosystems,
    operatingModel: {
      default: "ledger",
      allowed: ["ledger", "assisted", "executor"],
      executeCommandDefault: "disabled",
      reason: "Discovery defaults Apex to ledger mode until local observations prove stricter execution is useful.",
    },
    profileDiscovery: {
      enabled: true,
      observationLog: "tmp/apex-workflow/observations.jsonl",
      recommendAfterManifests: 10,
      recommendAfterDays: 7,
    },
    manifestPolicy: {
      directory: "tmp/apex-workflow",
      requiredWhen: [
        "multi_file_change",
        "dirty_worktree_present",
        "shared_surface_change",
        "install_or_release_change",
        "security_sensitive_change",
        "operator_requested_evidence",
      ],
      optionalWhen: ["single_file_low_risk_change", "docs_only_change"],
      deferWhen: ["exploratory_debugging", "single_command_diagnosis", "owned_files_unknown"],
      deferredMode: {
        name: "measurement_debugging",
        recordsCommands: true,
        requiresOwnedFiles: false,
        requiresDetect: false,
      },
    },
    verificationPreset: {
      defaultPreset: "focused",
      broadChecksRunLast: true,
      expensiveCommandPolicy: {
        maxConcurrentJobs: primary.id === "rust" ? 1 : 2,
        warnAfterSeconds: 120,
      },
      presets: {
        focused: {
          commands: primary.candidateChecks.length > 0 ? primary.candidateChecks.slice(0, 2) : ["git diff --check"],
        },
        docs_only: {
          commands: ["git diff --check"],
          skipBroadBuild: true,
        },
      },
    },
  };
}
