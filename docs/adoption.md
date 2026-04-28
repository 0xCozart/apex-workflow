# Adoption

Use this when adopting Apex Workflow in a new app repo.

## 1. Default Harness Install

Run the installer from the Apex repo:

```bash
npm run init -- --target=/path/to/app
```

For non-interactive agent installs, pass the target repo choices explicitly:

```bash
npm run init -- \
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
npm run doctor -- --target=/path/to/app --config=apex.workflow.json
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
npm run manifest -- new --config=apex.workflow.json --slug=app-123-slice ...
```

Finish with a generated packet:

```bash
npm run manifest -- finish --config=apex.workflow.json --slug=app-123-slice ...
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
/mnt/d/CURSOR/apex-workflow/skills/apex-workflow
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
