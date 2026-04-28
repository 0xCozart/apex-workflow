# Apex v0.2 Hardening Design

Source PRD: [Apex Workflow Hardening & Public Adoption](../prd-apex-hardening-v0.2.md)

## Goal

Make Apex Workflow publicly verifiable: a fresh clone can run checks, install into a demo target, complete a manifest lifecycle, and audit the result without maintainer-local paths or private repositories.

## Decision

Build v0.2 as a staged hardening pass around five durable contracts:

- Clean-room execution: default scripts, docs, examples, and CI use only repo-local fixtures or generated temp targets.
- Trust boundary: profiles and manifests are treated as trusted executable workflow configuration, with explicit docs and doctor warnings.
- Executable schema contract: JSON Schema becomes the first validation layer, with repo/path checks layered after it.
- Audit-grade evidence: manifest command records include logs, hashes, git metadata, command provenance, and freshness checks.
- Adoption loop: quickstart and demo smoke prove the full install, doctor, manifest, check, close, and finish path without external services.

The milestone should land in small PR-sized slices, starting with clean-room self-check and portability before deeper evidence and doctor upgrades.

## Current Gap

Apex already has the right control-plane shape: installer, profile, managed `AGENTS.md` block, doctor, manifest lifecycle, fixture tests, and skill instructions. The public-readiness gaps are operational rather than conceptual:

- `package.json` default checks still reference a maintainer-local private Minty target path.
- Shell execution is necessary but not visible enough as a trust boundary.
- `schemas/apex.workflow.schema.json` and `scripts/check-config.mjs` can drift.
- Manifest check records are not yet strong enough for audit or replay.
- There is no public CI workflow.
- First-time adoption requires stitching together README sections instead of following a short demo path.

There is also current dirty local work for the GitNexus freshness gate. That work aligns with R7/R9-adjacent workflow hardening, but it should be committed or deliberately folded into a later hardening slice before v0.2 execution starts.

## Relevant Contracts And Constraints

- `scripts/init-harness.mjs` owns target-repo install behavior and managed file updates.
- `scripts/check-config.mjs` owns profile validation and target path checks.
- `scripts/apex-doctor.mjs` owns readiness diagnostics.
- `scripts/apex-manifest.mjs` owns manifest creation, detect, check execution, evidence recording, close, and finish packets.
- `schemas/apex.workflow.schema.json` must become the executable profile contract.
- `scripts/test-installer-fixtures.mjs` is the regression harness and should become the hardening suite.
- `skills/apex-workflow/SKILL.md` must use portable commands and explain the trust model because agents follow it directly.
- `README.md`, `docs/adoption.md`, and new quickstart/trust docs must be self-contained for public users.
- Runtime should stay Node ESM and keep dependencies minimal; Ajv is acceptable if it is limited to config validation and pinned.
- v0.2 does not need npm publishing, command sandboxing, signed evidence, or broad new adapter support.

## Approaches Considered

### Approach A: One large v0.2 hardening branch

This would implement all R1-R11 in a single pass. It minimizes coordination overhead but makes review harder and mixes public-readiness, schema, evidence, docs, and doctor changes in one diff. It is too risky for a trust-focused milestone.

### Approach B: P0-first, then P1 reliability, then P2 polish

This follows the PRD rollout: clean-room portability, CI, trust model, and CLI entrypoints first; schema/evidence/preview/quickstart next; doctor scoring and project hygiene last. It gives fast public value and keeps each slice reviewable.

### Approach C: Evidence engine first

This would prioritize manifest logs, hashes, and freshness before CI/docs. It improves audit quality quickly but leaves the project unable to prove itself in a clean-room environment. That undermines the milestone promise.

## Recommended Architecture

Use Approach B.

### Public Verification Spine

`package.json` should expose a clean default path:

- `check:syntax`
- `check:config`
- `check:portability`
- `test:fixtures`
- `test:demo`
- `self-check`

`self-check` must use only repo-local fixtures and temp directories. Private app validation moves to guarded scripts such as `check:minty`, requiring `MINTY_TARGET`.

The config-validation target should be a dedicated repo-local fixture that already matches `profiles/service-desk.workflow.json`; do not point `check:config` at the current `no-adapters` install fixture unless the fixture first gains the required `AGENTS.md`, contract directories, and profile-compatible docs.

### Portable CLI Layer

Add `bin` entries for `apex-init`, `apex-doctor`, `apex-manifest`, and `apex-check-config`. README and skill docs should prefer those commands after `npm link`, with `npm run` examples retained for working inside the Apex repo. Automated smoke tests should not depend on a globally linked developer environment; use an isolated npm prefix, `npm pack` into a temp target, or direct local script invocation where the purpose is not bin-shim validation.

### Trust Model

Add `SECURITY.md` or `docs/trust-model.md`, linked before install instructions. Doctor should warn when a profile contains configured commands and should flag suspicious shell metacharacters outside approved command fields. The aim is clear trust disclosure, not sandboxing.

### Schema-Backed Validation

`check-config` should load `schemas/apex.workflow.schema.json` and validate the profile before target-repo checks. Ajv is the simplest implementation. The schema `$id` should become an Apex-owned identifier. JSON output should expose separate `schema` and `repoChecks` sections.

### Audit Evidence Engine

`apex-manifest` should upgrade run records to include command source, cwd, git head, working-tree fingerprint, owned-files fingerprint, stdout/stderr tail, log path, log hash, and timestamps. Logs should live under `tmp/apex-workflow/logs/<slug>/`. Close should detect stale required evidence unless `--allow-stale-evidence=<reason>` is provided and recorded.

### Command Execution Safeguards

Keep shell execution for compatibility, but record provenance and shell mode. Add `--preview-commands` for `close`, unresolved-placeholder rejection, detect-command placeholder validation, and `--require-approved-commands` as an explicit stricter mode.

### Demo Adoption Path

Add a tiny generated demo smoke script or fixture target. The quickstart should prove: clone, self-check, install into demo target, doctor, manifest new, detect, run-check, close, finish packet.

## Phasing

### Phase 0: Planning And Scope Lock

Store the PRD and this plan in repo docs. Decide whether the existing GitNexus freshness dirty work is committed before v0.2 or folded into R7/R9.

### Phase 1: P0 Public-Readiness Foundation

Implement R1-R4 and enough of R2/R3 to make a clean clone trustworthy.

### Phase 2: P1 Reliability Foundation

Implement R5-R9: schema validation, audit evidence, command preview/provenance, quickstart, demo smoke, and expanded fixtures.

### Phase 3: P2 Polish And Maintainer Experience

Implement R10-R11 plus optional cross-platform CI expansion.

## Risks And Edge Cases

- Evidence logging can leak secrets if tails or logs capture sensitive output. Mitigate with redaction, caps, and explicit docs.
- Ajv introduces dependency surface. Mitigate with minimal pinned dependency and fixture tests that prove value.
- Stale evidence checks may block legitimate workflows. Mitigate with explicit override reasons recorded in the manifest.
- Windows symlink and path behavior may break too early. Start with Linux CI and add cross-platform after path behavior is hardened.
- Command preview and allowlisting can become too strict. Keep preview lightweight and make allowlisting opt-in for v0.2.
- Current dirty GitNexus freshness work can confuse slice boundaries. Resolve it before starting P0 implementation.
- A portability scanner can accidentally fail on historical PRD/planning text that quotes forbidden private paths. Avoid storing literal maintainer-local path strings in public docs; describe them generically or place them only in intentional negative fixtures.
- CI can pass before dependency work and then break after Ajv lands if the workflow lacks an install step. Keep CI resilient by running `npm ci` when a lockfile exists, otherwise `npm install` or no install as appropriate.

## Success Criteria

- `npm run self-check` passes on a fresh clone and in Linux CI.
- No default public script or doc depends on maintainer-local paths.
- CI runs on `push` and `pull_request`.
- Trust model exists and is linked before install instructions.
- `check-config` performs schema validation before custom path checks.
- Demo smoke proves install, doctor, manifest lifecycle, check, close, and finish.
- Manifest run records include logs, hashes, git metadata, command provenance, and freshness state.
- Fixture suite covers the PRD hardening cases.
- README gives a first-time user a copy/pasteable path to success.
