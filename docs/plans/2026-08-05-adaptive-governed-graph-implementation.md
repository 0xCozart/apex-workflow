# Adaptive Governed Graph Implementation Plan

> **For Codex:** Use the appropriate execution workflow to implement this plan task-by-task with review checkpoints.

**Goal:** Add an optional, backward-compatible Apex control plane that scales from bootstrap guidance to governed
diagnostic graphs and receipt-backed external actions as a target project's complexity and risk grow.

**Architecture:** Preserve existing profile version 1, manifest version 1, and the current tiny/ledger fast paths. Add a
separately versioned `controlPlane` capability ladder, pure deterministic control and DAG libraries, a new
`apex-control` CLI, hardened anchor/audit/action receipts, and adapter-neutral provider journals. Profile observations
may recommend promotion but can never activate mutation, delegation, or spend.

**Tech Stack:** Node.js ESM, JSON Schema 2020-12, AJV, `node:test`, existing Apex atomic manifest store and command
runner, clean-room fixtures and workflow benchmarks.

---

## Execution rules

- Implement in `/home/sacred/.config/superpowers/worktrees/apex-workflow/adaptive-diagnostic-graph` on
  `codex/apex-adaptive-diagnostic-graph`.
- Use a Sol High implementation subagent. Give each task its exact text and current commit; do not give auditors the
  implementation transcript.
- Follow test-driven development: demonstrate the focused test failing before implementation and passing afterward.
- One controller owns shared schemas, manifests, locks, integration, and commits. Do not run parallel writers against
  shared files.
- Preserve the dirty main worktree at `/home/sacred/code/apex-workflow` as no-touch.
- The uncommitted main changes in `package.json`, `package-lock.json`, and `skills/apex-workflow/SKILL.md` are user work.
  Recreate their intended additive changes in this branch during Task 1; never reset, stash, or rewrite the main tree.
- Do not add a real provider adapter, secret, paid action, network mutation, deployment, push, or merge.
- Run a fresh spec review and then a fresh code-quality/security review after every task. Resolve important findings
  before continuing.

## Task 1: Reconcile Existing Apex Improvements And Secure The Baseline

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `skills/apex-workflow/SKILL.md`
- Test: `scripts/test-installer-fixtures.mjs`

**Step 1: Snapshot the no-touch user diff**

Run:

```bash
git -C /home/sacred/code/apex-workflow diff -- package.json package-lock.json skills/apex-workflow/SKILL.md
```

Expected: an additive `apex-profile` bin, exact Prettier pin, and objective-alignment/execute-request skill guidance.
Record the source commit and diff digest in the task handoff; do not modify that worktree.

**Step 2: Write failing fixture assertions**

Add assertions proving:

- installed guidance keeps objective alignment separate from execution;
- an explicit execute request creates the first manifest rather than stopping at planning prose;
- the package exposes `apex-profile`;
- the lockfile resolves `fast-uri` above the vulnerable `<=3.1.4` range.

Run:

```bash
node scripts/test-installer-fixtures.mjs
```

Expected: FAIL on at least the missing skill/bin assertions before reconciliation.

**Step 3: Recreate the user changes additively**

Port only the reviewed intent from the no-touch diff. Do not mechanically copy unrelated working-tree state.

Update the dependency lock without changing AJV's public version:

```bash
npm update fast-uri --package-lock-only
```

Require the resolved version to be greater than `3.1.4`. Do not run `npm audit fix --force`.

**Step 4: Run focused verification**

Run:

```bash
npm ci
npm run format:check
npm run check:syntax
npm run test:fixtures
npm audit --audit-level=high
git diff --check
```

Expected: exit 0; zero high or critical advisories; the dirty main worktree remains byte-for-byte unchanged.

**Step 5: Commit**

```bash
git add package.json package-lock.json skills/apex-workflow/SKILL.md scripts/test-installer-fixtures.mjs
git commit -m "chore: reconcile Apex workflow baseline"
```

## Task 2: Add Capability Ladder And Deterministic Slice Classification

**Files:**

- Create: `scripts/lib/complexity-classifier.mjs`
- Create: `scripts/__tests__/complexity-classifier.test.mjs`
- Modify: `schemas/apex.workflow.schema.json`
- Modify: `schemas/apex.manifest.schema.json`
- Modify: `scripts/lib/profile-model.mjs`
- Modify: `scripts/check-config.mjs`
- Modify: `scripts/apex-profile.mjs`
- Modify: `scripts/apex-manifest.mjs`
- Modify: `templates/apex.workflow.json`
- Modify: `profiles/service-desk.workflow.json`
- Modify: `package.json`

**Step 1: Write classifier tests**

Cover:

```js
assert.equal(classifySlice({ mode: "tiny", enabledThrough: "governed" }).selectedTier, "bootstrap");
assert.equal(classifySlice({ mode: "shared-surface", risks: ["auth"] }).selectedTier, "routed");
assert.equal(classifySlice({ risks: ["external-mutation"] }).selectedTier, "external-actions");
assert.equal(classifySlice({ independentJobs: 3, repeatedFailureClass: true }).graphRecommended, true);
assert.throws(() => classifySlice({ risks: ["external-mutation"], enabledThrough: "governed" }), /ceiling/i);
```

Also prove observations and recommendations cannot increase `enabledThrough`.

Run:

```bash
node --test scripts/__tests__/complexity-classifier.test.mjs
```

Expected: FAIL because the module does not exist.

**Step 2: Add the optional profile contract**

Add this additive shape to `apex.workflow.schema.json`:

```json
"controlPlane": {
  "schemaVersion": 1,
  "enabled": false,
  "enabledThrough": "ledger",
  "limits": {
    "maxNodes": 12,
    "maxConcurrency": 3,
    "maxDepth": 1
  },
  "requireFreshAuditFor": [],
  "externalActions": { "enabled": false, "registeredAdapters": [] }
}
```

Allowed tiers are `bootstrap`, `ledger`, `routed`, `governed`, and `external-actions`. `enabledThrough` is a ceiling, not
a default execution command.

**Step 3: Implement pure classification**

Export:

```js
export function normalizeControlPlane(config) {}
export function classifySlice(input, controlPlane) {}
export function compareCapabilityTiers(left, right) {}
```

Return `{ selectedTier, minimumTier, ceiling, graphRecommended, reasons, blockedReasons }`. Keep the function pure and
deterministic. Hard risks are monotonic and fail closed when the profile ceiling is too low.

**Step 4: Integrate recommendation-only output**

- `apex-profile show` prints the enabled ceiling and limits.
- `apex-manifest new` records classification inputs/result when control is enabled.
- Existing profiles and manifests omit the section and remain behaviorally identical.
- `apex-profile recommend` may emit a pending control recommendation but `accept --yes` remains the only profile write
  path.

**Step 5: Verify compatibility and commit**

Run:

```bash
node --test scripts/__tests__/complexity-classifier.test.mjs
npm run check:config
npm run test:fixtures
npm run bench:workflow
git diff --check
```

Commit:

```bash
git add scripts/lib/complexity-classifier.mjs scripts/__tests__/complexity-classifier.test.mjs \
  schemas/apex.workflow.schema.json schemas/apex.manifest.schema.json scripts/lib/profile-model.mjs \
  scripts/check-config.mjs scripts/apex-profile.mjs scripts/apex-manifest.mjs templates/apex.workflow.json \
  profiles/service-desk.workflow.json package.json
git commit -m "feat: classify adaptive Apex capability tiers"
```

## Task 3: Add Governed Control State, Sessions, Phases, And Budgets

**Files:**

- Create: `schemas/apex.control.schema.json`
- Create: `scripts/lib/control-model.mjs`
- Create: `scripts/apex-control.mjs`
- Create: `scripts/__tests__/control-model.test.mjs`
- Modify: `scripts/lib/manifest-store.mjs`
- Modify: `scripts/apex-doctor.mjs`
- Modify: `scripts/apex-manifest.mjs`
- Modify: `package.json`

**Step 1: Write failing state-machine tests**

Prove:

- only the controller session may mutate control state;
- phases move monotonically and cannot skip required terminal gates;
- audit, fix-attempt, and spend counters reject exhausted budgets;
- concurrent state mutations under the same lease have one winner;
- stale lease recovery requires a new controller identity and a preserved prior record;
- overrides cannot lower limits or originate from manifest content.

Use a temporary repo for every test; no test may depend on Minty or a private path.

Run:

```bash
node --test scripts/__tests__/control-model.test.mjs
```

Expected: FAIL because control modules are absent.

**Step 2: Define control state**

The schema must include:

```text
schemaVersion, sliceId, controller, session, capabilityTier,
phase { id, index, total, status }, budgets { audit, fixAttempt, spendCents },
receiptHead, graph, actions, events, createdAt, updatedAt
```

Every event stores a prior-state digest and new-state digest. Use atomic writes plus a controller lease stored under the
configured Apex temporary directory.

**Step 3: Implement CLI lifecycle**

Support:

```bash
apex-control configure --config=... --slug=... --tier=governed --phase-id=... --phase-index=1 --phase-total=3
apex-control session-start --slug=... --thread-id=...
apex-control session-resume --slug=... --thread-id=...
apex-control record --slug=... --event=audit
apex-control status --slug=... --json
apex-control override-preview --slug=... --budget=audits --new-limit=6 --source=...
```

Do not add a command that converts a manifest string directly into owner authorization.

**Step 4: Integrate doctor and manifests**

- Doctor reports disabled, configured, stale lease, invalid state, and ceiling mismatch.
- Governed manifests bind the control-state path and digest.
- Legacy close remains unchanged when control is disabled.
- Governed close refuses nonterminal phases, unresolved graphs, or exhausted/ambiguous action state.

**Step 5: Verify and commit**

Run:

```bash
node --test scripts/__tests__/control-model.test.mjs
npm run check:syntax
npm run test:fixtures
npm run test:demo
git diff --check
```

Commit:

```bash
git add schemas/apex.control.schema.json scripts/lib/control-model.mjs scripts/apex-control.mjs \
  scripts/__tests__/control-model.test.mjs scripts/lib/manifest-store.mjs scripts/apex-doctor.mjs \
  scripts/apex-manifest.mjs package.json
git commit -m "feat: add governed Apex control state"
```

## Task 4: Add Bounded Diagnostic DAGs And Deterministic Fan-In

**Files:**

- Create: `schemas/apex.graph.schema.json`
- Create: `schemas/apex.node-result.schema.json`
- Create: `scripts/lib/diagnostic-dag.mjs`
- Create: `scripts/__tests__/diagnostic-dag.test.mjs`
- Modify: `scripts/apex-control.mjs`
- Modify: `scripts/apex-manifest.mjs`
- Modify: `scripts/bench-workflow.mjs`

**Step 1: Write adversarial graph tests**

Cover cycles, duplicate IDs, missing prerequisites, excessive nodes/depth, incomplete fan-in, schema-invalid output,
overlapping writer claims, hard-safety cancellation, timeouts, terminal-state completeness, and deterministic order.

Core expected behavior:

```js
assert.deepEqual(readyNodes(graph, state).map((node) => node.id), ["a-parser", "b-cleanup"]);
assert.throws(() => reduceNodeResults(graph, [resultA]), /missing.*b-cleanup/i);
assert.equal(nextState.nodes.mutate.status, "blocked");
```

Run:

```bash
node --test scripts/__tests__/diagnostic-dag.test.mjs
```

Expected: FAIL because the DAG module does not exist.

**Step 2: Implement graph validation and scheduling**

Export pure functions:

```js
validateGraph(graph, limits)
readyNodes(graph, state)
recordNodeResult(graph, state, result)
reduceNodeResults(graph, state, reducer)
graphCompleteness(graph, state)
```

Ready order is stable by topological layer then node ID. Resource claims serialize shared writers. Workers never mutate
the graph file directly; the controller records results under the existing control lock.

**Step 3: Add controller-guided CLI commands**

Support:

```bash
apex-control graph-declare --slug=... --graph=tmp/apex-workflow/private/graph.json
apex-control graph-ready --slug=... --json
apex-control graph-record --slug=... --node-id=... --result=...
apex-control graph-reduce --slug=... --reducer=json-merge-v1
apex-control graph-status --slug=... --json
```

The CLI validates and records work; it does not pretend to spawn Codex agents itself.

**Step 4: Add diagnostic-diamond fixture and benchmark**

Create a portable fixture with three read-only diagnostics, one deterministic reducer, one audit gate, and one blocked
mutation node. Assert all expected node IDs return and partial synthesis fails.

Benchmark tiny and ledger modes against the previous baseline and record graph overhead separately. Control-disabled
paths must not read or create graph state.

**Step 5: Verify and commit**

Run:

```bash
node --test scripts/__tests__/diagnostic-dag.test.mjs
npm run test:fixtures
npm run bench:workflow
git diff --check
```

Commit:

```bash
git add schemas/apex.graph.schema.json schemas/apex.node-result.schema.json scripts/lib/diagnostic-dag.mjs \
  scripts/__tests__/diagnostic-dag.test.mjs scripts/apex-control.mjs scripts/apex-manifest.mjs \
  scripts/bench-workflow.mjs
git commit -m "feat: add bounded diagnostic graph control"
```

## Task 5: Harden Anchors, Private Artifacts, And Evidence Completeness

**Files:**

- Create: `scripts/lib/anchor-store.mjs`
- Create: `scripts/__tests__/anchor-store.test.mjs`
- Modify: `scripts/lib/runner.mjs`
- Modify: `scripts/lib/manifest-store.mjs`
- Modify: `scripts/apex-manifest.mjs`
- Modify: `scripts/apex-control.mjs`
- Modify: `SECURITY.md`

**Step 1: Write security regression tests**

Prove:

- truncated stdout/stderr cannot satisfy a required anchor without a complete hashed private log;
- missing, unhashed, oversized, outside-root, or symlink artifacts fail closed;
- private artifacts use mode `0600` on POSIX and record a portability disposition elsewhere;
- secrets are redacted from bounded summaries and rejected from governed private artifacts when the scanner matches;
- evidence cannot predate its declaration or outlive configured freshness;
- command, cwd, Git head, owned-file fingerprint, exit status, and full log digest are bound.

Run:

```bash
node --test scripts/__tests__/anchor-store.test.mjs
```

Expected: FAIL before implementation.

**Step 2: Implement the anchor store**

Use repo-bound canonical paths and atomic writes. Define anchors for:

```text
command-exit, artifact-digest, git-commit, owned-files, human-authorization, auditor-receipt, provider-journal
```

Do not accept an agent's prose result as an anchor.

**Step 3: Make truncation explicit**

Extend runner results with:

```json
{
  "stdoutTruncated": false,
  "stderrTruncated": false,
  "completeLogPath": "...",
  "completeLogSha256": "..."
}
```

Required checks reject truncated output unless the complete log exists, is private, and matches its digest.

**Step 4: Verify and commit**

Run:

```bash
node --test scripts/__tests__/anchor-store.test.mjs
npm run check:security
npm run check:portability
npm run test:fixtures
git diff --check
```

Commit:

```bash
git add scripts/lib/anchor-store.mjs scripts/__tests__/anchor-store.test.mjs scripts/lib/runner.mjs \
  scripts/lib/manifest-store.mjs scripts/apex-manifest.mjs scripts/apex-control.mjs SECURITY.md
git commit -m "feat: harden Apex evidence anchors"
```

## Task 6: Add Fresh Auditor Roles And Hash-Chained Audit Receipts

**Files:**

- Create: `schemas/apex.audit-receipt.schema.json`
- Create: `scripts/lib/audit-receipts.mjs`
- Create: `scripts/__tests__/audit-receipts.test.mjs`
- Create: `skills/apex-workflow/references/control-plane.md`
- Create: `skills/apex-workflow/references/diagnostic-dags.md`
- Modify: `scripts/apex-control.mjs`
- Modify: `schemas/apex.workflow.schema.json`
- Modify: `skills/apex-workflow/SKILL.md`

**Step 1: Write receipt tests**

Reject:

- auditor context equal to worker/controller context;
- subject digest not matching frozen artifacts;
- missing required anchors or stale verification;
- broken prior-receipt hash chain;
- reused receipt for a different graph, commit, or phase;
- auditor role that the target profile does not permit.

Run:

```bash
node --test scripts/__tests__/audit-receipts.test.mjs
```

Expected: FAIL before implementation.

**Step 2: Add abstract runtime roles**

Profiles may define `controller`, `executor`, `bulk-reader`, and `auditor` capabilities and constraints. Do not hard-code
Terra, Sol, Luna, or another model name in generic schemas. Documentation may show examples as non-authoritative target
configuration.

**Step 3: Implement frozen subject and receipt flow**

Support:

```bash
apex-control audit-freeze --slug=... --out=tmp/apex-workflow/private/audit-subject.json
apex-control audit-record --slug=... --subject=... --receipt=...
apex-control audit-status --slug=... --json
```

The active Codex controller starts the fresh auditor with its collaboration tools. Apex validates the resulting receipt
and artifact/anchor bindings.

**Step 4: Verify and commit**

Run:

```bash
node --test scripts/__tests__/audit-receipts.test.mjs
npm run test:fixtures
npm run check:config
git diff --check
```

Commit:

```bash
git add schemas/apex.audit-receipt.schema.json scripts/lib/audit-receipts.mjs \
  scripts/__tests__/audit-receipts.test.mjs skills/apex-workflow/references/control-plane.md \
  skills/apex-workflow/references/diagnostic-dags.md scripts/apex-control.mjs \
  schemas/apex.workflow.schema.json skills/apex-workflow/SKILL.md
git commit -m "feat: add independent Apex audit receipts"
```

## Task 7: Add Adapter-Neutral External-Action Receipts And Recovery Journals

**Files:**

- Create: `schemas/apex.action-receipt.schema.json`
- Create: `schemas/apex.provider-journal.schema.json`
- Create: `scripts/lib/action-receipts.mjs`
- Create: `scripts/lib/provider-run.mjs`
- Create: `scripts/__tests__/provider-run.test.mjs`
- Create: `skills/apex-workflow/references/provider-actions.md`
- Modify: `scripts/apex-control.mjs`
- Modify: `schemas/apex.workflow.schema.json`
- Modify: `SECURITY.md`

**Step 1: Write adversarial action tests**

Cover:

- unknown adapter fails before reservation or receipt consumption;
- missing owner authority, wrong commit/environment/action, expiry, and ceiling overflow fail closed;
- concurrent receipt consumption has one winner;
- journal exists before adapter invocation;
- idempotency key binds the exact request digest;
- ambiguous result enters recovery and recovery never invokes create;
- `FAILED_CLEAN` and `FAILED_DIRTY` remain distinct;
- cleanup-only recovery is journal/resource bound;
- generic Apex ships with zero registered paid adapters.

Run:

```bash
node --test scripts/__tests__/provider-run.test.mjs
```

Expected: FAIL before implementation.

**Step 2: Implement generic receipts and journals**

Action receipts bind:

```text
authorizationId, commit, environment, adapterId, requestDigest,
incrementalCeilingCents, cumulativeCeilingCents, expiresAt, priorReceiptHead
```

Provider journals use a monotonic lifecycle such as:

```text
DECLARED -> RESERVED -> RUNNING -> SUCCEEDED
                              -> FAILED_CLEAN
                              -> FAILED_DIRTY -> RECOVERING -> FAILED_CLEAN|SUCCEEDED
```

**Step 3: Add CLI boundary**

Support registered adapter metadata and dry-run validation, but no built-in live provider:

```bash
apex-control action-validate --slug=... --authorization=... --request=...
apex-control action-run --slug=... --authorization=... --request=...
apex-control action-recover --slug=... --journal-id=...
apex-control action-status --slug=... --json
```

`action-run` refuses when no project/plugin adapter is registered.

**Step 4: Verify and commit**

Run:

```bash
node --test scripts/__tests__/provider-run.test.mjs
npm run check:security
npm run check:supply-chain
npm run test:fixtures
git diff --check
```

Commit:

```bash
git add schemas/apex.action-receipt.schema.json schemas/apex.provider-journal.schema.json \
  scripts/lib/action-receipts.mjs scripts/lib/provider-run.mjs scripts/__tests__/provider-run.test.mjs \
  skills/apex-workflow/references/provider-actions.md scripts/apex-control.mjs \
  schemas/apex.workflow.schema.json SECURITY.md
git commit -m "feat: govern external Apex actions"
```

## Task 8: Add Profile Provenance, Adaptive Recommendations, Docs, And Full Benchmarks

**Files:**

- Modify: `scripts/lib/profile-discovery.mjs`
- Modify: `scripts/lib/profile-recommendations.mjs`
- Modify: `scripts/apex-profile.mjs`
- Modify: `scripts/apex-doctor.mjs`
- Modify: `scripts/test-installer-fixtures.mjs`
- Modify: `scripts/bench-workflow.mjs`
- Modify: `scripts/bench-target-repo.mjs`
- Modify: `schemas/apex.workflow.schema.json`
- Modify: `templates/apex.workflow.json`
- Modify: `profiles/service-desk.workflow.json`
- Modify: `profiles/minty.workflow.json`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/CODEBASE_MAP.md`
- Modify: `docs/adoption.md`
- Modify: `docs/quickstart.md`
- Modify: `skills/apex-workflow/SKILL.md`

**Step 1: Write failing provenance and recommendation fixtures**

Prove:

- profiles record `reviewedAt`, authority fingerprints, and `sourceHarnessVersion`;
- doctor reports drift without rewriting the profile;
- observations recommend a higher tier only after configured evidence thresholds;
- recommendations never activate control, delegation, external actions, adapters, or spend;
- insufficient evidence produces no promotion;
- accepting a recommendation preserves unrelated manual configuration;
- the Minty example profile no longer treats archived pointer files or Linear as active authority.

**Step 2: Implement provenance and pending recommendations**

Use deterministic, explainable rules. Every recommendation includes current value, proposed value, evidence summary,
confidence, and why it remains pending.

**Step 3: Document the fake-edge test and adaptive routing**

Document:

- when to stay serial;
- when to use a diagnostic diamond;
- one-controller and disjoint-writer rules;
- terminal-node and fan-in completeness;
- fresh-auditor context isolation;
- capability ceilings and genuine owner gates;
- project/plugin ownership of real adapters;
- migration of existing installs with control disabled by default.

Do not tell users that typing `workflow` invokes native graph behavior.

**Step 4: Run full verification**

Run all required Apex gates from `CONTRIBUTING.md`:

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
npm run hardening-check
git diff --check
```

Expected: all exit 0. Record benchmark deltas for bootstrap/tiny, ledger, governed graph, and external-action validation.

**Step 5: Commit**

```bash
git add scripts/lib/profile-discovery.mjs scripts/lib/profile-recommendations.mjs scripts/apex-profile.mjs \
  scripts/apex-doctor.mjs scripts/test-installer-fixtures.mjs scripts/bench-workflow.mjs \
  scripts/bench-target-repo.mjs schemas/apex.workflow.schema.json templates/apex.workflow.json \
  profiles/service-desk.workflow.json profiles/minty.workflow.json README.md SECURITY.md docs/CODEBASE_MAP.md \
  docs/adoption.md docs/quickstart.md skills/apex-workflow/SKILL.md
git commit -m "docs: complete adaptive Apex control rollout"
```

## Final independent review and integration boundary

1. Freeze the final branch commit, tree digest, changed-file list, required commands, benchmark output, and known gaps.
2. Dispatch a fresh Sol High auditor with no implementation transcript.
3. Require separate spec-compliance and code-quality/security verdicts.
4. Reconcile findings on the implementation branch and rerun affected focused checks plus `hardening-check`.
5. Compare the isolated branch against the no-touch dirty main worktree. Do not overwrite the user's three files.
6. Stop before merge, push, publishing, package release, or installing the new harness into another repository unless
   the user explicitly authorizes that boundary.
