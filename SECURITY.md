# Security And Trust Model

Apex profiles and manifests are trusted executable workflow configuration.

Some Apex commands run shell commands declared in `apex.workflow.json`, slice
manifests, or CLI arguments. Review profiles, manifests, and generated commands
before running Apex against an unfamiliar repository.

## Command Execution Surfaces

Apex may execute shell commands through:

- `apex-manifest run-check`
- `apex-manifest close`, when it runs required checks and diff checks
- profile verification commands such as `verification.requiredCommands`
- GitNexus wrapper fallback commands
- code-intelligence detect commands
- tracker, browser, and adapter status commands used by doctor/readiness checks

Command execution is intentional because Apex is a local workflow harness, not a
sandbox.

## Installer Writes

The installer may:

- write `apex.workflow.json`
- create or update the managed Apex block in `AGENTS.md`
- create or update the managed Apex block in `.gitignore`
- symlink the local `apex-workflow` skill into the configured Codex skills
  directory unless `--skip-skill-link` is passed

Use `--dry-run` before installing Apex into an unfamiliar repository.

## Untrusted Inputs

Do not run Apex against untrusted profiles, manifests, or repositories without
reviewing the generated commands first. Treat copied manifests and profiles like
shell scripts from the same source.

Secrets should never be stored in:

- `apex.workflow.json`
- manifests
- logs
- finish packets
- copied terminal output

Future audit-grade log capture must redact common secret-like values, cap output
tails, and avoid recording environment dumps by default.
