# Apex Workflow Agent Instructions

This repo is an installable workflow harness.

When a user asks you to install or configure Apex Workflow for an app repo, do
not stop at copying the skill. Configure the target repo with the harness
installer.

## Install Flow

1. Identify the target app repo path.
2. Ask the user one setup question unless they already specified it:
   "Auto-configure from repo evidence, or choose tracker/GitNexus/browser options?"
3. Run:

```bash
npm run init -- --target=/path/to/app
```

Use non-interactive flags when the user already gave the choices:

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

The installer writes `apex.workflow.json`, creates or updates a managed Apex
block in `AGENTS.md`, validates the generated profile, and symlinks the local
skill into the Codex skills directory unless `--skip-skill-link` is passed.

After the install report prints, review inferred path confidence, adapter
choices, dirty repo state, and baseline checkpoint guidance. Confirm or correct
any `setup.inferredPaths` entries marked `guessed` before starting the first
implementation slice.

## Guardrails

- Do not overwrite an existing `apex.workflow.json` unless the user asked for a
  refresh or you pass `--force` intentionally.
- Do not add Linear, GitNexus, browser automation, or design gates unless the
  target repo has them or the user chooses them.
- Do not put human cautions in `authority.doNotUseAsAuthority`; use
  `operatorCautions` for security, public/private boundary, or secret-handling
  warnings.
- Prefer GitNexus through MCP when the user chooses GitNexus. If MCP fails in
  the target environment, configure or document a repo-local wrapper fallback.
- App-specific product truth belongs in the target repo profile, not in the
  generic Apex skill.
