# Configuration

Apex Workflow is configured by `apex.workflow.json`.

## Required Top-Level Fields

- `version`: currently `1`
- `name`: app or repo name
- `authority`: product, execution, and workflow source lists
- `orientation`: docs to read before broad search
- `modes`: allowed workflow modes
- `tracker`: tracker adapter and recording policy
- `codeIntelligence`: GitNexus/search/static adapter
- `contracts`: feature/state contract locations
- `verification`: focused checks, known failures, and browser policy
- `uiUx`: design-system and visual-signoff policy
- `manifest`: default manifest directory and finish packet

## Validation

Run from the Apex repo:

```bash
node scripts/check-config.mjs --config=profiles/minty.workflow.json
```

Validate paths against a target app:

```bash
node scripts/check-config.mjs \
  --config=profiles/minty.workflow.json \
  --target=/mnt/d/CURSOR/minty
```

## Harness Init

For a target app that does not have a profile yet, run:

```bash
npm run init -- --target=/path/to/app
```

For non-interactive agent installs, pass explicit adapter choices:

```bash
npm run init -- \
  --target=/path/to/app \
  --config-mode=auto \
  --yes
```

If the user wants to choose options:

```bash
npm run init -- \
  --target=/path/to/app \
  --config-mode=custom \
  --tracker=none \
  --code-intelligence=focused-search \
  --browser=none \
  --yes
```

The installer writes `apex.workflow.json`, updates `AGENTS.md`, validates the
profile, and links the local skill unless `--skip-skill-link` is passed.

## Profile Rules

- Keep app-specific names in the profile, not in `SKILL.md`.
- Prefer arrays of docs over prose paragraphs.
- Commands may include placeholders such as `{symbol}`, `{query}`, `{file}`, and `{changedFilesFile}`.
- `codeIntelligence.detectCommand` should accept a changed-files file placeholder when the provider supports scoped analysis.
- If a target app has no tracker, set `tracker.provider` to `none` and require explicit skip reasons in manifests.
