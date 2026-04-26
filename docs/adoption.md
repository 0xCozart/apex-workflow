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
- symlink the local `apex-workflow` skill unless `--skip-skill-link` is passed

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

For GitNexus, prefer `codeIntelligence.provider = "gitnexus-mcp"`. Use the
wrapper fallback only when MCP is unavailable or unreliable in the target
environment.

If the installer could not infer product truth, contract docs, or broad-search
orientation, it records that in `setup.reviewNeeded`.

## 3. Repo Rules

The installer writes this managed behavior into `AGENTS.md`:

```md
Use $apex-workflow for meaningful execution.
Read apex.workflow.json before selecting a mode.
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
