import { existsSync, readFileSync } from "node:fs";

export function readObservationRows(observationLog) {
  if (!observationLog || !existsSync(observationLog)) return { rows: [], invalidRows: 0 };
  const lines = readFileSync(observationLog, "utf8").split("\n").filter(Boolean);
  const rows = [];
  let invalidRows = 0;
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      invalidRows += 1;
    }
  }
  return { rows, invalidRows };
}

export function buildRecommendations(_config, observationSummary = { rows: [] }) {
  const config = _config ?? {};
  const rows = observationSummary.rows ?? [];
  if (rows.length === 0) {
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      recommendations: [],
      summary: {
        observationCount: 0,
        note: "not enough local observations to recommend profile changes",
      },
    };
  }
  const recommendations = [];
  const add = (recommendation) => {
    if (recommendations.some((entry) => entry.id === recommendation.id)) return;
    recommendations.push({
      confidence: "medium",
      evidence: {},
      ...recommendation,
    });
  };

  const lowSignal = rows.filter(
    (row) =>
      row.codeIntel &&
      (Number(row.codeIntel.unknown ?? 0) > 0 ||
        Number(row.codeIntel.targetNotFound ?? 0) > 0 ||
        row.codeIntel.blockedSlice === true),
  );
  if (lowSignal.length > 0) {
    const currentSkip = Array.isArray(config.codeIntelligence?.skipFor) ? config.codeIntelligence.skipFor : [];
    add({
      id: "code-intelligence-low-signal-paths",
      category: "code-intelligence",
      path: "codeIntelligence.skipFor",
      currentValue: currentSkip,
      proposedValue: [...new Set([...currentSkip, "file_path", "new_file", "manifest_file", "script", "workflow"])],
      reason: "Local observations show low-signal or blocking code-intelligence results for path-like targets.",
      evidence: { observations: lowSignal.length },
    });
    add({
      id: "code-intelligence-focused-source-review",
      category: "code-intelligence",
      path: "codeIntelligence.fallbackEvidence",
      currentValue: config.codeIntelligence?.fallbackEvidence,
      proposedValue: "focused_source_review",
      reason: "Low-signal code-intelligence observations need an explicit source-review fallback.",
      evidence: { observations: lowSignal.length },
    });
  }

  const expensiveChecks = rows.filter(
    (row) =>
      row.checks &&
      (Number(row.checks.durationMs ?? 0) > 120000 ||
        /cargo check|cargo test|npm run build|go test \.\/\.\.\./.test(String(row.checks.command ?? ""))),
  );
  if (expensiveChecks.length > 0 && config.verification?.broadChecksRunLast !== true) {
    add({
      id: "verification-broad-checks-run-last",
      category: "verification",
      path: "verification.broadChecksRunLast",
      currentValue: config.verification?.broadChecksRunLast,
      proposedValue: true,
      reason: "Observed broad or expensive checks should run after focused checks.",
      evidence: { observations: expensiveChecks.length },
    });
  }

  const buildInstallRows = rows.filter((row) => {
    const files = Array.isArray(row.changedFiles) ? row.changedFiles : [];
    return (
      row.sliceType === "build_install" ||
      files.some((file) => /(^Cargo\.(toml|lock)$|^build\.rs$|^scripts\/|^\.github\/workflows\/)/.test(String(file)))
    );
  });
  const missingBuildEvidence = buildInstallRows.filter(
    (row) =>
      row.finishPacket &&
      Number(row.finishPacket.operatorQuestionsAnswered ?? 0) < Number(row.finishPacket.operatorQuestionsRequired ?? 1),
  );
  if (missingBuildEvidence.length > 0) {
    add({
      id: "slice-template-build-install",
      category: "slice-template",
      path: "sliceTemplates.build_install",
      currentValue: config.sliceTemplates?.build_install,
      proposedValue: {
        description: "Build, install, launcher, binary identity, or release workflow work.",
        triggerGlobs: ["Cargo.toml", "Cargo.lock", "build.rs", "scripts/**", ".github/workflows/**"],
        operatingModel: "ledger",
        verificationPreset: "build_install",
        codeIntelPolicy: "focused_source_review",
        finishQuestions: [
          "Did it build?",
          "Which binary was installed?",
          "Where is it installed?",
          "Is the binary nonempty?",
          "What command proved it?",
          "What failed or was skipped?",
          "What is the next safe slice?",
        ],
      },
      reason: "Build/install observations missed operator evidence that should be required for this slice type.",
      evidence: { observations: missingBuildEvidence.length },
    });
    add({
      id: "verification-preset-build-install",
      category: "verification",
      path: "verification.presets.build_install",
      currentValue: config.verification?.presets?.build_install,
      proposedValue: {
        commands: ["git diff --check"],
        requiredEvidence: [
          "installed_binary_path",
          "binary_version_output",
          "binary_size_nonzero",
          "symlink_target",
          "version_store_path",
        ],
      },
      reason: "Build/install slices need explicit binary and install evidence.",
      evidence: { observations: missingBuildEvidence.length },
    });
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    recommendations,
    summary: {
      observationCount: rows.length,
      invalidRows: observationSummary.invalidRows ?? 0,
      note: recommendations.length > 0 ? "profile recommendations generated" : "no actionable recommendations found",
    },
  };
}
