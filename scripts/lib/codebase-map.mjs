export const DEFAULT_CODEBASE_MAP_PATH = "docs/CODEBASE_MAP.md";
export const GENERATED_START_MARKER = "<!-- apex-codebase-map:generated:start -->";
export const GENERATED_END_MARKER = "<!-- apex-codebase-map:generated:end -->";
export const REVIEW_NEEDED_PATTERN = /REVIEW NEEDED/i;
export const GENERATED_MAP_DRAFT_REVIEW_ITEM =
  "Generated docs/CODEBASE_MAP.md is draft; review it, remove REVIEW NEEDED markers, then run `apex-map-codebase --target=. --mark-reviewed --sync-profile`.";

export const REQUIRED_CODEBASE_MAP_SECTIONS = [
  "High-Level Layout",
  "Architecture Anchors",
  "Core Domains And Ownership Zones",
  "Routes, Commands, And Entry Points",
  "Data, State, Auth, And External Boundaries",
  "Frequent Edit Hotspots",
  "Risk And Coupling Areas",
  "Verification Path By Change Type",
  "Generated Or Ignored Paths",
  "Keeping This Map Current",
  "Map Evidence",
];

export function parseCodebaseMapStatus(text) {
  const match = /^Status:\s*([A-Za-z0-9_-]+)\s*$/im.exec(text);
  return match ? match[1].toLowerCase() : "legacy";
}

export function findReviewMarkers(text) {
  return text
    .split("\n")
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter((entry) => REVIEW_NEEDED_PATTERN.test(entry.text));
}

export function hasRequiredSection(text, section) {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{2,6}\\s+(?:\\d+[.)]\\s*)?${escaped}\\s*$`, "im").test(text);
}

export function findMissingRequiredSections(text) {
  return REQUIRED_CODEBASE_MAP_SECTIONS.filter((section) => !hasRequiredSection(text, section));
}

export function generatedMarkerBalance(text) {
  const startCount = countOccurrences(text, GENERATED_START_MARKER);
  const endCount = countOccurrences(text, GENERATED_END_MARKER);
  return {
    startCount,
    endCount,
    balanced: startCount === endCount,
  };
}

export function evaluateCodebaseMap(text, options = {}) {
  const errors = [];
  const warnings = [];

  if (!text || text.trim() === "") {
    errors.push("codebase map is empty");
    return {
      ok: false,
      status: "missing",
      errors,
      warnings,
      reviewMarkers: [],
      missingRequiredSections: REQUIRED_CODEBASE_MAP_SECTIONS,
      markerBalance: { startCount: 0, endCount: 0, balanced: true },
    };
  }

  const status = parseCodebaseMapStatus(text);
  const reviewMarkers = findReviewMarkers(text);
  const missingRequiredSections = findMissingRequiredSections(text);
  const markerBalance = generatedMarkerBalance(text);

  if (missingRequiredSections.length > 0) {
    errors.push(`missing required sections: ${missingRequiredSections.join(", ")}`);
  }

  if (!markerBalance.balanced) {
    errors.push(`generated section markers are unbalanced: ${markerBalance.startCount} start, ${markerBalance.endCount} end`);
  }

  if (status === "legacy") {
    warnings.push("map has no Apex status line; treat as legacy/unverified");
  } else if (status === "draft") {
    warnings.push("map status is draft; use as scaffold, not authority");
  } else if (status === "reviewed") {
    if (reviewMarkers.length > 0) {
      errors.push(`reviewed map still contains REVIEW NEEDED markers: ${reviewMarkers.length}`);
    }
  } else {
    warnings.push(`map has unknown status: ${status}`);
  }

  if (options.requireReviewed && status !== "reviewed") {
    errors.push("map must have Status: reviewed");
  }

  return {
    ok: errors.length === 0,
    status,
    errors,
    warnings,
    reviewMarkers,
    missingRequiredSections,
    markerBalance,
  };
}

export function setCodebaseMapReviewed(text) {
  const statusPattern = /^Status:\s*.*$/im;
  const reviewedAt = `Reviewed at: ${new Date().toISOString()}`;
  const withReviewedAt = /^Reviewed at:\s*.*$/im.test(text)
    ? text.replace(/^Reviewed at:\s*.*$/im, reviewedAt)
    : text.replace(/^Status:\s*.*$/im, (match) => `${match}\n${reviewedAt}`);
  if (statusPattern.test(text)) {
    return withReviewedAt.replace(statusPattern, "Status: reviewed");
  }

  const h1Pattern = /^#\s+Codebase Map\s*$/im;
  if (h1Pattern.test(text)) {
    return text.replace(h1Pattern, (match) => `${match}\n\nStatus: reviewed\n${reviewedAt}`);
  }

  return `# Codebase Map\n\nStatus: reviewed\n${reviewedAt}\n\n${text}`;
}

function countOccurrences(text, pattern) {
  let count = 0;
  let index = text.indexOf(pattern);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(pattern, index + pattern.length);
  }
  return count;
}
