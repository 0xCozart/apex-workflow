# Apex Workflow

Configurable agent workflow kernel extracted from the Minty execution system.

This repo is intentionally a reusable overlay, not a copy of Minty policy. The
core skill is `apex-workflow`; app-specific behavior comes from a workflow
profile such as `profiles/minty.workflow.json`.

## Contents

- `AGENTS.md`: agent-facing install rules for this harness repo.
- `skills/apex-workflow/`: installable Codex skill.
- `profiles/minty.workflow.json`: first extracted Minty profile.
- `schemas/apex.workflow.schema.json`: profile schema.
- `templates/apex.workflow.json`: blank profile starter.
- `scripts/init-harness.mjs`: harness installer for target app repos.
- `scripts/check-config.mjs`: profile validation with optional target-path checks.
- `scripts/apex-manifest.mjs`: generic slice manifest helper.
- `docs/adoption.md`: how to adopt the repo in another app.
- `docs/extraction-map.md`: what was extracted from Minty and where it landed.

## Harness Install

From this repo, configure a target app repo with:

```bash
npm run init -- --target=/path/to/app
```

For agent-driven non-interactive installs, pass the choices explicitly:

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

The installer:

- writes `apex.workflow.json` in the target repo
- creates or updates a managed Apex block in the target `AGENTS.md`
- validates the generated profile against the target paths
- symlinks `skills/apex-workflow` into the local Codex skills directory

Installer behavior:

- `--config-mode=auto`: infer from repo evidence and use safe defaults.
- `--config-mode=custom`: prompt or require explicit adapter choices.
- GitNexus should be installed and used as MCP when chosen; wrapper commands are
  recorded as fallback when a target repo has them.

## Local Checks

```bash
npm run check:config
npm run self-check
```

## Manual Use In Another App

Manual setup is still possible, but the installer is the default. If doing it
manually:

1. Copy `templates/apex.workflow.json` into the target repo as `apex.workflow.json`.
2. Fill in authority docs, orientation docs, tracker, code-intelligence, contracts, verification, and UI/UX policy.
3. Install or symlink `skills/apex-workflow` into your Codex skill directory.
4. Run the manifest helper from the target repo.

```bash
node /mnt/d/CURSOR/apex-workflow/scripts/apex-manifest.mjs \
  new \
  --config=apex.workflow.json \
  --file=tmp/apex-workflow/<slice>.json \
  --issue=none \
  --mode=route-local \
  --surface="owning surface" \
  --downshift="route-local: one owner and focused checks cover the slice"
```
