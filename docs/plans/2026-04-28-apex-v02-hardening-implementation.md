# Apex v0.2 Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Apex Workflow clean-room runnable, publicly verifiable, trust-explicit, schema-backed, audit-ready, and easy to adopt through a demo quickstart.

**Architecture:** Implement v0.2 as phased hardening slices. Start with clean-room scripts and portability checks, then add CI and trust docs, then schema validation, evidence logging, command safeguards, demo smoke, expanded fixtures, doctor readiness, and project hygiene. Keep each slice independently verifiable and commit-sized.

**Tech Stack:** Node ESM scripts, npm package scripts, JSON Schema draft 2020-12, Ajv for schema validation, GitHub Actions, git fixture repos, Markdown docs.

---

## Pre-Flight: Reconcile Existing Dirty Work

**Files:**
- Inspect: `scripts/apex-manifest.mjs`
- Inspect: `scripts/init-harness.mjs`
- Inspect: `scripts/test-installer-fixtures.mjs`
- Inspect: `profiles/minty.workflow.json`
- Inspect: `profiles/service-desk.workflow.json`
- Inspect: `templates/apex.workflow.json`
- Inspect: `schemas/apex.workflow.schema.json`
- Inspect: `README.md`
- Inspect: `docs/adoption.md`
- Inspect: `skills/apex-workflow/SKILL.md`

**Steps:**

1. Run `git status --short --branch`.
2. Decide whether the current GitNexus freshness-gate dirty work is already complete enough to commit as its own hardening slice.
3. If keeping it, rerun `npm run self-check` and `git diff --check`.
4. Commit it separately before starting R1, or explicitly document it as folded into the command/evidence hardening slice.

**Expected:** The v0.2 implementation starts from a clear baseline or a consciously documented dirty baseline.

---

## Task 0: Store The PRD And Planning Artifacts

**Requirements:** Phase 0

**Files:**
- Create: `docs/prd-apex-hardening-v0.2.md`
- Keep: `docs/plans/2026-04-28-apex-v02-hardening-design.md`
- Keep: `docs/plans/2026-04-28-apex-v02-hardening-implementation.md`

**Steps:**

1. Save the PRD as `docs/prd-apex-hardening-v0.2.md`, preserving the product requirements while generalizing maintainer-local absolute paths so the future portability scan does not fail on its own requirements document.
2. Verify the PRD and planning docs do not contain maintainer-local absolute path strings outside intentional negative fixtures.
3. Link the PRD from the design doc or README only after the document is committed.
4. Run `git diff --check` against the docs.

**Verification:**

Run:

```bash
git diff --check -- docs/prd-apex-hardening-v0.2.md docs/plans/2026-04-28-apex-v02-hardening-design.md docs/plans/2026-04-28-apex-v02-hardening-implementation.md
```

**Commit:**

```bash
git add docs/prd-apex-hardening-v0.2.md docs/plans/2026-04-28-apex-v02-hardening-design.md docs/plans/2026-04-28-apex-v02-hardening-implementation.md
git commit -m "docs: plan Apex v0.2 hardening"
```

---

## Task 1: Make Default Checks Clean-Room Runnable

**Requirements:** R1, G1

**Files:**
- Modify: `package.json`
- Create: `scripts/check-portability.mjs`
- Create: `fixtures/config/service-desk/AGENTS.md`
- Create: `fixtures/config/service-desk/PRODUCT.md`
- Create: `fixtures/config/service-desk/README.md`
- Create: `fixtures/config/service-desk/docs/feature-artifacts/.gitkeep`
- Create: `fixtures/config/service-desk/docs/state-contracts/.gitkeep`
- Create: `fixtures/config/service-desk/package.json`
- Modify: `scripts/test-installer-fixtures.mjs`
- Modify: `README.md`
- Modify: `skills/apex-workflow/SKILL.md`

**Steps:**

1. Update `package.json` scripts:
   - `check:syntax`: `node --check` all Apex scripts.
   - `check:config`: validate `profiles/service-desk.workflow.json` against `fixtures/config/service-desk`.
   - `check:portability`: run `node scripts/check-portability.mjs`.
   - `self-check`: `npm run check:syntax && npm run check:portability && npm run check:config && npm run test:fixtures`.
   - `check:minty`: guarded private check that requires `MINTY_TARGET`.
2. Create `fixtures/config/service-desk` so it exactly satisfies `profiles/service-desk.workflow.json`. Do not reuse the current `fixtures/installer/no-adapters` fixture directly because it does not start with `AGENTS.md` and is intended to test installer output, not static profile validation.
3. Write `scripts/check-portability.mjs` to scan scripts, docs, profiles, templates, schemas, and skills for forbidden private path patterns. Keep the pattern definitions generic enough that this plan and PRD do not have to quote the forbidden paths outside intentional negative fixtures.
4. Allow explicit negative fixture paths only under an intentionally named directory such as `fixtures/negative/private-paths`.
5. Add a fixture assertion that `npm run self-check` does not rely on paths outside the repo except temp directories.
6. Replace public docs examples that use maintainer-local script paths with `npm run` or future `apex-*` forms.

**Verification:**

Run:

```bash
npm run check:syntax
npm run check:portability
npm run check:config
npm run self-check
git diff --check
```

**Commit:**

```bash
git add package.json scripts/check-portability.mjs fixtures/config/service-desk scripts/test-installer-fixtures.mjs README.md skills/apex-workflow/SKILL.md
git commit -m "hardening: make self-check clean-room runnable"
```

---

## Task 2: Add Portable CLI Entrypoints

**Requirements:** R2, UX Requirements

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/adoption.md`
- Modify: `skills/apex-workflow/SKILL.md`
- Modify: `scripts/test-installer-fixtures.mjs`

**Steps:**

1. Add `bin` entries:
   - `apex-init`: `scripts/init-harness.mjs`
   - `apex-doctor`: `scripts/apex-doctor.mjs`
   - `apex-manifest`: `scripts/apex-manifest.mjs`
   - `apex-check-config`: `scripts/check-config.mjs`
2. Ensure all target scripts have shebangs and executable permissions.
3. Add a fixture that proves bin shims without polluting the developer's global npm state. Prefer installing an `npm pack` tarball into a temp target, or use an isolated npm prefix for `npm link`.
4. Verify these commands from a temp target repo:
   - `apex-init --target=. --config-mode=custom --tracker=none --code-intelligence=focused-search --browser=none --yes`
   - `apex-doctor --target=. --config=apex.workflow.json`
   - `apex-manifest new ...`
   - `apex-check-config --config=apex.workflow.json --target=.`
5. Update docs to prefer `apex-*` commands for target repos and `npm run` commands inside the Apex repo.
6. Keep `scripts/demo-smoke.mjs` free of global-link assumptions; the demo smoke can call local scripts directly unless the task is explicitly testing bin shims.

**Verification:**

Run:

```bash
npm run test:fixtures
npm run self-check
```

**Commit:**

```bash
git add package.json README.md docs/adoption.md skills/apex-workflow/SKILL.md scripts/test-installer-fixtures.mjs
git commit -m "hardening: add portable CLI entrypoints"
```

---

## Task 3: Add Public CI

**Requirements:** R3, G2

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`

**Steps:**

1. Add GitHub Actions workflow on `push` and `pull_request`.
2. Use `actions/checkout@v4` and `actions/setup-node@v4`.
3. Start with `node-version: 22` on `ubuntu-latest`.
4. Add an install step that works both before and after dependencies land:
   - run `npm ci` when `package-lock.json` exists
   - otherwise run `npm install --ignore-scripts` only if dependencies exist, or skip install if the package remains dependency-free
5. Run `npm run self-check`.
6. Add README CI badge after workflow is committed and repository path is confirmed.
7. Keep secrets out of the workflow.

**Verification:**

Run locally:

```bash
npm run self-check
```

After push, verify GitHub Actions runs against the commit.

**Commit:**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "hardening: add CI baseline"
```

---

## Task 4: Publish Trust Model And Doctor Warning

**Requirements:** R4, G3

**Files:**
- Create: `SECURITY.md`
- Optionally create: `docs/trust-model.md`
- Modify: `README.md`
- Modify: `skills/apex-workflow/SKILL.md`
- Modify: `scripts/apex-doctor.mjs`
- Modify: `scripts/test-installer-fixtures.mjs`

**Steps:**

1. Write trust model:
   - Profiles and manifests are trusted executable workflow config.
   - `run-check`, `close`, wrapper fallback commands, and detect commands may execute shell commands.
   - Do not run untrusted profiles, manifests, or repos without review.
   - Installer writes `apex.workflow.json`, updates `AGENTS.md`, updates `.gitignore`, and symlinks the skill.
   - Use `--dry-run` before unfamiliar installs.
   - Do not store secrets in profiles, manifests, logs, or finish packets.
   - Logs redact common secret-like values.
2. Link the trust model before README install instructions.
3. Update the skill to instruct agents to treat profiles and manifests as trusted config.
4. Add doctor warning when configured commands exist in a profile.
5. Add doctor suspicious-command checks for shell metacharacters outside approved command fields.
6. Add fixture tests for trust model file existence, README link, and doctor warning coverage.
7. If only `SECURITY.md` is created, do not include `docs/trust-model.md` in `git add`; if both are created, link them deliberately.

**Verification:**

Run:

```bash
npm run test:fixtures
npm run self-check
```

**Commit:**

```bash
git add SECURITY.md README.md skills/apex-workflow/SKILL.md scripts/apex-doctor.mjs scripts/test-installer-fixtures.mjs
git commit -m "hardening: document executable trust model"
```

---

## Task 5: Make JSON Schema The First Validation Layer

**Requirements:** R5, G4

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` if created
- Modify: `schemas/apex.workflow.schema.json`
- Modify: `scripts/check-config.mjs`
- Modify: `scripts/test-installer-fixtures.mjs`
- Add fixtures under: `fixtures/installer/schema-invalid-*`

**Steps:**

1. Add Ajv as a dependency or dev dependency and commit the lockfile if npm creates one.
2. Replace schema `$id` placeholder with a canonical Apex identifier.
3. In `check-config`, load the schema and validate the config before repo/path checks.
4. Keep path existence, path casing, setup review, and command checks as second-pass repo checks.
5. Add `--format=json` output:
   - `ok`
   - `schema.ok`
   - `schema.errors`
   - `repoChecks.ok`
   - `repoChecks.errors`
   - `repoChecks.warnings`
6. Ensure human output remains concise.
7. Add invalid profile fixtures:
   - missing required top-level section
   - invalid provider enum
   - wrong type for required array
8. Verify schema failures happen before path checks.

**Verification:**

Run:

```bash
npm run check:config
npm run test:fixtures
node scripts/check-config.mjs --config=fixtures/installer/schema-invalid-missing-section/apex.workflow.json --target=fixtures/installer/schema-invalid-missing-section --format=json
```

**Commit:**

```bash
git add package.json schemas/apex.workflow.schema.json scripts/check-config.mjs scripts/test-installer-fixtures.mjs fixtures/installer
# Also git add package-lock.json if npm created or modified it.
git commit -m "hardening: validate profiles with JSON Schema"
```

---

## Task 6: Upgrade Manifest Evidence Records

**Requirements:** R6, G5

**Files:**
- Modify: `scripts/apex-manifest.mjs`
- Modify: `scripts/test-installer-fixtures.mjs`
- Modify: `README.md`
- Modify: `skills/apex-workflow/references/configuration.md`
- Optionally create: `schemas/apex.manifest.schema.json`

**Steps:**

1. Add run IDs, for example `run-YYYYMMDDTHHMMSSmmm-<short-random>`.
2. Add command source values:
   - `manifest-required`
   - `manual-run-check`
   - `manual-record-check`
   - `close-required`
   - `close-diff`
   - `detect-command`
3. Capture command output for `run-check`, close-required checks, detect commands, and diff checks.
4. Write logs under `tmp/apex-workflow/logs/<slug>/<run-id>.log`.
5. Store relative `logPath`, `logSha256`, `stdoutTail`, and `stderrTail`.
6. Record `cwd`, `gitHead`, `gitStatusFingerprint`, and `ownedFilesFingerprint`.
7. Redact common secret-like values from logs and tails.
8. Preserve behavior for inherited stdio by recording that transcript capture was unavailable and requiring a manual note.
9. Add stale evidence detection:
   - required checks recorded before current manifest-relevant fingerprint cause close to fail.
   - `--allow-stale-evidence=<reason>` records an override.
10. Update finish packet and docs to explain evidence.

**Verification:**

Run:

```bash
npm run test:fixtures
npm run self-check
```

Add fixture assertions:

- `logSha256` matches the written log.
- stdout/stderr tails are capped.
- stale required evidence fails close.
- stale evidence override succeeds and records the reason.

**Commit:**

```bash
git add scripts/apex-manifest.mjs scripts/test-installer-fixtures.mjs README.md skills/apex-workflow/references/configuration.md schemas
git commit -m "hardening: record audit-grade manifest evidence"
```

---

## Task 7: Add Command Preview And Execution Safeguards

**Requirements:** R7

**Files:**
- Modify: `scripts/apex-manifest.mjs`
- Modify: `scripts/test-installer-fixtures.mjs`
- Modify: `README.md`
- Modify: `skills/apex-workflow/references/configuration.md`
- Modify: `skills/apex-workflow/references/code-intelligence.md`

**Steps:**

1. Add `apex-manifest close --preview-commands`.
2. Preview output should list:
   - detect command
   - required checks
   - diff check
   - command source
   - whether shell mode is used
3. Exit without running commands.
4. Add `--require-approved-commands`.
5. Reject unresolved placeholders in commands before execution.
6. Validate detect commands using `{changedFilesFile}` render checks.
7. Record command provenance and shell mode in run records.
8. Add fixtures:
   - preview exits 0 and does not append runs.
   - unresolved placeholder fails.
   - approved-command mode rejects undeclared command.

**Verification:**

Run:

```bash
npm run test:fixtures
npm run self-check
```

**Commit:**

```bash
git add scripts/apex-manifest.mjs scripts/test-installer-fixtures.mjs README.md skills/apex-workflow/references/configuration.md skills/apex-workflow/references/code-intelligence.md
git commit -m "hardening: add command preview and provenance"
```

---

## Task 8: Add Quickstart And Demo Smoke

**Requirements:** R8, G6

**Files:**
- Create: `docs/quickstart.md`
- Create: `scripts/demo-smoke.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `scripts/test-installer-fixtures.mjs` if shared helpers are useful

**Steps:**

1. Implement `scripts/demo-smoke.mjs`:
   - create temp target repo
   - write tiny `package.json` with `test: node --version`
   - write `PRODUCT.md` and `README.md`
   - run local `scripts/init-harness.mjs`, or run `apex-init` only when the script first installs the package into an isolated temp prefix
   - run local `scripts/apex-doctor.mjs`
   - use local `scripts/apex-manifest.mjs` for manifest `new`, `detect`, `run-check`, `close`, and `finish`
   - print finish packet location or output
2. Add `test:demo`: `node scripts/demo-smoke.mjs`.
3. Add `test:demo` to `self-check` after the demo is stable.
4. Write `docs/quickstart.md` as a 10-minute copy/paste path.
5. Add README short quickstart linking to the full doc.
6. Ensure no Linear, GitNexus, browser automation, MCP, or private repo is required.

**Verification:**

Run:

```bash
npm run test:demo
npm run self-check
```

**Commit:**

```bash
git add docs/quickstart.md scripts/demo-smoke.mjs package.json README.md scripts/test-installer-fixtures.mjs
git commit -m "hardening: add quickstart demo smoke"
```

---

## Task 9: Expand Fixture Suite Into Hardening Harness

**Requirements:** R9

**Files:**
- Modify: `scripts/test-installer-fixtures.mjs`
- Add fixtures under: `fixtures/installer/*`
- Modify: `package.json` if new fixture scripts are split

**Steps:**

1. Add named fixture sections with clear scenario labels.
2. Preserve temp directories when `APEX_KEEP_FIXTURES=1`.
3. Add coverage for:
   - clean-room self-check
   - invalid schema profile
   - missing required top-level section
   - stale evidence detection
   - log hash verification
   - command preview mode
   - unresolved detect placeholder failure
   - no private path leakage
   - doctor trust-model warning
   - README/skill portable examples
4. Improve failure output to print scenario name, command, stdout, and stderr.

**Verification:**

Run:

```bash
npm run test:fixtures
APEX_KEEP_FIXTURES=1 npm run test:fixtures
```

**Commit:**

```bash
git add scripts/test-installer-fixtures.mjs fixtures/installer package.json
git commit -m "hardening: expand fixture regression suite"
```

---

## Task 10: Add Doctor JSON Output And Readiness Scoring

**Requirements:** R10

**Files:**
- Modify: `scripts/apex-doctor.mjs`
- Modify: `scripts/test-installer-fixtures.mjs`
- Modify: `README.md`
- Modify: `docs/adoption.md`

**Steps:**

1. Add categories:
   - `blocking`
   - `warning`
   - `info`
2. Add readiness summary:
   - `readyForFirstSlice`
   - `safeMode`
   - `recommendedNextAction`
3. Add `--format=json`.
4. Include trust-model warning when commands are present.
5. Include adapter readiness status.
6. Add ready and not-ready target fixtures.
7. Snapshot key JSON shape in fixture assertions, not exact unstable text.

**Verification:**

Run:

```bash
tmp="$(mktemp -d)"
cp -R fixtures/installer/no-adapters "$tmp/target"
node scripts/init-harness.mjs --target="$tmp/target" --config-mode=custom --tracker=none --code-intelligence=focused-search --browser=none --yes --skip-skill-link
node scripts/apex-doctor.mjs --target="$tmp/target" --config=apex.workflow.json --format=json
npm run test:fixtures
npm run self-check
```

Do not point doctor JSON examples directly at a pre-install fixture that lacks `apex.workflow.json`; always install into a temp target first.

**Commit:**

```bash
git add scripts/apex-doctor.mjs scripts/test-installer-fixtures.mjs README.md docs/adoption.md
git commit -m "hardening: add doctor readiness output"
```

---

## Task 11: Add Release And Contribution Basics

**Requirements:** R11

**Files:**
- Create: `LICENSE`
- Create: `CONTRIBUTING.md`
- Create: `CHANGELOG.md`
- Create: `docs/release-checklist.md`
- Modify: `README.md`
- Modify: `package.json` if version metadata changes

**Steps:**

1. Confirm license choice with maintainer before writing `LICENSE`.
2. Add `CONTRIBUTING.md` with setup, checks, fixture guidance, and PR expectations.
3. Add `CHANGELOG.md` with an `Unreleased` section.
4. Add `docs/release-checklist.md`:
   - self-check green
   - fixture suite green
   - quickstart smoke green
   - docs updated
   - schema version reviewed
   - trust model reviewed
5. Add README project hygiene links and CI badge.

**Verification:**

Run:

```bash
npm run self-check
```

**Commit:**

```bash
git add LICENSE CONTRIBUTING.md CHANGELOG.md docs/release-checklist.md README.md package.json
git commit -m "docs: add release and contribution basics"
```

---

## Finalization

**Verification before v0.2 closeout:**

```bash
npm run self-check
npm run test:demo
npm run check:portability
git diff --check
```

**Manual review checklist:**

- README quickstart works from a clean clone.
- `SECURITY.md` or trust model is linked before install instructions.
- `self-check` has no private path dependency.
- CI is green on `main`.
- Fixture failures print enough context to debug.
- Manifest logs redact obvious secret-like values.
- Stale evidence failure and override behavior are understandable.

**Release closeout:**

1. Update `CHANGELOG.md`.
2. Run the release checklist.
3. Tag v0.2 only after CI is green.
4. Do not publish to npm in this milestone unless the open question is explicitly resolved.
