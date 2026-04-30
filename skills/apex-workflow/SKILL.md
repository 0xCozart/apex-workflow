---
name: apex-workflow
description:
  Use for configurable, high-rigor app execution across repos. Selects the lightest safe workflow mode from an app
  profile, creates or uses a slice manifest, and routes product, tracker, code-intelligence, UI/UX, and verification
  gates without hard-coding one app's rules.
---

# Apex Workflow

Configurable execution harness for app work.

Use this skill when a repo wants Minty-grade rigor without Minty-specific names. The app profile is the source of
app-specific truth. The skill supplies the workflow kernel.

## Trust Boundary

Apex profiles and manifests are trusted executable workflow configuration. Commands declared in the profile, manifest,
or CLI arguments may be run by `apex-manifest`, `apex-doctor`, and adapter fallbacks. Do not run Apex against untrusted
profiles, manifests, or repositories without reviewing the commands first. Do not store secrets in profiles, manifests,
logs, or finish packets.

## Read First

1. Find the workflow profile:
   - preferred: `apex.workflow.json` in the target repo
   - fallback: a profile explicitly named by the user
   - Minty extraction profile: `profiles/minty.workflow.json` in the Apex repo
2. Read the profile's `orientation.readFirst`.
3. Read `orientation.readBeforeBroadSearch` before broad code search or routing.
4. Read sectioned docs only when their trigger applies.
5. If no broad-search orientation doc exists, recommend creating a draft map:

```bash
apex-map-codebase --target=. --write
```

Draft maps are scaffolds, not authority. Treat `docs/CODEBASE_MAP.md` as a reviewed orientation authority only when it
has `Status: reviewed`, no `REVIEW NEEDED` markers, and `apex-map-codebase --check --require-reviewed` passes.

If no profile exists, use `templates/apex.workflow.json` as the expected shape and run the harness installer when the
Apex repo is available:

```bash
apex-init --target=/path/to/app
```

If the user did not specify setup mode, ask one question first:

```text
Auto-configure from repo evidence, or choose tracker/GitNexus/browser options?
```

If the user chooses auto, run with `--config-mode=auto --yes`. If they choose custom, collect only the adapter choices
needed and pass them as flags with `--config-mode=custom --yes`.

## Harness Installation

When the user asks to install Apex Workflow from a GitHub repo or local clone:

1. Clone or open the Apex Workflow repo.
2. Identify the target app repo.
3. Run `apex-init --target=<target-app>`.
4. Use flags for known choices:
   - `--tracker=none|linear|github|file`
   - `--code-intelligence=auto|focused-search|gitnexus-mcp|gitnexus-wrapper`
   - `--browser=auto|none|agent-browser`
5. Confirm that `apex.workflow.json` validates and that the target `AGENTS.md` has the managed Apex block.
6. Run the readiness doctor from the target repo when available:

```bash
apex-doctor \
  --config=apex.workflow.json \
  --target=.
```

7. Read the install report. Before the first implementation slice, resolve or consciously accept `setup.reviewNeeded`,
   confirm any `setup.inferredPaths` marked `guessed`, and preserve any `operatorCautions`.
8. If the installer generated a draft codebase map, review it, remove `REVIEW NEEDED` markers, then run:

```bash
apex-map-codebase --target=. --mark-reviewed --sync-profile
apex-map-codebase --target=. --check --require-reviewed
```

Do not treat skill installation as complete until the target repo has a profile. When GitNexus is selected, prefer
`gitnexus-mcp`. Use `gitnexus-wrapper` only when MCP is blocked or unreliable for that target environment.

## Mode Selection

Choose one mode from the profile before implementation.

Default mode meanings:

- `tiny`: one known file, low risk, no durable tracker state
- `route-local`: one owner with obvious callers
- `shared-surface`: shared shell/store/hook/auth/profile/workspace or multi-route coupling
- `issue-resume`: named tracker issue or dirty multi-slice continuation
- `planning`: product/design/architecture decision before code
- `reconciliation`: implementation appears done; remaining work is tracker, review, audit, or wait state

Downshift aggressively. Use the lightest mode that still preserves ownership, contracts, impact, tracker disposition,
verification, and finish evidence.

## Required Manifest

For every meaningful code-facing slice, create or update a manifest through the configured helper. Default command when
this repo is available:

```bash
apex-manifest \
  new \
  --config=apex.workflow.json \
  --slug=<slice> \
  --issue=<id-or-none> \
  --mode=<mode> \
  --surface="<owner>" \
  --downshift="<why this is the lightest safe mode>"
```

The manifest owns:

- issue and tracker disposition
- mode
- downshift proof
- owning surface
- contracts read
- current slice files
- no-touch surfaces
- code-intelligence impact targets/results
- required checks
- known baseline failures
- browser expectation

Use the manifest for scoped changed-file analysis:

```bash
apex-manifest \
  detect \
  --config=apex.workflow.json \
  --slug=<slice>
```

Run this immediately after creating the manifest and before implementation. If no repo-specific `detectCommand` is
configured, the helper still runs built-in coverage: manifest schema, dirty changed files versus `ownedFiles`, the
manifest artifact exception, and missing-owned-file warnings. Reconciliation manifests use
`dirtyPolicy=owned-files-only` by default: unrelated dirty files are recorded as external state, while code-facing modes
continue to fail on unowned dirty files unless the manifest explicitly chooses that policy.

## Routing Rules

- `tiny`: skip broad routing unless ownership is unclear.
- `route-local`: read the owner contract or closest surrogate, run focused impact when editing non-trivial symbols,
  confirm callers with source search when useful.
- `shared-surface`: use the profile's contract routing and code-intelligence gates before editing.
- `issue-resume`: inspect latest tracker/plan/diff state, preserve no-touch surfaces, and verify the first real gap.
- `planning`: use product authority and write durable plan artifacts only when the decision must survive sessions.
- `reconciliation`: update tracker/audit/review state without reopening code flow.

## Adapters

Read only the reference files needed for the active slice:

- `references/configuration.md`: profile fields and validation.
- `references/modes.md`: mode selection and downshift rules.
- `references/routing-contracts.md`: surface-first and contract-first routing.
- `references/code-intelligence.md`: GitNexus or search-backed impact/detect rules.
- `references/gitnexus-mcp.md`: GitNexus MCP install and wrapper fallback.
- `references/tracker-adapters.md`: Linear, GitHub, file, or no-tracker policy.
- `references/ui-ux.md`: frontend, browser, design handoff, and visual signoff rules.
- `references/minty-profile.md`: Minty-specific extraction mapping.

## Finish Packet

Use the profile's `manifest.finishPacket`. Default:

- `What landed`
- `Mode`
- `Downshift proof`
- `Owned files`
- `No-touch preserved`
- `Verified commands`
- `Failed / skipped checks`
- `Manual evidence`
- `GitNexus freshness`
- `Code-intelligence scope`
- `Tracker update`
- `Next safe slice`

Generate the packet from the manifest when the helper is available:

```bash
apex-manifest \
  finish \
  --config=apex.workflow.json \
  --slug=<slice> \
  --verified="<commands run>" \
  --failed="<failed checks or none>" \
  --skipped="<skipped checks with reasons>" \
  --tracker-update="<tracker disposition>" \
  --next="<next safe slice>"
```

Prefer recording checks into the manifest instead of only listing commands:

```bash
apex-manifest \
  run-check \
  --config=apex.workflow.json \
  --slug=<slice> \
  --cmd="<verification command>"
```

Recorded command runs include command source, exit code, timestamps, cwd, git metadata, working-tree fingerprints,
stdout/stderr tails, and a hashed repo-local log path under `tmp/apex-workflow/logs/<slice>/`. If required checks are
skipped at close, stale evidence must be rerun or explicitly overridden with `--allow-stale-evidence="<reason>"`.

For manual terminal, TUI, or operator evidence, record evidence instead of pretending it was an automated check:

```bash
apex-manifest \
  record-evidence \
  --config=apex.workflow.json \
  --slug=<slice> \
  --kind=manual-terminal \
  --summary="<what was observed>" \
  --source="<terminal, TUI, device, or operator context>"
```

For GitNexus-enabled non-tiny code slices, record freshness gate evidence before close:

```bash
apex-manifest \
  record-gitnexus-freshness \
  --config=apex.workflow.json \
  --slug=<slice> \
  --phase=pre-status \
  --status=fresh \
  --command="<GitNexus status command>"
```

Refresh before coding when status is stale, missing, or high-risk, then record `--phase=pre-refresh`. After the slice,
record `--phase=post-refresh` when the change affects graph reasoning for the next slice, or `--phase=post-skip` with a
reason when it does not.

At the end of a slice, use `close` when the target repo can run the manifest's required commands:

```bash
apex-manifest \
  close \
  --config=apex.workflow.json \
  --slug=<slice> \
  --next="<next safe slice>"
```

Use `--preview-commands` first when the command surface is unfamiliar or the profile came from an unreviewed source.

`close` runs detect, records required check results, records `git diff --check`, and prints the finish packet.

## Common Mistakes

- copying one app's product rules into the generic skill
- invoking every gate when a lower mode is enough
- using tracker state as product authority
- editing shared surfaces before reading contracts
- running broad dirty-tree analysis and calling it slice proof
- creating a manifest and leaving defaults like empty `ownedFiles` or `checks.typecheck: TODO`; `detect` will fail until
  current-slice files and required/skip check dispositions are explicit
- listing verification commands without recording whether they actually ran
- treating browser screenshots as visual signoff when the profile says functional-only
- finishing without a manifest-backed scope and verification summary
