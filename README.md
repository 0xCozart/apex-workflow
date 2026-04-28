# Apex Workflow

> A repo-native control plane for Codex and LLM coding agents.
> Stop letting agents improvise your engineering process. Install a harness that forces orientation, scope control, contract routing, MCP/GitNexus impact checks, verification, and clean handoff state.

![Codex Workflow](https://img.shields.io/badge/Codex-workflow%20harness-111827)
![LLM Agents](https://img.shields.io/badge/LLM%20agents-repo%20aware-0f766e)
![MCP Ready](https://img.shields.io/badge/MCP-GitNexus%20ready-7c3aed)
![Manifest Driven](https://img.shields.io/badge/execution-manifest%20driven-b91c1c)

## The Short Version

Apex Workflow turns a repository into an agent-operable system: it installs an app-specific workflow profile, gives the agent a mode/state machine, and records every meaningful slice in a manifest before code gets touched. The result is less vague "I changed some files" automation and more controlled engineering: known authority docs, scoped ownership, explicit no-touch surfaces, code-intelligence checks, focused verification, and a next safe slice.

## Why This Exists

Most LLM coding agents do not fail because they cannot write code. They fail because they enter a repo with no operational discipline.

They search before reading the authority chain. They edit shared surfaces as if they were local helpers. They lose track of which files belong to the current slice. They treat screenshots as visual signoff. They skip tracker state or create junk tickets. Then the next session has to reconstruct the mess from a dirty tree and half-remembered chat.

Apex is the antidote: a portable workflow harness that makes the agent follow the repo's actual operating model.

## Architecture

```text
APEX WORKFLOW CONTROL PLANE

[apex-workflow repo]
  scripts/init-harness.mjs
  scripts/check-config.mjs
  scripts/apex-doctor.mjs
  scripts/apex-manifest.mjs
  skills/apex-workflow/SKILL.md
        |
        | install / refresh
        v
[target application repo]
  AGENTS.md managed block
  apex.workflow.json
  tmp/apex-workflow/*.json
  repo docs / contracts / tests
        |
        | every agent run reads the profile
        v
[$apex-workflow agent skill]
  mode selector
  manifest discipline
  contract + routing gates
  finish packet handoff
        |
        | adapter layer from apex.workflow.json
        v
[external intelligence + ops]
  GitNexus MCP first
  GitNexus wrapper fallback
  Linear / GitHub / file tracker
  agent-browser
  focused source search
```

## Execution State Machine

```text
[user task]
    |
    v
[1. orient]
    read AGENTS.md, apex.workflow.json, authority docs
    |
    v
[2. select mode]
    tiny | route-local | shared-surface | issue-resume | planning | reconciliation
    |
    |-- tiny known fix -------------------------------+
    |                                                |
    v                                                |
[3. open slice manifest]                             |
    owned files, no-touch surfaces, checks           |
    |                                                |
    v                                                |
[4. route before edit]                               |
    owner docs, contracts, state, callers            |
    |                                                |
    v                                                |
[5. impact check]                                    |
    GitNexus MCP -> wrapper fallback -> search       |
    |                                                |
    v                                                |
[6. edit]                                            |
    narrow implementation inside declared scope      |
    |                                                |
    v                                                v
[7. verify] <-------------------------------- [direct fix]
    path-scoped tests, lint/typecheck/build/browser evidence when relevant
    record command results into the manifest
    |
    v
[8. detect scope]
    compare changed files and affected flows against the manifest
    built-in dirty-file coverage if no graph detect is configured
    |
    v
[9. finish packet]
    landed, verified, not verified, risks, next safe slice
```

## Install

Ask the agent installing Apex one setup question:

```text
Auto-configure from repo evidence, or choose tracker/GitNexus/browser options?
```

Auto mode:

```bash
npm run init -- --target=/path/to/app --config-mode=auto --yes
```

Custom mode:

```bash
npm run init -- \
  --target=/path/to/app \
  --config-mode=custom \
  --tracker=linear \
  --tracker-team="Team Name" \
  --tracker-project="Project Name" \
  --code-intelligence=gitnexus-mcp \
  --browser=agent-browser \
  --origin=http://127.0.0.1:3000 \
  --yes
```

The installer writes `apex.workflow.json`, adds a managed Apex block to the target repo's `AGENTS.md`, validates the profile, and symlinks the `$apex-workflow` skill into the local Codex skills directory.

It also prints an install report: inferred authority paths with confidence, adapter choices, dirty repo state, review items, and whether to commit the harness setup before the first implementation slice.

Before the first implementation slice, run the doctor against the target repo:

```bash
npm run doctor -- --target=/path/to/app --config=apex.workflow.json
```

The doctor checks unresolved setup review items, guessed inferred paths, whether `tmp/apex-workflow/` is ignored, the managed `AGENTS.md` block, adapter readiness, the local skill symlink, and whether the installed setup has a clean baseline checkpoint.

## What The Profile Controls

`apex.workflow.json` is the contract between the target app and the agent.

```json
{
  "authority": {
    "productTruth": ["PRD.md"],
    "executionTruth": ["ROADMAP.md"],
    "workflowRules": ["AGENTS.md"]
  },
  "tracker": {
    "provider": "linear"
  },
  "codeIntelligence": {
    "provider": "gitnexus-mcp",
    "wrapperFallback": {
      "enabled": true
    }
  },
  "manifest": {
    "defaultDir": "tmp/apex-workflow"
  }
}
```

It tells the agent what counts as product truth, what workflow rules to read, which tracker to use, whether GitNexus runs through MCP or a wrapper, where contract docs live, which checks matter, and how browser evidence should be treated.

## Modes

| Mode | Use When | Guardrail |
| --- | --- | --- |
| `tiny` | One known file, low blast radius | Direct file read, path-scoped check |
| `route-local` | One owner with obvious callers | Manifest, owner docs, focused verification |
| `shared-surface` | Shared shell/store/hook/auth/workspace | Contracts, impact analysis, no-touch list |
| `issue-resume` | Named tracker issue or dirty continuation | Latest state, first real gap, no widening |
| `planning` | Product/design/architecture before code | Durable decision artifact when useful |
| `reconciliation` | Code landed, remaining work is review/tracker/audit | Evidence packet, no reopened code flow |

## GitNexus Strategy

Apex is MCP-first.

When GitNexus is selected, the profile prefers:

- `gitnexus_query`
- `gitnexus_context`
- `gitnexus_impact`
- `gitnexus_detect_changes`
- `gitnexus://repo/{name}/context`

If MCP fails because of host config, runtime, stale reloads, or local storage issues, Apex records a wrapper fallback. That wrapper should expose the same intent through repo-local commands like `npm run gitnexus:status`, `npm run gitnexus -- impact <symbol>`, and manifest-backed `detect_changes`.

MCP is the clean path. The wrapper is the survival path.

The profile records these separately:

- configured preference
- detected repo support
- current host availability
- fallback command readiness

Install-time repo evidence can detect wrapper scripts or GitNexus markers, but host MCP availability is only proven in the active agent session.

## Manifests And Finish Packets

Use the configured manifest directory instead of hand-writing `tmp/apex-workflow` paths:

```bash
npm run manifest -- new \
  --config=apex.workflow.json \
  --slug=app-123-thing \
  --issue=APP-123 \
  --mode=route-local \
  --surface="ticket detail route" \
  --downshift="route-local: one owner and focused checks cover this slice"
```

Run detect immediately after manifest creation. This catches wrong schema,
placeholder fields, missing required check disposition, and dirty files outside
the manifest before implementation starts:

```bash
npm run manifest -- detect \
  --config=apex.workflow.json \
  --slug=app-123-thing
```

Record checks as executable evidence:

```bash
npm run manifest -- run-check \
  --config=apex.workflow.json \
  --slug=app-123-thing \
  --cmd="npm test"
```

Close a slice with the generic control-plane path:

```bash
npm run manifest -- close \
  --config=apex.workflow.json \
  --slug=app-123-thing \
  --next="APP-124"
```

`close` runs detect, runs and records required manifest checks, records
`git diff --check`, and prints the finish packet.

Generate a handoff packet from the manifest:

```bash
npm run manifest -- finish \
  --config=apex.workflow.json \
  --slug=app-123-thing \
  --verified="npm test" \
  --skipped="browser: no UI change" \
  --tracker-update="none" \
  --next="APP-124"
```

## Why It Works

- **It makes repo authority explicit.** The agent reads the right docs before broad search.
- **It makes scope tangible.** The manifest names owned files, no-touch surfaces, checks, and next slice.
- **It prevents overbuilt process.** Mode selection lets tiny work stay tiny and shared work get the heavier guardrails it deserves.
- **It separates concerns.** Product truth, tracker state, graph intelligence, browser evidence, and verification are different systems.
- **It supports real-world failure.** If MCP breaks, fallback paths are documented instead of pretending the tool is fine.
- **It improves handoff quality.** Every meaningful pass ends with what landed, what was verified, what was not verified, and what comes next.

## Pros And Cons

Pros:

- repeatable install path for agent workflows
- lower resume ambiguity across long-running coding sessions
- cleaner boundaries for multi-agent or dirty-branch work
- fewer broad, ungrounded edits to shared surfaces
- MCP/GitNexus integration without betting everything on one transport
- works across apps because the app profile carries the local truth

Cons:

- requires a profile before the workflow is useful
- adds a manifest step for meaningful code slices
- depends on the target repo having honest docs, tests, and tracker semantics
- auto-detection is useful but not magic; product authority may need review
- GitNexus MCP still depends on the host agent's MCP support unless wrapper fallback is configured

## Repository Layout

```text
apex-workflow/
  AGENTS.md                         agent-facing install contract
  README.md                         this landing page
  package.json                      init, manifest, validation scripts
  templates/apex.workflow.json      blank target-app profile
  profiles/minty.workflow.json      extracted production profile
  profiles/service-desk.workflow.json non-Minty example profile
  schemas/apex.workflow.schema.json profile schema
  scripts/init-harness.mjs          target repo installer
  scripts/apex-doctor.mjs           readiness checker
  scripts/apex-manifest.mjs         slice manifest lifecycle
  scripts/check-config.mjs          profile validator
  scripts/test-installer-fixtures.mjs fixture regression tests
  skills/apex-workflow/SKILL.md     Codex skill entrypoint
  docs/adoption.md                  install details
  docs/extraction-map.md            extraction notes
```

## Local Verification

```bash
npm run check:config
npm run test:fixtures
npm run self-check
```

## The Philosophy

Apex does not try to make agents autonomous by removing process. It makes them effective by giving them the process a senior engineer would enforce anyway: read the repo, choose the smallest safe mode, respect contracts, prove the slice, and leave the next agent a clean trail.
