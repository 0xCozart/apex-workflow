# Adaptive Governed Graph Design

**Date:** 2026-08-05
**Status:** Approved for implementation planning

## Objective

Extend Apex Workflow from an adaptive configuration and evidence harness into an adaptive execution control plane. New
projects must start with little ceremony, while mature or risky projects can progressively enable contract routing,
slice manifests, bounded diagnostic graphs, fresh independent audits, and receipt-backed external actions without
replacing the harness or weakening existing safety gates.

## Design principles

1. Preserve Apex's current no-service, offline-capable `tiny` and `ledger` paths.
2. Add capability tiers; do not create a second workflow state machine beside the existing modes.
3. Let a slice escalate within an owner-enabled ceiling when risk grows. Never let observations, recommendations, or
   an agent self-enable delegation, mutation, external actions, or spend.
4. Use graphs only for work with real independent branches. Sequential shared-state or external-action stages remain
   sequential.
5. Keep one controller as the only writer of manifests, control state, receipts, and integration state.
6. Make node inputs, outputs, dependencies, resource claims, and terminal state machine-readable.
7. Prefer deterministic code for validation, reduction, deduplication, completeness, and scheduling. Models perform
   judgment only where code cannot.
8. Treat tests that ran, immutable artifact and Git digests, explicit owner receipts, and provider journals as anchors.
   Agent reports are not anchors.
9. Preserve backward compatibility. Existing version-1 profiles and manifests behave as they do today unless an
   optional control plane is explicitly enabled.
10. Keep concrete model names, provider adapters, project authority paths, and cost ceilings in target profiles or
    plugins rather than the generic Apex core.

## Capability ladder

| Tier | Purpose | Enabled behavior |
| --- | --- | --- |
| `bootstrap` | New or immature repository | AGENTS/profile orientation and direct tiny verification |
| `ledger` | Normal meaningful work | Conditional manifests, owned/no-touch scope, evidence, detect, finish packets |
| `routed` | Shared or unfamiliar code | Contract routing, code-intelligence impact/freshness, verification presets |
| `governed` | Long-running, risky, or multi-agent work | Session binding, monotonic phases, audit/fix budgets, bounded diagnostic DAGs, fresh auditors |
| `external-actions` | Paid or externally mutating operations | Owner receipts, registered adapters, write-ahead journals, recovery and cleanup-only reconciliation |

Profiles define the maximum enabled tier. Slice classification may select a lower tier or escalate up to that ceiling.
Promotion above the ceiling requires an explicit profile change or current owner authorization. Recommendations remain
pending until intentionally accepted.

## Adaptive classification

A pure classifier evaluates repo and slice evidence, then returns a recommendation and reasons. Inputs include:

- selected Apex mode and operating model;
- file count, shared-surface ownership, and dirty-tree shape;
- auth, billing, migration, provider, deployment, secret, or external-action risk;
- number of independent read-only questions or disjoint write scopes;
- repeated failure classes and incomplete prior evidence;
- configured contracts, verification presets, and code-intelligence requirements.

Hard risk rules are monotonic. For example, external mutation cannot be classified below `external-actions`, and shared
auth cannot be classified below `routed`. The classifier may recommend a tier but cannot grant authority or execute a
command.

## Diagnostic graph contract

The graph is an optional governed-slice artifact. Each node declares:

```json
{
  "id": "parser-boundary-matrix",
  "kind": "diagnostic",
  "prerequisites": [],
  "inputDigests": ["sha256:..."],
  "outputSchema": "apex://schemas/finding-set-v1",
  "mutation": "read-only",
  "resourceClaims": ["repo:read"],
  "timeoutMs": 180000,
  "retryLimit": 1,
  "severity": "normal",
  "anchorRequirements": ["command-exit", "artifact-digest"]
}
```

Required invariants:

- unique node IDs and valid prerequisite references;
- acyclic dependency graph;
- configured total-node, concurrency, and depth caps;
- no parallel writers with overlapping resource or file claims;
- stable ready-node order by topological layer and node ID;
- explicit terminal state for every declared node: `passed`, `failed`, `blocked`, `cancelled`, or `expired`;
- downstream nodes become `blocked` when required inputs fail;
- fan-in compares expected and received node IDs and refuses partial synthesis;
- reducers validate schemas, deduplicate, sort deterministically, and preserve source digests;
- hard-safety failures cancel mutation-capable downstream work immediately.

The initial runtime is controller-guided: Apex computes ready work and validates results, while the active Codex host
uses its collaboration tools to create agents. A future runtime adapter may automate dispatch without changing the
ledger or trust model. The Claude-specific `workflow` keyword is not part of Apex.

## Auditor isolation

A fresh auditor receives only:

- the frozen objective and acceptance criteria;
- exact Git and artifact digests;
- node outputs after deterministic reduction;
- required anchor references and verification commands;
- the no-touch and authority boundaries.

It never receives the worker transcript. An auditor receipt binds the subject digest, auditor role, fresh context ID,
verdict, timestamp, and prior receipt head. The controller rejects self-audit, stale artifacts, missing anchors, or a
receipt that does not bind the frozen subject.

## External-action boundary

Generic Apex supplies the enforcement framework but no provider adapters. A target project or plugin registers an
adapter with a request schema, cost model, idempotency key, recovery behavior, and cleanup contract.

Before external execution Apex requires:

1. an owner authorization receipt with environment, action, commit, expiry, incremental and cumulative ceilings;
2. a frozen request and evidence digest;
3. a fresh independent audit receipt when the profile requires it;
4. an unconsumed single-use action receipt;
5. a write-ahead provider journal created before the adapter call.

Ambiguous results enter recovery. Recovery may observe, wait, reconcile, or clean up the journal-bound resource; it
must never invoke create again. Unknown adapters fail before reservation or receipt consumption.

## Evidence hardening

- Treat output truncation, missing logs, unhashed artifacts, or incomplete node counts as missing evidence.
- Store private control artifacts inside the configured repo boundary, reject symlinks, cap sizes, secret-scan and
  redact them, and apply mode `0600` where supported.
- Bind check evidence to command, cwd, Git head, owned-file fingerprint, start/end timestamps, exit status, and complete
  log digest.
- Use trusted declaration/result clocks. A result cannot predate its declaration.
- Preserve failed or rejected attempts; never rewrite timestamps or reuse a consumed sweep.

## Backward compatibility and migration

- Keep Apex profile and manifest version 1 for this work.
- Add optional `controlPlane` with its own `schemaVersion`.
- Existing installs remain at their current behavior when `controlPlane.enabled` is absent or false.
- Do not reinterpret existing `operatingModel: executor` as governed execution automatically.
- Add doctor warnings and migration previews before enabling a higher capability tier.
- Existing manifests continue to close normally unless their profile explicitly requires governed control.
- Add profile provenance (`reviewedAt`, authority fingerprints, source harness version) so extracted profiles can report
  drift without silently rewriting target configuration.

## Scope boundaries

### Generic Apex owns

- capability classification and tier ceilings;
- control-state, DAG, anchor, audit-receipt, action-receipt, and journal schemas;
- deterministic validation, scheduling, reduction, completeness, budget and recovery invariants;
- profile, doctor, benchmark, documentation, and fixture support.

### Target projects or plugins own

- product authority paths and domain contracts;
- concrete model/profile names and tool availability;
- provider adapters and request schemas;
- project phase names, checks, browser origins, environments, and monetary ceilings;
- deployment, migration, or paid-resource semantics.

## Verification strategy

- Golden tests prove legacy profiles and manifests are unchanged when control is disabled.
- Unit tests cover pure control, DAG, classifier, anchor, receipt, and journal invariants.
- Integration fixtures cover lifecycle commands and corrupted or concurrent state.
- Benchmarks prove tiny/ledger overhead stays bounded and graph/control work is only paid by enabled profiles.
- Security tests prove path boundaries, private modes, truncation handling, redaction, receipt single-use, and recovery.
- Portability checks cover Windows path/casing and platforms without POSIX permission bits.

## Rollout

Land this in additive slices: compatibility and classifier, governed control/DAG, evidence and fresh audit, external
action framework, then adaptive recommendations and documentation. Do not register a real provider adapter in the
generic Apex repository. Pilot the governed diagnostic diamond on a local non-paid fixture before extracting it into a
target project.
