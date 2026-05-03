# Codebase Map

Status: reviewed Reviewed at: 2026-04-30T00:00:00.000Z

## High-Level Layout

- `.github/workflows/ci.yml`: public verification workflow.
- `scripts/`: Node ESM CLI control plane.
- `scripts/lib/`: shared helpers used by CLI scripts.
- `schemas/`: Apex workflow profile and slice manifest schemas.
- `benchmarks/`: no-service workflow benchmark scenarios and metric thresholds.
- `templates/`: default target-repo profile template.
- `profiles/`: example and extracted profiles used for validation.
- `fixtures/`: config and installer regression targets.
- `skills/apex-workflow/`: Codex skill installed into target environments.
- `docs/`: adoption, quickstart, extraction, and plan documents.

## Architecture Anchors

- `scripts/init-harness.mjs` owns target-repo installation.
- `scripts/check-config.mjs` owns schema and target path validation.
- `scripts/apex-doctor.mjs` owns readiness checks.
- `scripts/apex-manifest.mjs` owns slice manifests, evidence, close, and finish packets.
- `scripts/bench-workflow.mjs` owns workflow outcome benchmarks.
- `scripts/apex-map-codebase.mjs` owns generated codebase-map scaffolds.
- `scripts/test-installer-fixtures.mjs` is the broad fixture harness for control-plane behavior.

## Core Domains And Ownership Zones

- Installer domain: profile inference, managed `AGENTS.md`, managed `.gitignore`, codebase map handoff, skill linking.
- Manifest domain: slice scope, dirty-file detection, verification evidence, GitNexus freshness, finish packets.
- Validation domain: JSON schemas, exact target path checks, portability scanning.
- Security and benchmark domain: supply-chain checks, command policy, and workflow outcome measurement.
- Documentation domain: README, adoption guide, quickstart, security model, and agent skill instructions.

## Routes, Commands, And Entry Points

- `apex-init`: `scripts/init-harness.mjs`
- `apex-doctor`: `scripts/apex-doctor.mjs`
- `apex-manifest`: `scripts/apex-manifest.mjs`
- `apex-check-config`: `scripts/check-config.mjs`
- `apex-map-codebase`: `scripts/apex-map-codebase.mjs`
- Workflow benchmark: `npm run bench:workflow`
- Maintainer checks: `npm run check:syntax`, `npm run check:portability`, `npm run check:config`,
  `npm run test:fixtures`, `npm run test:demo`, `npm run self-check`

## Data, State, Auth, And External Boundaries

- Apex profiles and manifests are trusted executable workflow configuration.
- Runtime artifacts should stay under ignored `tmp/apex-workflow/` and `tmp/agent-browser/`.
- GitNexus, tracker, and browser integrations are optional adapters selected by target repo profile.
- No command should require a private local path, private target repo, or local `upstream` remote for normal install,
  doctor, manifest, verification, close, or finish behavior.

## Frequent Edit Hotspots

- `scripts/apex-manifest.mjs` for evidence, closeout, dirty detection, and finish packet behavior.
- `scripts/init-harness.mjs` for installer idempotency and profile inference.
- `scripts/apex-doctor.mjs` for readiness classification.
- `scripts/test-installer-fixtures.mjs` for regression coverage.
- `README.md`, `docs/adoption.md`, and `skills/apex-workflow/SKILL.md` for operator-facing behavior.

## Risk And Coupling Areas

- Path resolution must stay repo-bound for target artifacts while allowing maintainer profile validation.
- Command execution is trusted by default but can be narrowed by `security.commandPolicy`; it must be timed, capped,
  logged, and redacted.
- Evidence freshness must avoid both false freshness and self-invalidating Apex artifact churn.
- Installer rollback must preserve existing target repo files and skill links.
- Windows path separators and case-sensitive/case-insensitive filesystem differences affect CI reliability.

## Verification Path By Change Type

- Syntax-only script changes: `npm run check:syntax`.
- Path, portability, or docs changes: `npm run check:portability`.
- Profile/schema/template changes: `npm run check:config`.
- Installer, manifest, doctor, map, and evidence behavior: `npm run test:fixtures`.
- Quickstart/no-service flow: `npm run test:demo`.
- Workflow quality metrics: `npm run bench:workflow`.
- Security and supply-chain checks: `npm run check:security` and `npm run check:supply-chain`.
- Final local gate: `npm run self-check` and `git diff --check`.

## Generated Or Ignored Paths

- `node_modules/` is dependency install output.
- `tmp/apex-workflow/` is local Apex runtime evidence/log output.
- `tmp/agent-browser/` is local browser artifact output.
- `docs/plans/` is ignored local planning output in this repo.

## Keeping This Map Current

Update this map when CLI entry points move, profile schema behavior changes, fixture strategy changes, or docs/skills
gain new authority over operator behavior.

## Map Evidence

- Inspected repo layout, `package.json`, `README.md`, `AGENTS.md`, and CLI script responsibilities.
- This map is hand-reviewed for the Apex repo and is not a generated target-app draft.
