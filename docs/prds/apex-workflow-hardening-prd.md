# PRD: Apex Workflow Hardening And Standards Alignment

Status: Implemented baseline  
Date: 2026-05-03  
Product: Apex Workflow  
Owner: 0xCozart

## Summary

This hardening phase formalizes contribution rules, slice manifest schema validation, configurable command execution
policies, security and supply-chain automation, and workflow outcome benchmarks.

## Implemented Requirements

P0:

- `CONTRIBUTING.md` defines Apex-specific maintainer, reviewer, and agent contribution protocol.
- `.github/CODEOWNERS` covers shared surfaces with initial ownership by `@0xCozart`.
- `AGENTS.md` points agents to the contribution protocol before modifying Apex itself.
- `schemas/apex.manifest.schema.json` defines the slice manifest shape.
- `apex-manifest check`, `detect`, `close`, and `finish` apply schema validation before semantic workflow checks.
- `security.commandPolicy` is supported by the profile schema.
- `run-check`, `close` required checks, detect commands, and doctor status commands enforce configured command policy.

P1:

- `.github/dependabot.yml` covers npm and GitHub Actions updates.
- `.github/workflows/security.yml` runs npm audit, SBOM generation, and CodeQL.
- `npm run check:security` runs the local npm audit gate.
- `npm run check:supply-chain` writes an SBOM to `tmp/apex-workflow/sbom.json`.
- `benchmarks/workflow-fixtures.json` defines workflow benchmark scenarios and metric targets.
- `npm run bench:workflow` runs no-service workflow outcome benchmarks and writes JSON output to
  `tmp/apex-workflow/workflow-benchmark.json`.

## Command Policy

Default behavior remains `trusted-shell`. Stricter environments may configure:

- `allowlisted-shell`
- `restricted-shell`
- `exec-array-only`

`exec-array-only` is schema-supported for future strict execution and currently blocks raw shell strings.

## Validation

Required local proof for this phase:

```bash
npm run format:check
npm run check:syntax
npm run check:portability
npm run check:config
npm run test:fixtures
npm run test:demo
npm run check:security
npm run check:supply-chain
npm run bench:workflow
npm run self-check
git diff --check
```
