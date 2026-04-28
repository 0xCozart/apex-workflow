# Configuration

Apex Workflow is configured by `apex.workflow.json`.

## Top-Level Fields

- `version`: currently `1`
- `name`: app or repo name
- `authority`: product, execution, and workflow source lists
- `operatorCautions`: human-readable cautions that are not path authority, such as secret-handling or public/private repo boundaries
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
npm run check:config
```

Validate paths against a target app:

```bash
apex-check-config \
  --config=profiles/minty.workflow.json \
  --target=/path/to/app
```

## Harness Init

For a target app that does not have a profile yet, run:

```bash
apex-init --target=/path/to/app
```

For non-interactive agent installs, pass explicit adapter choices:

```bash
apex-init \
  --target=/path/to/app \
  --config-mode=auto \
  --yes
```

If the user wants to choose options:

```bash
apex-init \
  --target=/path/to/app \
  --config-mode=custom \
  --tracker=none \
  --code-intelligence=focused-search \
  --browser=none \
  --yes
```

The installer writes `apex.workflow.json`, updates `AGENTS.md`, validates the
profile, prints an install report, and links the local skill unless
`--skip-skill-link` is passed.

The install report includes:

- inferred authority and orientation paths with `confirmed`, `guessed`, or `generated` confidence
- tracker, code-intelligence, and browser choices
- code-intelligence availability split into configured preference, detected repo support, current host availability, and fallback command readiness
- target repo dirty state
- review items to resolve before the first implementation slice
- baseline checkpoint guidance when setup files are uncommitted

Use `--operator-cautions="Do not copy secrets, Keep public docs separate"` for
textual cautions. Do not put prose cautions in `authority.doNotUseAsAuthority`;
that field is path-like and the validator treats it as profile path data.

## Profile Rules

- Keep app-specific names in the profile, not in `SKILL.md`.
- Prefer arrays of docs over prose paragraphs.
- Commands may include placeholders such as `{symbol}`, `{query}`, `{file}`, and `{changedFilesFile}`.
- `codeIntelligence.detectCommand` should accept a changed-files file placeholder when the provider supports scoped analysis.
- `codeIntelligence.availability` records install-time readiness and host-session proof separately. Do not treat `provider = "gitnexus-mcp"` as proof that MCP tools are visible to the current agent.
- If a target app has no tracker, set `tracker.provider` to `none` and require explicit skip reasons in manifests.
- Review `setup.inferredPaths` before the first slice. Anything marked `guessed` is a candidate, not confirmed authority.
- Required path validation is exact-case. Fix `docs/ARCHITECTURE.md` to `docs/architecture.md` when that is the real file.

## Doctor

Use the doctor to answer whether the target repo is ready for its first
implementation slice:

```bash
apex-doctor \
  --target=/path/to/app \
  --config=apex.workflow.json
```

It checks unresolved installer review items, guessed inferred paths,
`tmp/apex-workflow/` ignore coverage, the managed `AGENTS.md` block, configured
adapter readiness, the skill symlink, and whether setup files have a clean git
baseline.

## Manifest Evidence

`manifest.defaultDir` should match the artifact's intended durability. Use a
committed docs/proof directory for reviewer evidence, or keep `tmp/apex-workflow`
only when the target repo intentionally treats selected tmp manifests as
durable artifacts.

Use `apex-manifest run-check` to record command results into the manifest:

```bash
apex-manifest \
  run-check \
  --config=apex.workflow.json \
  --slug=<slice> \
  --cmd="npm test"
```

Use `apex-manifest close` for generic slice closeout:

```bash
apex-manifest \
  close \
  --config=apex.workflow.json \
  --slug=<slice> \
  --next=none
```

`close` runs detect, required manifest checks, `git diff --check`, records the
results in `checks.runs`, and prints a finish packet from recorded evidence.
With `dirtyPolicy=owned-files-only`, `close` scopes `git diff --check` to
`ownedFiles`; if no owned files are listed, it records a skipped diff-check
entry instead of checking unrelated dirty work.

Record terminal, TUI, or operator evidence separately from automated commands:

```bash
apex-manifest \
  record-evidence \
  --config=apex.workflow.json \
  --slug=<slice> \
  --kind=manual-terminal \
  --summary="TUI resumed the real session id and side panel loaded"
```

Record GitNexus freshness separately from verification commands:

```bash
apex-manifest \
  record-gitnexus-freshness \
  --config=apex.workflow.json \
  --slug=<slice> \
  --phase=pre-status \
  --status=fresh \
  --command="npm run gitnexus:status"
```

`close` and standalone `finish` enforce this for GitNexus-enabled non-tiny
code slices. They require pre-slice status evidence and either post-slice
refresh evidence or a recorded skip reason.
