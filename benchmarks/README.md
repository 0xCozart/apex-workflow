# Workflow Benchmarks

Apex has two benchmark paths.

## Fixture Benchmark

Run:

```bash
npm run bench:workflow
```

This is the CI-safe benchmark. It creates temporary local fixture repos, exercises manifest creation, closeout,
verification capture, stale-evidence behavior, dirty-branch reconciliation, GitNexus wrapper freshness records, browser
skip disposition, and missing-contract fallback behavior. It writes machine-readable output to
`tmp/apex-workflow/workflow-benchmark.json`.

The benchmark passes when the output has `ok: true` and the configured thresholds in `benchmarks/workflow-fixtures.json`
are met:

- scope escape rate is `0`
- verification capture rate is at least `0.95`
- finish packet completeness is at least `0.95`
- stale evidence detection is `1`
- dirty-branch false failure rate is `0`
- resume completeness is at least `0.95`

## Target Repo Benchmark

Run:

```bash
npm run bench:target -- --target=/path/to/app
```

For a checked-in clean-room fixture:

```bash
npm run bench:target -- --target=fixtures/config/service-desk
```

This benchmark inspects a real local target repo without mutating it. It verifies the target exists, checks whether an
Apex profile is present, inspects common orientation docs, package check scripts, adapter evidence, git dirtiness, and
runs `apex-doctor --skip-commands --json` when an `apex.workflow.json` profile is present. It writes JSON to
`tmp/apex-workflow/target-benchmark.json`. Adaptive profile fields are included in `profile.summary.adaptive`, including
operating model, execute default, manifest policy directory, verification preset count, slice template count,
observation row count, and recommendation readiness. The command exits non-zero only for fatal benchmark errors such as
a missing target path or malformed JSON; adoption readiness is reported as `readiness.ready` with concrete
`readiness.missing` entries.

CI uses the fixture benchmark by default because target repo benchmarking is adoption proof for local apps, not a
portable public dependency. Do not use private repos, secrets, or external services as required benchmark inputs.

If the target has intentional dirty state, pass:

```bash
npm run bench:target -- --target=/path/to/app --allow-dirty-target
```

The current target benchmark remains read-only even when `--write` is supplied. Mutating benchmark modes must be added
as explicit future work with separate fixture coverage.

## PR Evidence

For shared-surface, CI, release, security, benchmark, manifest, installer, or workflow-control changes, paste the
summary lines from `npm run bench:workflow` into the PR along with whether `tmp/apex-workflow/workflow-benchmark.json`
reported `ok: true`.

When validating adoption against a real app, also paste the summary lines from `npm run bench:target -- --target=...`
and call out whether `readiness.ready` is true. A target benchmark with missing prerequisites can still be useful
evidence, but it is not a passing adoption-readiness benchmark until those entries are resolved or explicitly accepted.
