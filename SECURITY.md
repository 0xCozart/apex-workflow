# Security And Trust Model

Apex profiles and manifests are trusted executable workflow configuration.

Some Apex commands run shell commands declared in `apex.workflow.json`, slice manifests, or CLI arguments. Review
profiles, manifests, and generated commands before running Apex against an unfamiliar repository.

## Command Policy

Trusted local shell execution remains the default:

```json
{
  "security": {
    "commandPolicy": {
      "mode": "trusted-shell",
      "allowedCommands": [],
      "blockedShellTokens": []
    }
  }
}
```

Supported modes:

- `trusted-shell`: current local workflow behavior. Commands are treated as reviewed profile or manifest configuration.
- `allowlisted-shell`: commands must match one of `allowedCommands`. Patterns support exact strings, `*` wildcards, or
  `/regex/` strings.
- `restricted-shell`: raw shell strings are allowed unless they contain configured `blockedShellTokens`. If no tokens
  are configured, Apex blocks common chaining/substitution tokens.
- `exec-array-only`: schema-supported future strict mode. Current raw command execution is blocked when this mode is
  selected.

Use `apex-manifest close --preview-commands` before running unfamiliar command surfaces. `apex-doctor` reports the
active command policy and warns when an unreviewed profile still uses the trusted-shell default.

## Command Execution Surfaces

Apex may execute shell commands through:

- `apex-manifest run-check`
- `apex-manifest close`, when it runs required checks and diff checks
- profile verification commands such as `verification.requiredCommands`
- GitNexus wrapper fallback commands
- code-intelligence detect commands
- tracker, browser, and adapter status commands used by doctor/readiness checks

Command execution is intentional because Apex is a local workflow harness, not a sandbox.

## Installer Writes

The installer may:

- write `apex.workflow.json`
- create or update the managed Apex block in `AGENTS.md`
- create or update the managed Apex block in `.gitignore`
- symlink the local `apex-workflow` skill into the configured Codex skills directory unless `--skip-skill-link` is
  passed

Use `--dry-run` before installing Apex into an unfamiliar repository.

## Untrusted Inputs

Do not run Apex against untrusted profiles, manifests, or repositories without reviewing the generated commands first.
Treat copied manifests and profiles like shell scripts from the same source.

Secrets should never be stored in:

- `apex.workflow.json`
- manifests
- logs
- finish packets
- copied terminal output

Manifest command logs redact common secret-like values, cap manifest output tails, and record command timeouts. Apex
does not record environment dumps by default. If `verification.envAllowlist` is configured, Apex fingerprints the
selected values for freshness without storing raw environment values.

## Security And Supply-Chain Checks

Local checks:

```bash
npm run check:security
npm run check:supply-chain
```

`check:security` runs `npm audit --audit-level=moderate`. `check:supply-chain` writes an npm SBOM to
`tmp/apex-workflow/sbom.json`, which is ignored local artifact space.

GitHub automation includes:

- Dependabot updates for npm dependencies and GitHub Actions.
- `.github/workflows/security.yml` for npm audit, SBOM generation, and CodeQL analysis. Dependency and SBOM checks run
  on pull requests with `contents: read`; CodeQL runs on push and schedule with `security-events: write` so fork pull
  requests do not fail because they cannot upload security events.

When reviewing dependency or security update PRs:

- Read the dependency changelog for install scripts, transitive dependency changes, and Node/runtime requirements.
- Run `npm run self-check`, `npm run check:security`, and `npm run check:supply-chain`.
- For GitHub Actions updates, review action permissions and runtime changes before merging.
- Treat generated SBOM files as local artifacts unless a future release process explicitly publishes them.

Repository secret scanning should be enabled in GitHub settings where available. Do not add test secrets to fixtures to
prove scanning.
