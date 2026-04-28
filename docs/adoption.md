# Adoption

Use this when adopting Apex Workflow in a new app repo.

During local development, run `npm link` from the Apex repo once. Target repos
can then use the `apex-*` commands shown below. Inside the Apex repo, the
matching `npm run` scripts remain available for maintainers.

## 1. Default Harness Install

Run the installer:

```bash
apex-init --target=/path/to/app
```

For non-interactive agent installs, pass the target repo choices explicitly:

```bash
apex-init \
  --target=/path/to/app \
  --config-mode=custom \
  --tracker=none \
  --code-intelligence=focused-search \
  --browser=none \
  --yes
```

The installer will:

- infer app name, docs, package scripts, contracts, browser config, and code-intelligence support
- ask whether to auto-configure or choose options when run in an interactive terminal
- prompt for tracker/GitNexus/browser choices only in custom mode
- write `apex.workflow.json`
- create or update a managed Apex block in `AGENTS.md`
- validate the generated profile
- print a post-install report with inferred path confidence, adapter choices, repo dirty state, and next checkpoint guidance
- symlink the local `apex-workflow` skill unless `--skip-skill-link` is passed

Run the doctor before the first implementation slice:

```bash
apex-doctor --target=/path/to/app --config=apex.workflow.json
```

Treat failures as setup work, not product implementation work.

## 2. Profile Review

After install, review `apex.workflow.json`. The profile must answer:

- what docs define product truth
- what docs orient the agent before broad search
- which modes are allowed
- whether tracker state lives in Linear, GitHub, plain files, or nowhere
- whether code intelligence uses GitNexus, static search, or another tool
- where feature contracts and state contracts live
- which verification commands prove a slice
- how browser and UI/UX signoff should work

Also review:

- `setup.inferredPaths`: paths marked `guessed` need human or agent confirmation before the first implementation slice.
- `setup.reviewNeeded`: installer concerns that must be resolved or consciously accepted.
- `operatorCautions`: human-readable boundaries such as security, secret-handling, or public/private repo limits. These are not authority paths.

For GitNexus, prefer `codeIntelligence.provider = "gitnexus-mcp"`. Use the
wrapper fallback only when MCP is unavailable or unreliable in the target
environment.

Review `codeIntelligence.availability` separately from `provider`:

- `configuredPreference`: what the profile wants agents to use
- `detectedRepoSupport`: what install-time repo evidence found
- `currentHostAvailability`: whether this host/session has proven the MCP tools are visible
- `fallbackCommandReadiness`: whether wrapper commands are configured

If the installer could not infer product truth, contract docs, or broad-search
orientation, it records that in `setup.reviewNeeded`.

The validator checks required profile paths against the target repo and rejects
case mismatches such as `docs/ARCHITECTURE.md` when the real file is
`docs/architecture.md`.

If the install report says `baseline checkpoint: commit AGENTS.md/apex.workflow.json setup before the first implementation slice`, do that before starting product code. Mixing harness bootstrap with implementation weakens the first manifest and finish packet.

Create manifests by slug so `manifest.defaultDir` owns the artifact location:

```bash
apex-manifest new --config=apex.workflow.json --slug=app-123-slice ...
apex-manifest detect --config=apex.workflow.json --slug=app-123-slice
```

Run detect before implementation starts. In search-only repos, the built-in
detect still checks manifest validity and changed-file coverage, so it is useful
even without GitNexus. Reconciliation manifests default to
`dirtyPolicy=owned-files-only`: unrelated dirty files are recorded in
`scope.externalDirtyFiles` and `codeIntelligence.detect.externalDirtyFiles`,
but they do not fail the slice when the owned-file scope is clean.

If manifests are durable reviewer or grant evidence, set
`manifest.defaultDir` to a committed evidence path such as `.apex/manifests` or
`docs/proof/apex-workflow`. Keep `tmp/apex-workflow` only when the repo
intentionally commits selected tmp manifests.

Record verification outcomes as they run:

```bash
apex-manifest run-check --config=apex.workflow.json --slug=app-123-slice --cmd="npm test"
```

Record manual terminal/TUI evidence separately from automated checks:

```bash
apex-manifest record-evidence --config=apex.workflow.json --slug=app-123-slice --kind=manual-terminal --summary="TUI launched with selected provider and resumed the real session id"
```

Record GitNexus freshness evidence for GitNexus-enabled non-tiny code slices:

```bash
apex-manifest record-gitnexus-freshness --config=apex.workflow.json --slug=app-123-slice --phase=pre-status --status=fresh --command="npm run gitnexus:status"
```

If status is stale or missing, refresh and record `--phase=pre-refresh`. Before
finish, record either `--phase=post-refresh` for graph-relevant code changes or
`--phase=post-skip --status=skipped --reason="<why refresh is unnecessary>"`.

Finish with a generated packet:

```bash
apex-manifest close --config=apex.workflow.json --slug=app-123-slice --next=none
```

## 3. Repo Rules

The installer writes this managed behavior into `AGENTS.md`:

```md
Use $apex-workflow for meaningful execution.
Read apex.workflow.json before selecting a mode.
Review setup.reviewNeeded, setup.inferredPaths, and operatorCautions.
For code-facing work, create or update a slice manifest.
Use the configured tracker and code-intelligence adapters.
```

Keep project-specific rules in the target repo. Do not edit `apex-workflow`
when only one app's authority chain changed.

## 4. Skill Placement

The installer symlinks:

```text
<apex-workflow-repo>/skills/apex-workflow
```

into the Codex skills directory used by the machine.

Pass `--skip-skill-link` only when another install mechanism already handles
the skill.

## 5. Minimum Useful Adoption

The smallest good adoption has:

- one authority chain
- one orientation doc
- one tracker policy
- one verification command
- one browser or explicit browser-skip policy
- one manifest location

Do not add GitNexus, Linear, browser automation, or design handoff gates unless
the target app actually has them.
