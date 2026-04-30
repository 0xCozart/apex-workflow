# PRD: Apex Workflow Hardening & Public Adoption

Product: Apex Workflow Milestone: v0.2 Hardening Status: Draft Date: 2026-04-28 Owner: 0xCozart Primary audience: Apex
maintainers, workflow adopters, coding agents using the Apex skill, and reviewers validating agent output.

## 1. Executive Summary

Apex Workflow already has the right foundation: a repo-native control plane, an app-specific workflow profile,
manifest-driven slice discipline, mode selection, adapter routing, verification gates, and handoff packets. The v0.2
hardening milestone turns Apex from an extracted internal harness into a clean-room, trustworthy, reusable open-source
tool.

The blunt promise:

> A new user can clone Apex, run its checks, install it into a demo repo, understand the trust model, and audit a
> completed agent slice without relying on the maintainer's local machine or private target repo.

## 2. Problem Statement

Public readiness is held back by hardening gaps:

- Clean-room execution is not guaranteed. Default scripts must not depend on maintainer-local private target paths.
- The trust boundary is implicit. Profiles and manifests can cause shell commands to run, so they must be documented as
  trusted local workflow configuration.
- Validation has two sources of truth. The JSON Schema and script-level profile checks can diverge without schema-backed
  validation and drift tests.
- Evidence is not audit-grade yet. Manifest check records should prove what ran, when it ran, where it ran, and whether
  evidence is fresh relative to the working tree.
- CI proof is missing or not visible. Apex needs automated public checks on push and pull request.
- Adoption is too implicit. A first-time user needs a tight first-10-minutes path with a demo target repository.

## 3. Goals

- G1. Clean-room portability: Apex passes default verification on a fresh clone with no private filesystem paths,
  private target app, or hidden workstation assumptions.
- G2. Public CI confidence: CI validates syntax, installer fixtures, schema/profile validation, manifest lifecycle, and
  demo installation.
- G3. Explicit trust and safety model: Profiles, manifests, and configured checks are clearly documented as trusted
  executable configuration.
- G4. Executable profile contract: `apex.workflow.json` is validated against the JSON Schema first, with repo/path
  checks layered after.
- G5. Audit-ready evidence: Manifest runs record command evidence with enough metadata for review, handoff, and
  replay-oriented debugging.
- G6. First-time adopter success: A new user can install Apex into a small demo repo, run the doctor, open a manifest,
  run a check, close a slice, and understand the finish packet.

## 4. Non-Goals

- Publishing Apex to npm in this milestone.
- Replacing all agent behavior with rigid automation.
- Building a full sandbox for arbitrary shell commands.
- Supporting every tracker or code-intelligence provider.
- Turning manifests into signed compliance artifacts.

## 5. Personas

- P1. Apex maintainer: wants fast confidence that install, doctor, validation, manifest lifecycle, and skill
  instructions still work.
- P2. Target-repo owner: wants to install Apex without private assumptions and understand exactly what Apex changes.
- P3. Coding agent: needs portable commands, mode-selection rules, manifest discipline, declared scope, required checks,
  and finish-packet expectations.
- P4. Reviewer/operator: needs to inspect changed files, checks, failures, skips, and evidence freshness.
- P5. Security-conscious adopter: needs a clear trust model explaining that profiles and manifests can execute
  configured commands.

## 6. Success Metrics

Release-blocking metrics:

- `npm run self-check` passes on a fresh clone on Linux CI.
- Public verification scripts and docs have no dependency on maintainer-local private paths.
- CI runs on `push` and `pull_request`.
- At least one no-adapter demo install passes `init`, `doctor`, manifest `new`, `detect`, `run-check`, `close`, and
  `finish`.
- `check-config` validates profiles through the JSON Schema before custom path checks.
- `SECURITY.md` or equivalent trust-model documentation exists.
- Manifest check records include log path, stdout/stderr tail or artifact link, cwd, git head, working-tree fingerprint,
  exit code, start/end time, duration, and command source.

Quality metrics:

- Fixture suite covers no adapters, GitNexus MCP preference, GitNexus wrapper fallback, Linear configuration,
  reconciliation dirty policy, managed `AGENTS.md` idempotence, path-casing mismatch, dry-run no writes, schema-invalid
  profile, and malicious/untrusted-profile documentation behavior.
- The quickstart can be completed using only the public repo and a temporary demo target.
- All Apex command examples in README and skill docs use portable invocations.

## 7. Current Baseline

Apex presents itself as a repo-native control plane for Codex and LLM coding agents, with an installed target-app
profile, mode/state machine, manifests, verification, and handoff behavior. Current core files include:

- `scripts/init-harness.mjs`
- `scripts/check-config.mjs`
- `scripts/apex-doctor.mjs`
- `scripts/apex-manifest.mjs`
- `skills/apex-workflow/SKILL.md`
- `schemas/apex.workflow.schema.json`
- `scripts/test-installer-fixtures.mjs`

Known hardening findings:

- `package.json` includes hard-coded private target assumptions in default verification scripts.
- `apex-manifest.mjs` supports `new`, `check`, `files`, `detect`, `run-check`, `record-check`, `record-evidence`,
  `close`, `summary`, and `finish`.
- `apex-manifest.mjs` executes some commands through the shell.
- `close` performs manifest validation, detect, required checks, `git diff --check`, and finish-packet generation.
- The schema uses JSON Schema draft 2020-12 and defines required top-level profile sections.
- Fixture tests already cover several installer cases, including dry-run no writes, path-casing mismatch, managed block
  idempotence, and GitNexus mode choices.

## 8. Product Requirements

### R1. Remove local path assumptions

Priority: P0

Requirements:

- Replace private target references with repo-local fixtures or generated demo targets.
- `npm run self-check` must not require any path outside the Apex repo except temporary directories created during the
  test.
- Add an optional private/local profile validation script guarded by an environment variable.
- Update README and skill docs so examples do not contain maintainer-local paths.
- Add a repository scan check for forbidden absolute path patterns.

Acceptance criteria:

- Fresh clone plus `npm run self-check` exits `0`.
- `npm run check:config` validates a repo-local sample profile against a repo-local fixture target.
- No public verification script references maintainer-local private paths.
- CI fails if forbidden absolute path patterns are introduced in scripts, docs, profiles, templates, or skill files.

### R2. Add portable CLI entrypoints

Priority: P0

Requirements:

- Add `bin` entries for the main commands: `apex-init`, `apex-doctor`, `apex-manifest`, and `apex-check-config`.
- Keep `npm run` commands as fallback.
- Update the skill to prefer portable commands.
- Ensure executable scripts have shebangs where needed.
- Ensure commands work through isolated local development linking or package installation.

### R3. Add CI baseline

Priority: P0

Requirements:

- Add `.github/workflows/ci.yml`.
- Run on `push` and `pull_request`.
- Use Linux initially.
- Run syntax checks, portability scan, config validation, fixture tests, and a demo manifest lifecycle.
- Require no secrets.

### R4. Publish a trust model and security note

Priority: P0

Requirements:

- Add `SECURITY.md` or `docs/trust-model.md`.
- State that Apex profiles and manifests are trusted executable workflow configuration.
- Document command-running surfaces: `run-check`, `close`, wrapper fallback commands, and detect commands.
- Tell users not to run untrusted profiles, manifests, or generated commands without review.
- Document installer writes: `apex.workflow.json`, managed `AGENTS.md`, `.gitignore`, and skill link or install
  behavior.
- Recommend `--dry-run` before installing into unfamiliar repos.
- State that secrets should never be stored in profiles, manifests, logs, or finish packets.
- Link the trust model before install instructions.

### R5. Make JSON Schema the executable contract

Priority: P1

Requirements:

- Add a JSON Schema validator, preferably Ajv.
- `check-config` validates `apex.workflow.json` against `schemas/apex.workflow.schema.json` before repo checks.
- Keep custom repo checks for path existence, path casing, guessed path confidence, and required docs/checks.
- Add `--format=json` output for machine-readable doctor/check results.
- Replace the schema `$id` placeholder with a canonical Apex identifier.

### R6. Upgrade manifest evidence quality

Priority: P1

For every `run-check`, `record-check`, auto-required check, detect command, and diff check, record:

- `id`
- `command`
- `commandSource`
- `status`
- `exitCode`
- `startedAt`
- `finishedAt`
- `durationMs`
- `cwd`
- `gitHead`
- `gitStatusFingerprint`
- `ownedFilesFingerprint`
- `stdoutTail`
- `stderrTail`
- `logPath`
- `logSha256`
- `note`

Logs should live under `tmp/apex-workflow/logs/<slug>/`, use repo-relative paths, cap tails, redact common secret-like
values, and require manual notes when transcripts cannot be captured.

Close should warn or fail when required evidence is stale relative to the current manifest-relevant working tree, with
an explicit `--allow-stale-evidence=<reason>` override.

### R7. Improve command execution safeguards

Priority: P1

Requirements:

- Keep shell execution for compatibility, but record provenance and shell mode.
- Add `--preview-commands` for `close`.
- Add `--require-approved-commands`.
- Reject commands with unresolved placeholders.
- Validate `{changedFilesFile}` rendering for detect commands.

### R8. Add first-10-minutes quickstart

Priority: P1

Requirements:

- Add `docs/quickstart.md`.
- Cover clone, self-check, demo target creation, install, doctor, manifest creation, detect, demo check, close, and
  finish packet.
- Keep the flow no-tracker, focused-search, no-browser, no external accounts, and no private app.
- Run the quickstart path in CI through `npm run test:demo`.

### R9. Expand fixture coverage into a hardening suite

Priority: P1

Fixture coverage should include:

- Clean-room self-check.
- Invalid schema profile.
- Missing required top-level profile section.
- Stale evidence detection.
- Log hash verification.
- Command preview mode.
- Unresolved detect placeholder failure.
- No private path leakage.
- Doctor trust-model warning coverage.
- README and skill portable command examples.

### R10. Improve doctor output and readiness scoring

Priority: P2

Requirements:

- Add output categories: `blocking`, `warning`, and `info`.
- Add readiness summary: `readyForFirstSlice`, `safeMode`, and `recommendedNextAction`.
- Add `--format=json`.
- Include trust-model warning if commands are present.
- Include explicit adapter readiness status.

### R11. Add release and contribution basics

Priority: P2

Requirements:

- Add `LICENSE`.
- Add `CONTRIBUTING.md`.
- Add `CHANGELOG.md`.
- Add README badge for CI.
- Add release checklist covering self-check, fixtures, demo smoke, docs, schema version, and trust model.

## 9. UX Requirements

- Commands should be copy/pasteable from the target repo.
- Error messages should say what failed, why it matters, and what to do next.
- Dangerous operations should have preview or dry-run paths.
- Agents should not need private machine paths.
- Human-readable and JSON output should both be available for doctor/check commands.

## 10. Technical Requirements

- Node ESM remains supported.
- Prefer no runtime dependencies unless required.
- Ajv may be added for `check-config`.
- Add or modify CI, trust docs, quickstart docs, portability/demo scripts, config/doctor/manifest scripts, fixtures,
  package scripts, README, skill docs, and schema files.
- Manifest evidence additions must be backward-compatible.

## 11. Rollout Plan

Phase 0: PRD and issue decomposition.

Phase 1: P0 public-readiness foundation:

- Remove private paths from default scripts/docs.
- Add portable command examples.
- Add CI.
- Add trust model.
- Ensure fresh-clone self-check passes.

Phase 2: P1 reliability foundation:

- Schema-backed validation.
- Evidence logs and hashes.
- Evidence freshness check.
- Command preview/provenance.
- Demo quickstart.
- Expanded fixture suite.

Phase 3: P2 polish and maintainability:

- Doctor JSON output and readiness scoring.
- License/contribution/release docs.
- Cross-platform CI matrix.
- README polish and CI badge.

## 12. Risk Register

- More process makes Apex feel heavy. Keep tiny and no-adapter quickstart paths lightweight.
- Ajv adds dependency surface. Keep it minimal and tested.
- Capturing stdout/stderr may leak secrets. Cap output, redact common secret patterns, and document log retention.
- Windows path behavior may break CLI or fixtures. Start CI on Linux and expand after path behavior is hardened.
- Evidence freshness may block legitimate work. Provide clear errors and explicit override reasons.

## 13. Open Questions

- Should Apex remain `private: true` indefinitely, or should v0.3 publish a package?
- Should command allowlisting become default-on for `close`, or remain opt-in?
- Should manifests have a formal JSON Schema separate from the workflow profile schema?
- Should log hashes and git fingerprints be enough, or should later versions support signed evidence?
- Should the Codex skill be symlinked only, or should Apex support copying and version-pinning the skill into target
  repos?
- Should `doctor` refuse the first slice when the trust model has not been acknowledged, or only warn?

## 14. Definition Of Done For v0.2

Apex v0.2 is done when:

- A fresh clone passes `npm run self-check` on CI.
- Default scripts and docs have no private path dependency.
- CI runs on push and pull request.
- Trust model is documented and linked before installation instructions.
- `check-config` uses the JSON Schema as the first validation layer.
- Manifest evidence includes logs, hashes, git metadata, and freshness checks.
- Quickstart demo completes without external services.
- Fixture suite covers the hardening behaviors listed above.
- README explains install, doctor, manifest lifecycle, finish packet, trust model, and self-check in a
  first-time-user-friendly order.
