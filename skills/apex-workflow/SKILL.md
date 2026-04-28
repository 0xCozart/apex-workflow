---
name: apex-workflow
description: Use for configurable, high-rigor app execution across repos. Selects the lightest safe workflow mode from an app profile, creates or uses a slice manifest, and routes product, tracker, code-intelligence, UI/UX, and verification gates without hard-coding one app's rules.
---

# Apex Workflow

Configurable execution harness for app work.

Use this skill when a repo wants Minty-grade rigor without Minty-specific names.
The app profile is the source of app-specific truth. The skill supplies the
workflow kernel.

## Read First

1. Find the workflow profile:
   - preferred: `apex.workflow.json` in the target repo
   - fallback: a profile explicitly named by the user
   - Minty extraction profile: `profiles/minty.workflow.json` in the Apex repo
2. Read the profile's `orientation.readFirst`.
3. Read `orientation.readBeforeBroadSearch` before broad code search or routing.
4. Read sectioned docs only when their trigger applies.

If no profile exists, use `templates/apex.workflow.json` as the expected shape
and run the harness installer when the Apex repo is available:

```bash
npm run init -- --target=/path/to/app
```

If the user did not specify setup mode, ask one question first:

```text
Auto-configure from repo evidence, or choose tracker/GitNexus/browser options?
```

If the user chooses auto, run with `--config-mode=auto --yes`. If they choose
custom, collect only the adapter choices needed and pass them as flags with
`--config-mode=custom --yes`.

## Harness Installation

When the user asks to install Apex Workflow from a GitHub repo or local clone:

1. Clone or open the Apex Workflow repo.
2. Identify the target app repo.
3. Run `npm run init -- --target=<target-app>`.
4. Use flags for known choices:
   - `--tracker=none|linear|github|file`
   - `--code-intelligence=auto|focused-search|gitnexus-mcp|gitnexus-wrapper`
   - `--browser=auto|none|agent-browser`
5. Confirm that `apex.workflow.json` validates and that the target `AGENTS.md`
   has the managed Apex block.
6. Run the readiness doctor from the target repo when available:

```bash
node /mnt/d/CURSOR/apex-workflow/scripts/apex-doctor.mjs \
  --config=apex.workflow.json \
  --target=.
```

7. Read the install report. Before the first implementation slice, resolve or
   consciously accept `setup.reviewNeeded`, confirm any `setup.inferredPaths`
   marked `guessed`, and preserve any `operatorCautions`.

Do not treat skill installation as complete until the target repo has a profile.
When GitNexus is selected, prefer `gitnexus-mcp`. Use `gitnexus-wrapper` only
when MCP is blocked or unreliable for that target environment.

## Mode Selection

Choose one mode from the profile before implementation.

Default mode meanings:

- `tiny`: one known file, low risk, no durable tracker state
- `route-local`: one owner with obvious callers
- `shared-surface`: shared shell/store/hook/auth/profile/workspace or multi-route coupling
- `issue-resume`: named tracker issue or dirty multi-slice continuation
- `planning`: product/design/architecture decision before code
- `reconciliation`: implementation appears done; remaining work is tracker, review, audit, or wait state

Downshift aggressively. Use the lightest mode that still preserves ownership,
contracts, impact, tracker disposition, verification, and finish evidence.

## Required Manifest

For every meaningful code-facing slice, create or update a manifest through the
configured helper. Default command when this repo is available:

```bash
node /mnt/d/CURSOR/apex-workflow/scripts/apex-manifest.mjs \
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
node /mnt/d/CURSOR/apex-workflow/scripts/apex-manifest.mjs \
  detect \
  --config=apex.workflow.json \
  --slug=<slice>
```

## Routing Rules

- `tiny`: skip broad routing unless ownership is unclear.
- `route-local`: read the owner contract or closest surrogate, run focused impact when editing non-trivial symbols, confirm callers with source search when useful.
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
- `Code-intelligence scope`
- `Tracker update`
- `Next safe slice`

Generate the packet from the manifest when the helper is available:

```bash
node /mnt/d/CURSOR/apex-workflow/scripts/apex-manifest.mjs \
  finish \
  --config=apex.workflow.json \
  --slug=<slice> \
  --verified="<commands run>" \
  --failed="<failed checks or none>" \
  --skipped="<skipped checks with reasons>" \
  --tracker-update="<tracker disposition>" \
  --next="<next safe slice>"
```

## Common Mistakes

- copying one app's product rules into the generic skill
- invoking every gate when a lower mode is enough
- using tracker state as product authority
- editing shared surfaces before reading contracts
- running broad dirty-tree analysis and calling it slice proof
- creating a manifest and leaving defaults like empty `ownedFiles` or `checks.typecheck: TODO`; `detect` will fail until current-slice files and required/skip check dispositions are explicit
- treating browser screenshots as visual signoff when the profile says functional-only
- finishing without a manifest-backed scope and verification summary
