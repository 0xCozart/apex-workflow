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

function existingRelativePaths(targetRoot, candidates) {
  return candidates.filter((entry) => existsSync(join(targetRoot, entry)));
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

function chooseAuthorityDocs(candidates, limit = 3) {
  const ranked = [...new Set(candidates)].sort(
    (left, right) => rankProductTruth(left) - rankProductTruth(right) || left.localeCompare(right),
  );
  const strongMatches = ranked.filter((filePath) => rankProductTruth(filePath) < 20);
  return (strongMatches.length > 0 ? strongMatches : ranked).slice(0, limit);
}

function inferName(targetRoot, pkg, args) {
  return String(args.name ?? pkg?.name ?? basename(targetRoot)).replace(/^@/, "").replace(/\//g, "-");
}

function inferAuthority(targetRoot) {
  const productCandidates = [
    ...existingRelativePaths(targetRoot, [
      "PRD.md",
      "PRODUCT.md",
      "PRODUCT_REQUIREMENTS.md",
      "docs/PRD.md",
      "docs/product.md",
      "docs/product-requirements.md",
      "docs/PRODUCT.md",
    ]),
    ...discoverDocs(targetRoot, (filePath) =>
      (filePath.includes("prd") || filePath.includes("product-requirements") || filePath.endsWith("/product.md")) &&
      !filePath.includes("thesis"),
    ),
  ];
  const executionCandidates = [
    ...existingRelativePaths(targetRoot, ["TRACKER.md", "ROADMAP.md", "docs/TRACKER.md", "docs/roadmap.md"]),
    ...discoverDocs(targetRoot, (filePath) => filePath.includes("tracker") || filePath.includes("roadmap")),
  ];

  return {
    productTruth: chooseAuthorityDocs(productCandidates, 3),
    executionTruth: [...new Set(executionCandidates)].slice(0, 3),
    workflowRules: existingRelativePaths(targetRoot, ["AGENTS.md", "CLAUDE.md", "docs/CODEBASE_MAP.md"]),
    doNotUseAsAuthority: [
      ...new Set([
        ...existingRelativePaths(targetRoot, ["PRODUCT_THESIS.md"]),
        ...discoverDocs(targetRoot, (filePath) => filePath.includes("thesis")),
      ]),
    ],
  };
}

function inferOrientation(targetRoot) {
  const readBeforeBroadSearch = existingRelativePaths(targetRoot, [
    "docs/CODEBASE_MAP.md",
    "docs/ARCHITECTURE.md",
    "ARCHITECTURE.md",
    "README.md",
  ]);
  const sectionedDocs = [];

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
  }

  return {
    readFirst: ["AGENTS.md"],
    readBeforeBroadSearch,
    sectionedDocs,
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

    const authority = inferAuthority(targetRoot);
    const orientation = inferOrientation(targetRoot);
    const workflowRules = new Set([...authority.workflowRules, "AGENTS.md"]);

    return {
      ...template,
      name,
      description: `Apex Workflow profile for ${name}. Generated by the harness installer.`,
      authority: {
        ...authority,
        workflowRules: [...workflowRules],
      },
      orientation,
      tracker: makeTracker(args),
      codeIntelligence: inferCodeIntelligence(targetRoot, pkg, args),
      contracts: inferContracts(targetRoot),
      verification: inferVerification(targetRoot, pkg, args),
      uiUx: inferUiUx(targetRoot),
      manifest: template.manifest,
      setup: {
        generatedBy: "apex-workflow init-harness",
        configMode,
        apexRoot: APEX_ROOT,
        targetRoot,
        reviewNeeded: [
          ...(authority.productTruth.length === 0 ? ["No product truth doc was detected. Add one to authority.productTruth if the app has it."] : []),
          ...(orientation.readBeforeBroadSearch.length === 0 ? ["No broad-search orientation doc was detected. Consider adding a codebase map or architecture doc."] : []),
          ...(inferContracts(targetRoot).featureArtifacts.length === 0 && inferContracts(targetRoot).stateContracts.length === 0
            ? ["No contract directories were detected. Shared-surface work will rely on source search and surrogate docs."]
            : []),
        ],
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

function printSummary({ targetRoot, configPath, agentsResult, skillResult, dryRun }) {
  const prefix = dryRun ? "[apex-init] dry run complete" : "[apex-init] installed";
  console.log(prefix);
  console.log(`- target: ${targetRoot}`);
  console.log(`- profile: ${relative(targetRoot, configPath)}`);
  if (agentsResult.skipped) console.log("- AGENTS.md: skipped");
  else console.log(`- AGENTS.md: ${relative(targetRoot, agentsResult.path)}`);
  if (skillResult.skipped) console.log("- skill link: skipped");
  else console.log(`- skill link: ${skillResult.path}${skillResult.alreadyInstalled ? " (already installed)" : ""}`);
  console.log("- next: use $apex-workflow in the target repo and read apex.workflow.json before selecting a mode");
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
  const skillResult = installSkillLink(args);

  if (!args["dry-run"]) validateGeneratedConfig(targetRoot);
  printSummary({ targetRoot, configPath, agentsResult, skillResult, dryRun: Boolean(args["dry-run"]) });
}

main().catch((error) => {
  console.error(`[apex-init] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
