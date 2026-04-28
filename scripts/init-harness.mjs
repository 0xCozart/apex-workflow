#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APEX_ROOT = resolve(SCRIPT_DIR, "..");
const TEMPLATE_PATH = join(APEX_ROOT, "templates/apex.workflow.json");
const SKILL_SOURCE = join(APEX_ROOT, "skills/apex-workflow");
const START_MARKER = "<!-- apex-workflow:start -->";
const END_MARKER = "<!-- apex-workflow:end -->";
const GITIGNORE_START_MARKER = "# apex-workflow:start";
const GITIGNORE_END_MARKER = "# apex-workflow:end";

function usage(exitCode = 0) {
  const message = `
Usage:
  npm run init -- --target=/path/to/app
  node scripts/init-harness.mjs --target=/path/to/app --yes

Options:
  --target=<path>                 Target app repo. Defaults to current directory.
  --name=<name>                   App name for apex.workflow.json.
  --config-mode=auto|custom       Auto-infer config or prompt for adapter choices. Defaults to auto.
  --tracker=none|linear|github|file
  --tracker-team=<name>           Tracker team, for Linear-style trackers.
  --tracker-project=<name>        Tracker project or board.
  --code-intelligence=auto|focused-search|gitnexus-mcp|gitnexus-wrapper
  --browser=auto|none|agent-browser
  --origin=<url>                  Browser origin when browser provider is enabled.
  --operator-cautions=<text>      Comma-separated human cautions. Not treated as authority paths.
  --skill-dir=<path>              Codex skills directory. Defaults to $CODEX_HOME/skills or ~/.codex/skills.
  --skip-agents                   Do not create/update AGENTS.md.
  --skip-skill-link               Do not symlink the local skill.
  --force                         Overwrite existing apex.workflow.json and managed AGENTS block.
  --dry-run                       Print what would be written.
  --yes                           Non-interactive; accept inferred/default values.
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

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readTextIfExists(filePath) {
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf8");
}

function splitCsv(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveExistingRelativePath(targetRoot, candidate) {
  const parts = String(candidate).split(/[\\/]+/).filter(Boolean);
  let current = targetRoot;
  const actualParts = [];

  for (const part of parts) {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return null;
    }

    const exact = entries.find((entry) => entry.name === part);
    const caseInsensitive = exact ?? entries.find((entry) => entry.name.toLowerCase() === part.toLowerCase());
    if (!caseInsensitive) return null;

    actualParts.push(caseInsensitive.name);
    current = join(current, caseInsensitive.name);
  }

  return actualParts.join("/");
}

function existingRelativePaths(targetRoot, candidates) {
  return [
    ...new Set(
      candidates
        .map((entry) => resolveExistingRelativePath(targetRoot, entry))
        .filter(Boolean),
    ),
  ];
}

function existingRelativePathRecords(targetRoot, candidates, reason) {
  return existingRelativePaths(targetRoot, candidates).map((filePath) => ({
    path: filePath,
    confidence: "confirmed",
    reason,
  }));
}

function discoveredPathRecords(targetRoot, predicate, reason) {
  return discoverDocs(targetRoot, predicate).map((filePath) => ({
    path: filePath,
    confidence: "guessed",
    reason,
  }));
}

function firstExisting(targetRoot, candidates) {
  return existingRelativePaths(targetRoot, candidates)[0] ?? null;
}

function hasPackageScript(pkg, scriptName) {
  return Boolean(pkg?.scripts?.[scriptName]);
}

function hasAnyPackageScript(pkg, scriptNames) {
  return scriptNames.some((scriptName) => hasPackageScript(pkg, scriptName));
}

function collectMarkdownFiles(targetRoot, root = targetRoot, depth = 0) {
  if (depth > 3) return [];
  const ignored = new Set([".git", ".next", "node_modules", "tmp", "dist", "build", "coverage"]);
  const entries = [];

  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (ignored.has(dirent.name)) continue;

    const absolute = join(root, dirent.name);
    const relativePath = relative(targetRoot, absolute).replace(/\\/g, "/");

    if (dirent.isDirectory()) {
      entries.push(...collectMarkdownFiles(targetRoot, absolute, depth + 1));
      continue;
    }

    if (dirent.isFile() && /\.(md|mdx)$/i.test(dirent.name)) {
      entries.push(relativePath);
    }
  }

  return entries.sort();
}

function discoverDocs(targetRoot, predicate) {
  return collectMarkdownFiles(targetRoot).filter((filePath) => predicate(filePath.toLowerCase()));
}

function rankProductTruth(filePath) {
  const lower = filePath.toLowerCase();
  const base = basename(lower);
  if (lower.includes("/plans/") || lower.includes("audit")) return 40;
  if (base === "prd.md" || base === "product.md" || base === "product_requirements.md") return 0;
  if (lower.includes("master") && lower.includes("prd")) return 1;
  if (lower.includes("canonical") && (lower.includes("prd") || lower.includes("product"))) return 2;
  if (lower.includes("product-requirements")) return 3;
  if (lower.startsWith("docs/prds/index.")) return 4;
  if (lower.includes("/prds/")) return 20;
  return 10;
}

function dedupeRecords(records) {
  const byPath = new Map();

  for (const record of records) {
    const existing = byPath.get(record.path);
    if (!existing || (existing.confidence === "guessed" && record.confidence === "confirmed")) {
      byPath.set(record.path, record);
    }
  }

  return [...byPath.values()];
}

function chooseAuthorityDocRecords(candidates, limit = 3) {
  const ranked = dedupeRecords(candidates).sort(
    (left, right) => rankProductTruth(left.path) - rankProductTruth(right.path) || left.path.localeCompare(right.path),
  );
  const strongMatches = ranked.filter((record) => rankProductTruth(record.path) < 20);
  return (strongMatches.length > 0 ? strongMatches : ranked).slice(0, limit);
}

function inferName(targetRoot, pkg, args) {
  return String(args.name ?? pkg?.name ?? basename(targetRoot)).replace(/^@/, "").replace(/\//g, "-");
}

function inferAuthority(targetRoot) {
  const productCandidates = [
    ...existingRelativePathRecords(
      targetRoot,
      [
        "PRD.md",
        "PRODUCT.md",
        "PRODUCT_REQUIREMENTS.md",
        "docs/PRD.md",
        "docs/product.md",
        "docs/product-requirements.md",
        "docs/PRODUCT.md",
      ],
      "canonical product authority filename",
    ),
    ...discoveredPathRecords(targetRoot, (filePath) =>
      (filePath.includes("prd") || filePath.includes("product-requirements") || filePath.endsWith("/product.md")) &&
      !filePath.includes("thesis"),
      "matched product/prd filename pattern",
    ),
  ];
  const executionCandidates = [
    ...existingRelativePathRecords(
      targetRoot,
      ["TRACKER.md", "ROADMAP.md", "docs/TRACKER.md", "docs/roadmap.md"],
      "canonical execution-state filename",
    ),
    ...discoveredPathRecords(
      targetRoot,
      (filePath) => filePath.includes("tracker") || filePath.includes("roadmap"),
      "matched tracker/roadmap filename pattern",
    ),
  ];
  const workflowRuleRecords = existingRelativePathRecords(
    targetRoot,
    ["AGENTS.md", "CLAUDE.md", "docs/CODEBASE_MAP.md"],
    "repo workflow rule file exists",
  );
  const excludedAuthorityRecords = [
    ...existingRelativePathRecords(targetRoot, ["PRODUCT_THESIS.md"], "known non-authoritative thesis file"),
    ...discoveredPathRecords(targetRoot, (filePath) => filePath.includes("thesis"), "matched thesis filename pattern"),
  ];
  const productTruth = chooseAuthorityDocRecords(productCandidates, 3);
  const executionTruth = dedupeRecords(executionCandidates).slice(0, 3);
  const doNotUseAsAuthority = dedupeRecords(excludedAuthorityRecords);

  return {
    authority: {
      productTruth: productTruth.map((record) => record.path),
      executionTruth: executionTruth.map((record) => record.path),
      workflowRules: workflowRuleRecords.map((record) => record.path),
      doNotUseAsAuthority: doNotUseAsAuthority.map((record) => record.path),
    },
    inferredPaths: {
      productTruth,
      executionTruth,
      workflowRules: workflowRuleRecords,
      doNotUseAsAuthority,
    },
  };
}

function inferOrientation(targetRoot) {
  const readFirstRecords = existsSync(join(targetRoot, "AGENTS.md"))
    ? existingRelativePathRecords(targetRoot, ["AGENTS.md"], "repo entrypoint exists")
    : [{ path: "AGENTS.md", confidence: "generated", reason: "installer creates AGENTS.md managed block" }];
  const readBeforeBroadSearchRecords = existingRelativePathRecords(
    targetRoot,
    [
      "docs/CODEBASE_MAP.md",
      "docs/codebase-map.md",
      "docs/architecture.md",
      "docs/ARCHITECTURE.md",
      "ARCHITECTURE.md",
      "README.md",
    ],
    "orientation doc exists",
  );
  const sectionedDocs = [];
  const sectionedDocRecords = [];

  if (existsSync(join(targetRoot, "CLAUDE.md"))) {
    sectionedDocs.push({
      path: "CLAUDE.md",
      sections: {
        workflow: "Read before non-trivial code changes.",
        qualityTesting: "Read before finishing non-trivial code changes.",
        uxUi: "Read before frontend or interaction changes.",
        browserAutomation: "Read only when browser work is needed.",
      },
    });
    sectionedDocRecords.push({
      path: "CLAUDE.md",
      confidence: "confirmed",
      reason: "sectioned repo guidance exists",
    });
  }

  return {
    orientation: {
      readFirst: readFirstRecords.map((record) => record.path),
      readBeforeBroadSearch: readBeforeBroadSearchRecords.map((record) => record.path),
      sectionedDocs,
    },
    inferredPaths: {
      readFirst: readFirstRecords,
      readBeforeBroadSearch: readBeforeBroadSearchRecords,
      sectionedDocs: sectionedDocRecords,
    },
  };
}

function inferCodeIntelligence(targetRoot, pkg, args) {
  const requested = String(args["code-intelligence"] ?? "auto");
  const hasGitNexus =
    requested === "gitnexus-mcp" ||
    requested === "gitnexus-wrapper" ||
    hasAnyPackageScript(pkg, ["gitnexus", "gitnexus:status", "gitnexus:ensure-fresh"]) ||
    existsSync(join(targetRoot, ".gitnexus")) ||
    existsSync(join(targetRoot, "scripts/run-gitnexus-local.mjs")) ||
    existsSync(join(targetRoot, "docs/runbooks/gitnexus-local-workflow.md"));
  const wrapperFallback = {
    enabled:
      hasAnyPackageScript(pkg, ["gitnexus", "gitnexus:status", "gitnexus:ensure-fresh"]) ||
      existsSync(join(targetRoot, "scripts/run-gitnexus-local.mjs")),
    statusCommand: hasPackageScript(pkg, "gitnexus:status") ? "npm run gitnexus:status" : "npx gitnexus status",
    refreshCommand: hasPackageScript(pkg, "gitnexus:ensure-fresh") ? "npm run gitnexus:ensure-fresh" : "npx gitnexus analyze",
    queryCommand: hasPackageScript(pkg, "gitnexus") ? "npm run gitnexus -- query \"{query}\"" : null,
    contextCommand: hasPackageScript(pkg, "gitnexus") ? "npm run gitnexus -- context \"{symbol}\"" : null,
    impactCommand: hasPackageScript(pkg, "gitnexus") ? "npm run gitnexus -- impact \"{symbol}\"" : null,
    detectCommand: existsSync(join(targetRoot, "scripts/run-gitnexus-local.mjs"))
      ? "node scripts/run-gitnexus-local.mjs detect_changes --changed-files-file \"{changedFilesFile}\""
      : null,
    setup:
      "If GitNexus MCP fails in this environment, add repo-local wrapper scripts around npx gitnexus or a custom wrapper and point these commands at that wrapper.",
  };

  if (requested === "focused-search" || (requested === "auto" && !hasGitNexus)) {
    return {
      provider: "focused-search",
      availability: {
        configuredPreference: "focused-search",
        detectedRepoSupport: "not-required",
        currentHostAvailability: "not-required",
        fallbackCommandReadiness: "not-required",
      },
      mcp: null,
      wrapperFallback: null,
      statusCommand: null,
      refreshCommand: null,
      queryCommand: null,
      contextCommand: null,
      impactCommand: null,
      detectCommand: null,
      fallback: "Use focused source search and route through configured docs.",
    };
  }

  if (requested === "gitnexus-wrapper") {
    return {
      provider: "gitnexus-wrapper",
      availability: {
        configuredPreference: "gitnexus-wrapper",
        detectedRepoSupport: hasGitNexus ? "detected" : "requested-without-detected-repo-support",
        currentHostAvailability: "not-required",
        fallbackCommandReadiness: wrapperFallback.enabled ? "configured" : "missing",
      },
      mcp: {
        preferred: false,
        install: "Install GitNexus as MCP when possible, but this profile is pinned to the wrapper because the target repo requested it.",
        tools: ["gitnexus_query", "gitnexus_context", "gitnexus_impact", "gitnexus_detect_changes", "gitnexus_rename"],
        resources: ["gitnexus://repo/{name}/context", "gitnexus://repo/{name}/clusters", "gitnexus://repo/{name}/processes"],
      },
      wrapperFallback,
      statusCommand: wrapperFallback.statusCommand,
      refreshCommand: wrapperFallback.refreshCommand,
      queryCommand: wrapperFallback.queryCommand,
      contextCommand: wrapperFallback.contextCommand,
      impactCommand: wrapperFallback.impactCommand,
      detectCommand: wrapperFallback.detectCommand,
      fallback: "Use focused source search and route through configured docs when graph tooling is stale, unavailable, or suspiciously low-signal.",
      highRiskWarning: "Warn before proceeding when impact is HIGH or CRITICAL.",
    };
  }

  return {
    provider: "gitnexus-mcp",
    availability: {
      configuredPreference: "gitnexus-mcp",
      detectedRepoSupport: hasGitNexus ? "detected" : "requested-without-detected-repo-support",
      currentHostAvailability: "unknown-until-agent-session-verifies-mcp-tools",
      fallbackCommandReadiness: wrapperFallback.enabled ? "configured" : "missing",
    },
    mcp: {
      preferred: true,
      install:
        "Install GitNexus as an MCP server in the host agent, index the repo with npx gitnexus analyze, then verify gitnexus tools and gitnexus:// resources are visible to the agent.",
      tools: ["gitnexus_query", "gitnexus_context", "gitnexus_impact", "gitnexus_detect_changes", "gitnexus_rename"],
      resources: ["gitnexus://repo/{name}/context", "gitnexus://repo/{name}/clusters", "gitnexus://repo/{name}/processes"],
      staleIndexCommand: "npx gitnexus analyze",
    },
    wrapperFallback,
    statusCommand: null,
    refreshCommand: "npx gitnexus analyze",
    queryCommand: "gitnexus_query({query})",
    contextCommand: "gitnexus_context({name})",
    impactCommand: "gitnexus_impact({target, direction: \"upstream\"})",
    detectCommand: "gitnexus_detect_changes({changedFiles})",
    fallback: "If GitNexus MCP is unavailable or unreliable, use wrapperFallback when enabled; otherwise use focused source search and route through configured docs.",
    highRiskWarning: "Warn before proceeding when impact is HIGH or CRITICAL.",
  };
}

function inferContracts(targetRoot) {
  return {
    featureArtifacts: existingRelativePaths(targetRoot, ["docs/feature-artifacts", "docs/features", "docs/contracts/features"]),
    stateContracts: existingRelativePaths(targetRoot, ["docs/state-contracts", "docs/contracts/state"]),
    surrogates: existingRelativePaths(targetRoot, [
      "docs/plans",
      "docs/ROUTE-INVENTORY.md",
      "docs/routes.md",
      "docs/architecture.md",
      "src/components/__tests__",
      "tests",
    ]),
  };
}

function inferVerification(targetRoot, pkg, args) {
  const requiredCommands = splitCsv(args.required);
  const optionalCommands = splitCsv(args.optional);

  if (requiredCommands.length === 0) {
    if (hasPackageScript(pkg, "typecheck")) requiredCommands.push("npm run typecheck");
    else if (hasPackageScript(pkg, "test")) requiredCommands.push("npm test");
    else if (hasPackageScript(pkg, "lint")) requiredCommands.push("npm run lint");
  }

  for (const [scriptName, command] of [
    ["test", "npm test"],
    ["lint", "npm run lint"],
    ["build", "npm run build"],
    ["typecheck", "npm run typecheck"],
  ]) {
    if (hasPackageScript(pkg, scriptName) && !requiredCommands.includes(command)) {
      optionalCommands.push(command);
    }
  }

  const browserProvider = String(args.browser ?? "auto");
  const hasAgentBrowser =
    browserProvider === "agent-browser" ||
    existsSync(join(targetRoot, "agent-browser.json")) ||
    hasAnyPackageScript(pkg, ["agent-browser:reset", "dev:auto"]);
  const finalBrowserProvider = browserProvider === "none" || (browserProvider === "auto" && !hasAgentBrowser) ? "none" : "agent-browser";

  return {
    focusedChecksFirst: true,
    requiredCommands,
    optionalCommands: [...new Set(optionalCommands)],
    knownFailures: firstExisting(targetRoot, [
      "docs/runbooks/known-verification-failures.md",
      "docs/known-verification-failures.md",
    ]),
    browser: {
      provider: finalBrowserProvider,
      origin: finalBrowserProvider === "agent-browser" ? String(args.origin ?? "http://127.0.0.1:3000") : null,
      artifacts: finalBrowserProvider === "agent-browser" ? "tmp/agent-browser" : null,
      policy:
        finalBrowserProvider === "agent-browser"
          ? "Use browser automation for functional evidence; use human review for final visual signoff unless this profile says otherwise."
          : "Use an explicit skip reason when browser verification is not relevant.",
    },
  };
}

function inferUiUx(targetRoot) {
  const designSystemDocs = existingRelativePaths(targetRoot, [
    ".impeccable.md",
    "DESIGN.md",
    "docs/DESIGN.md",
    "docs/design",
    "docs/design-system.md",
  ]);

  if (existsSync(join(targetRoot, "CLAUDE.md"))) {
    designSystemDocs.push("CLAUDE.md#UX / UI", "CLAUDE.md#Design System");
  }

  return {
    designSystemDocs: [...new Set(designSystemDocs)],
    visualSignoff: "human",
    browserEvidencePolicy: "functional-only unless this profile explicitly allows visual signoff",
  };
}

function makeTracker(args) {
  const provider = String(args.tracker ?? "none");
  return {
    provider,
    team: args["tracker-team"] ?? null,
    project: args["tracker-project"] ?? null,
    authorityRule: "Tracker reflects execution state, not product truth.",
    recordWhen: [
      "medium or large change",
      "user-facing flow, contract, or cross-surface behavior",
      "likely follow-up, coordination, or prioritization need",
      "roadmap, scope, acceptance-criteria, or sequencing change",
    ],
    dispositions: ["none", "existing", "new", "blocked", "reconciliation"],
  };
}

async function promptChoice(rl, label, value, choices, shouldPrompt) {
  if (!shouldPrompt) return value;
  const answer = await rl.question(`${label} (${choices.join("/")}) [${value}]: `);
  const nextValue = answer.trim() || value;
  return choices.includes(nextValue) ? nextValue : value;
}

async function promptText(rl, label, value, shouldPrompt) {
  if (!shouldPrompt) return value;
  const answer = await rl.question(`${label} [${value ?? ""}]: `);
  return answer.trim() || value;
}

async function buildConfig(targetRoot, args) {
  const pkg = readJsonIfExists(join(targetRoot, "package.json"));
  const template = readJsonIfExists(TEMPLATE_PATH);
  const shouldPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY && !args.yes);
  const rl = shouldPrompt ? createInterface({ input: process.stdin, output: process.stdout }) : null;

  try {
    const configMode = await promptChoice(
      rl,
      "Configuration mode",
      String(args["config-mode"] ?? "auto"),
      ["auto", "custom"],
      shouldPrompt,
    );
    args["config-mode"] = configMode;
    const promptAdapters = shouldPrompt && configMode === "custom";
    const name = await promptText(rl, "App name", inferName(targetRoot, pkg, args), shouldPrompt);
    const trackerProvider = await promptChoice(rl, "Tracker provider", String(args.tracker ?? "none"), ["none", "linear", "github", "file"], promptAdapters);
    args.tracker = trackerProvider;
    if (trackerProvider === "linear") {
      args["tracker-team"] = await promptText(rl, "Linear team", args["tracker-team"] ?? null, promptAdapters);
      args["tracker-project"] = await promptText(rl, "Linear project", args["tracker-project"] ?? null, promptAdapters);
    }
    if (trackerProvider === "github") {
      args["tracker-project"] = await promptText(rl, "GitHub project or milestone", args["tracker-project"] ?? null, promptAdapters);
    }

    const codeIntelligenceProvider = await promptChoice(
      rl,
      "Code intelligence",
      String(args["code-intelligence"] ?? "auto"),
      ["auto", "focused-search", "gitnexus-mcp", "gitnexus-wrapper"],
      promptAdapters,
    );
    args["code-intelligence"] = codeIntelligenceProvider;

    const browserProvider = await promptChoice(rl, "Browser provider", String(args.browser ?? "auto"), ["auto", "none", "agent-browser"], promptAdapters);
    args.browser = browserProvider;
    if (browserProvider === "agent-browser") {
      args.origin = await promptText(rl, "Browser origin", args.origin ?? "http://127.0.0.1:3000", promptAdapters);
    }

    const authorityResult = inferAuthority(targetRoot);
    const authority = authorityResult.authority;
    const orientationResult = inferOrientation(targetRoot);
    const orientation = orientationResult.orientation;
    const workflowRules = new Set([...authority.workflowRules, "AGENTS.md"]);
    const contracts = inferContracts(targetRoot);
    const guessedAuthorityPaths = [
      ...authorityResult.inferredPaths.productTruth,
      ...authorityResult.inferredPaths.executionTruth,
    ].filter((record) => record.confidence === "guessed");
    const reviewNeeded = [
      ...(authority.productTruth.length === 0 ? ["No product truth doc was detected. Add one to authority.productTruth if the app has it."] : []),
      ...(orientation.readBeforeBroadSearch.length === 0 ? ["No broad-search orientation doc was detected. Consider adding a codebase map or architecture doc."] : []),
      ...(contracts.featureArtifacts.length === 0 && contracts.stateContracts.length === 0
        ? ["No contract directories were detected. Shared-surface work will rely on source search and surrogate docs."]
        : []),
      ...(guessedAuthorityPaths.length > 0
        ? [
            `Review guessed authority paths before the first implementation slice: ${guessedAuthorityPaths
              .map((record) => record.path)
              .join(", ")}`,
          ]
        : []),
    ];

    return {
      ...template,
      name,
      description: `Apex Workflow profile for ${name}. Generated by the harness installer.`,
      operatorCautions: splitCsv(args["operator-cautions"] ?? args["operator-caution"]),
      authority: {
        ...authority,
        workflowRules: [...workflowRules],
      },
      orientation,
      tracker: makeTracker(args),
      codeIntelligence: inferCodeIntelligence(targetRoot, pkg, args),
      contracts,
      verification: inferVerification(targetRoot, pkg, args),
      uiUx: inferUiUx(targetRoot),
      manifest: template.manifest,
      setup: {
        generatedBy: "apex-workflow init-harness",
        configMode,
        apexRoot: APEX_ROOT,
        targetRoot,
        reviewRequiredBeforeFirstSlice: reviewNeeded.length > 0,
        reviewNeeded,
        inferredPaths: {
          authority: authorityResult.inferredPaths,
          orientation: orientationResult.inferredPaths,
        },
      },
    };
  } finally {
    rl?.close();
  }
}

function makeAgentsBlock(targetRoot) {
  const refreshCommand = `node ${join(APEX_ROOT, "scripts/init-harness.mjs")} --target=. --yes --force`;
  return `${START_MARKER}
## Apex Workflow Harness

Use \`$apex-workflow\` for meaningful execution in this repo.

- Profile: \`apex.workflow.json\`
- Review \`setup.reviewNeeded\`, \`setup.inferredPaths\`, and \`operatorCautions\` before the first implementation slice.
- Select the lightest safe mode before implementation.
- For meaningful code-facing work, create or update a slice manifest under \`tmp/apex-workflow/\`.
- Use the configured tracker, code-intelligence, browser, and UI/UX adapters from the profile.
- Refresh this harness config from the repo root with:

\`\`\`bash
${refreshCommand}
\`\`\`

${END_MARKER}
`;
}

function upsertAgentsBlock(targetRoot, args) {
  if (args["skip-agents"]) return { skipped: true, path: null };

  const agentsPath = join(targetRoot, "AGENTS.md");
  const existing = readTextIfExists(agentsPath);
  const block = makeAgentsBlock(targetRoot);
  let nextContent;

  if (existing.includes(START_MARKER) && existing.includes(END_MARKER)) {
    const pattern = new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}\\n?`, "m");
    nextContent = existing.replace(pattern, block);
  } else {
    nextContent = existing.trimEnd();
    nextContent = nextContent ? `${nextContent}\n\n${block}` : `# Agent Instructions\n\n${block}`;
  }

  if (!args["dry-run"]) {
    writeFileSync(agentsPath, nextContent);
  }

  return { skipped: false, path: agentsPath };
}

function makeGitignoreBlock() {
  return `${GITIGNORE_START_MARKER}
# Apex Workflow local artifacts
tmp/apex-workflow/
tmp/agent-browser/
${GITIGNORE_END_MARKER}
`;
}

function upsertGitignoreBlock(targetRoot, args) {
  const gitignorePath = join(targetRoot, ".gitignore");
  const existing = readTextIfExists(gitignorePath);
  const block = makeGitignoreBlock();
  let nextContent;

  if (existing.includes(GITIGNORE_START_MARKER) && existing.includes(GITIGNORE_END_MARKER)) {
    const pattern = new RegExp(`${GITIGNORE_START_MARKER}[\\s\\S]*?${GITIGNORE_END_MARKER}\\n?`, "m");
    nextContent = existing.replace(pattern, block);
  } else {
    nextContent = existing.trimEnd();
    nextContent = nextContent ? `${nextContent}\n\n${block}` : block;
  }

  if (!args["dry-run"]) {
    writeFileSync(gitignorePath, nextContent);
  }

  return { path: gitignorePath };
}

function installSkillLink(args) {
  if (args["skip-skill-link"]) return { skipped: true, path: null };

  const skillRoot = args["skill-dir"]
    ? resolve(process.cwd(), String(args["skill-dir"]))
    : join(process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME) : join(homedir(), ".codex"), "skills");
  const linkPath = join(skillRoot, "apex-workflow");

  if (args["dry-run"]) return { skipped: false, path: linkPath };

  mkdirSync(skillRoot, { recursive: true });

  if (existsSync(linkPath)) {
    const sameTarget = realpathSync(linkPath) === realpathSync(SKILL_SOURCE);
    if (sameTarget) return { skipped: false, path: linkPath, alreadyInstalled: true };
    if (!args.force) {
      throw new Error(`skill path already exists: ${linkPath}. Pass --force or --skip-skill-link.`);
    }
    rmSync(linkPath, { recursive: true, force: true });
  }

  symlinkSync(SKILL_SOURCE, linkPath, "dir");
  return { skipped: false, path: linkPath };
}

function validateGeneratedConfig(targetRoot) {
  const result = spawnSync(
    process.execPath,
    [join(APEX_ROOT, "scripts/check-config.mjs"), "--config=apex.workflow.json", `--target=${targetRoot}`],
    {
      cwd: targetRoot,
      stdio: "inherit",
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function getGitStatus(targetRoot) {
  const result = spawnSync("git", ["-C", targetRoot, "status", "--short", "--branch"], {
    encoding: "utf8",
  });

  if (result.error || result.status !== 0) {
    return {
      available: false,
      dirty: false,
      bootstrapDirty: false,
      summary: "not a git repo or git status unavailable",
      lines: [],
    };
  }

  const lines = result.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const dirtyLines = lines.filter((line) => !line.startsWith("##"));
  const bootstrapDirty = dirtyLines.some((line) => /\b(AGENTS\.md|apex\.workflow\.json)\b/.test(line));
  const branchLine = lines.find((line) => line.startsWith("##")) ?? "## unknown";

  return {
    available: true,
    dirty: dirtyLines.length > 0,
    bootstrapDirty,
    summary: dirtyLines.length > 0 ? `${branchLine}; ${dirtyLines.length} changed path(s)` : `${branchLine}; clean`,
    lines,
  };
}

function printPathRecords(label, records) {
  console.log(`- ${label}:`);
  if (!records || records.length === 0) {
    console.log("  - none detected");
    return;
  }

  for (const record of records) {
    console.log(`  - [${record.confidence}] ${record.path} (${record.reason})`);
  }
}

function printInstallReport({ config, targetRoot, dryRun }) {
  const gitStatus = getGitStatus(targetRoot);
  console.log("\n[apex-init] install report");
  console.log(`- config mode: ${config.setup?.configMode ?? "unknown"}`);
  console.log(`- tracker: ${config.tracker.provider}${config.tracker.project ? ` / ${config.tracker.project}` : ""}`);
  console.log(`- code intelligence: ${config.codeIntelligence.provider}`);
  if (config.codeIntelligence.availability) {
    console.log(`  - configured preference: ${config.codeIntelligence.availability.configuredPreference}`);
    console.log(`  - repo support: ${config.codeIntelligence.availability.detectedRepoSupport}`);
    console.log(`  - host availability: ${config.codeIntelligence.availability.currentHostAvailability}`);
    console.log(`  - fallback readiness: ${config.codeIntelligence.availability.fallbackCommandReadiness}`);
  }
  console.log(`- browser: ${config.verification.browser.provider}`);
  console.log(`- git status: ${gitStatus.summary}`);

  printPathRecords("authority.productTruth", config.setup?.inferredPaths?.authority?.productTruth ?? []);
  printPathRecords("authority.executionTruth", config.setup?.inferredPaths?.authority?.executionTruth ?? []);
  printPathRecords("orientation.readBeforeBroadSearch", config.setup?.inferredPaths?.orientation?.readBeforeBroadSearch ?? []);

  if (config.operatorCautions?.length > 0) {
    console.log("- operator cautions:");
    for (const caution of config.operatorCautions) console.log(`  - ${caution}`);
  }

  if (config.setup?.reviewNeeded?.length > 0) {
    console.log("- review before first slice:");
    for (const item of config.setup.reviewNeeded) console.log(`  - ${item}`);
  } else {
    console.log("- review before first slice: no installer concerns recorded");
  }

  if (!dryRun && gitStatus.bootstrapDirty) {
    console.log("- baseline checkpoint: commit AGENTS.md/apex.workflow.json setup before the first implementation slice");
  } else if (!dryRun && gitStatus.dirty) {
    console.log("- baseline checkpoint: repo is dirty; separate existing changes from the first implementation slice");
  } else if (!dryRun && gitStatus.available) {
    console.log("- baseline checkpoint: clean baseline detected");
  }
}

function printSummary({ targetRoot, configPath, agentsResult, skillResult, dryRun, config }) {
  const prefix = dryRun ? "[apex-init] dry run complete" : "[apex-init] installed";
  console.log(prefix);
  console.log(`- target: ${targetRoot}`);
  console.log(`- profile: ${relative(targetRoot, configPath)}`);
  if (agentsResult.skipped) console.log("- AGENTS.md: skipped");
  else console.log(`- AGENTS.md: ${relative(targetRoot, agentsResult.path)}`);
  console.log("- .gitignore: Apex local artifact block");
  if (skillResult.skipped) console.log("- skill link: skipped");
  else console.log(`- skill link: ${skillResult.path}${skillResult.alreadyInstalled ? " (already installed)" : ""}`);
  console.log("- next: use $apex-workflow in the target repo and read apex.workflow.json before selecting a mode");
  printInstallReport({ config, targetRoot, dryRun });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetRoot = resolve(process.cwd(), String(args.target ?? "."));
  if (!existsSync(targetRoot) || !lstatSync(targetRoot).isDirectory()) {
    throw new Error(`target must be an existing directory: ${targetRoot}`);
  }

  const configPath = join(targetRoot, "apex.workflow.json");
  if (existsSync(configPath) && !args.force && !args["dry-run"]) {
    throw new Error(`apex.workflow.json already exists in target. Pass --force to replace it.`);
  }

  const config = await buildConfig(targetRoot, args);
  const rendered = `${JSON.stringify(config, null, 2)}\n`;

  if (args["dry-run"]) {
    console.log(`[apex-init] would write ${configPath}`);
    console.log(rendered);
  } else {
    writeFileSync(configPath, rendered);
  }

  const agentsResult = upsertAgentsBlock(targetRoot, args);
  upsertGitignoreBlock(targetRoot, args);
  const skillResult = installSkillLink(args);

  if (!args["dry-run"]) validateGeneratedConfig(targetRoot);
  printSummary({ targetRoot, configPath, agentsResult, skillResult, dryRun: Boolean(args["dry-run"]), config });
}

main().catch((error) => {
  console.error(`[apex-init] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
