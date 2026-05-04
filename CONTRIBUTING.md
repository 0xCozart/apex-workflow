# Contributing To Apex Workflow

Apex Workflow is an installable workflow harness. Changes to this repo affect how coding agents install profiles,
execute configured commands, record evidence, and close work in other repositories. Keep changes scoped, reviewable, and
easy to prove from a clean checkout.

## Required Local Checks

Run these before asking for review:

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

Run focused commands earlier while developing. `npm run self-check` is the fast clean-room core gate.
`npm run hardening-check` is the final local hardening gate for shared-surface, security-sensitive, schema, fixture, CI,
and benchmark changes; it runs `self-check`, `check:security`, `check:supply-chain`, and `bench:workflow`. CI keeps
`self-check` on the full OS and Node matrix, then proves `hardening-check` once on Ubuntu with Node 24 so the heavier
security, supply-chain, and benchmark gate is visible without duplicating it across every portability cell. Neither
command is a substitute for understanding the affected surface.

## Pull Request Expectations

Every non-trivial PR should state:

- what changed and why
- which shared surfaces were touched
- which checks were run, with skipped checks called out explicitly
- whether profile schemas, manifest schemas, fixtures, docs, or security notes needed updates
- benchmark evidence for shared-surface, workflow-control, CI, release, fixture, manifest, or installer changes
- any remaining risk or next safe slice

Tiny documentation or comment-only changes may use a smaller verification set, but the PR must say why the smaller set
is enough.

`.github/CODEOWNERS` documents review ownership for shared surfaces. GitHub only enforces that ownership when branch
protection has "Require review from Code Owners" enabled for the protected branch.

## Human And Agent Protocol

Before modifying Apex itself:

1. Read `AGENTS.md` and `docs/CODEBASE_MAP.md`.
2. Identify the owning surface and the smallest safe mode for the change.
3. For code-facing work, use tests or fixtures to describe the expected behavior before changing implementation code.
4. Keep edits inside the declared owned files.
5. Preserve unrelated dirty work. Do not revert, rewrite, or reformat files outside the slice.
6. Finish with fresh verification evidence and a short handoff covering what changed, what was checked, and what
   remains.

Agents should prefer repo-native commands and fixture targets. Do not require private target repositories, local
absolute paths, secrets, or external services for default verification.

## Parallel-Agent Collision Rules

Parallel work is allowed only when ownership is explicit and disjoint.

- Declare owned files and no-touch files before editing.
- Do not run broad formatting over the repo when another slice owns nearby files.
- Do not edit shared surfaces speculatively.
- If two slices need the same shared file, stop and sequence the work.
- If new dirty files appear, inspect whether they are yours before adding or changing them.

When in doubt, make the current slice narrower and leave the next safe slice in the handoff.

## Shared Surfaces

Treat these paths as shared surfaces:

- `scripts/`
- `scripts/lib/`
- `schemas/`
- `skills/apex-workflow/`
- `templates/`
- `profiles/`
- `.github/`
- `SECURITY.md`
- `README.md`
- `AGENTS.md`

Shared-surface changes need focused fixture coverage or a clear reason why existing fixtures already prove the behavior.

## Schema Change Rules

Profile and manifest schema changes must stay aligned with executable validation.

- Update the relevant schema under `schemas/`.
- Update script-level semantic validation when the schema only proves shape.
- Add valid and invalid fixture coverage.
- Update docs or skill references when operators need to know about the field.
- Keep schema defaults compatible with existing trusted local usage unless the PR explicitly migrates behavior.

## CLI Behavior Change Rules

CLI changes must preserve clean-room use:

- Keep commands runnable without private repos or secrets.
- Prefer additive flags over breaking existing invocations.
- Keep output useful in both human terminal and CI logs.
- Update `README.md`, `docs/quickstart.md`, or `skills/apex-workflow/` when usage changes.
- Add fixture coverage for new failure modes, not only happy paths.

## Security-Sensitive Changes

Security-sensitive changes include command execution, profile or manifest trust boundaries, redaction, logging, artifact
paths, dependency installation, CI permissions, and any code that handles secrets.

For these changes:

- Keep `trusted-shell` local usage working unless the PR explicitly changes the trust model.
- Make stricter behavior opt-in where possible.
- Update `SECURITY.md`.
- Verify redaction, timeout, path-boundary, and log-hashing behavior when relevant.
- Do not store secrets in profiles, manifests, logs, fixtures, or finish packets.

## Verification Evidence

Reviewers should be able to answer:

- Which commands ran?
- Which commands were skipped and why?
- Which files were owned by the slice?
- Were there unowned dirty files?
- Were schemas, fixtures, docs, and security notes updated when needed?
- Is the next safe slice clear?

Use machine-readable output where available for CI and benchmark evidence.

Workflow benchmark evidence lives under `benchmarks/`. Use `npm run bench:workflow` for portable fixture evidence and
`npm run bench:target -- --target=/path/to/app` for local adoption-readiness proof against a real app or checked-in
fixture. Do not make private repos, secrets, or external services required benchmark inputs.

Adaptive profile changes need evidence for both the generated config and the recommendation loop. When touching
`operatingModel`, `manifestPolicy`, `verification.presets`, `sliceTemplates`, code-intelligence confidence, observation
logging, or `apex-profile`, include the relevant fixture test output plus one target benchmark summary. Recommendations
must stay local and pending until `apex-profile accept --yes` is run intentionally.
