# Extraction Map

This file records the first extraction from Minty into Apex Workflow.

## Generic Kernel

Extracted from `minty-exec` and `docs/runbooks/minty-execution-os.md`:

- mode selection
- downshift proof
- per-slice manifest
- owned files and no-touch surfaces
- focused checks before broad checks
- known-failure baseline policy
- finish packet
- scoped detect-changes through changed-file lists
- harness installation through an app-local `apex.workflow.json` profile

## Routing And Contracts

Extracted from `minty-contract-routing`, `surface-first`, and
`contract-bridge`:

- owning surface first
- contract docs before code
- practical caller confirmation when graph output is suspicious
- route-owner checks for shell leakage, auth parity, and unshipped handoffs
- fallback to focused source search when graph tooling is unavailable

## Tracker

Extracted from `minty-linear-chief` and the Linear playbook:

- tracker reflects execution state, not product truth
- update existing records before creating duplicates
- record meaningful work, not every tiny edit
- active coding state means active coding
- issue packets need context, scope, acceptance checks, risks, and next slice

## Product Judgment

Extracted from `minty-product-ops`:

- product authority wins over tracker state
- decide the real problem before decomposing
- give one recommended path when possible
- sequence work into the configured product authority model

## UI/UX And Browser Verification

Extracted from Minty frontend workflow and `agent-browser`:

- browser proof is functional evidence unless the profile says it is visual signoff
- UI work needs design-system policy before implementation
- screenshots can support human review but should not be overclaimed

## Minty-Specific Material Kept In Profile

The following stayed in `profiles/minty.workflow.json`, not in the generic skill:

- Minty PRD and tracker names
- `XMinty` / `Minty Master Plan Alignment`
- Minty GitNexus wrapper commands
- Minty contract directories
- Minty known verification baseline
- Minty browser origin and artifact paths
- Minty design-system docs and visual-signoff policy

## Harness Installer

The first installer lives at `scripts/init-harness.mjs`.

It generalizes the manual Minty adoption flow into:

- target repo introspection
- an explicit auto-vs-custom setup choice
- optional interactive prompts for tracker, code-intelligence, and browser choices
- generated `apex.workflow.json`
- managed `AGENTS.md` installation block
- local skill symlink
- config validation against the target repo

GitNexus handling is now adapter-based:

- preferred: GitNexus MCP tools/resources from the host agent
- fallback: repo-local wrapper commands when MCP fails in a target environment
- final fallback: focused source search plus configured contracts
