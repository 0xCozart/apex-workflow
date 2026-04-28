# Code Intelligence

Use the profile's `codeIntelligence` adapter.

Read `codeIntelligence.availability` before assuming graph tooling is usable:

- `configuredPreference`: preferred adapter from the profile
- `detectedRepoSupport`: install-time evidence in the target repo
- `currentHostAvailability`: current agent/session proof, especially for MCP tools
- `fallbackCommandReadiness`: wrapper fallback command state

## GitNexus MCP Adapter

When `codeIntelligence.provider` is `gitnexus-mcp`:

1. Verify GitNexus MCP tools/resources are visible to the agent.
2. Read `gitnexus://repo/{name}/context` before graph-backed routing.
3. If stale, run `npx gitnexus analyze` from the target repo root.
4. Use `gitnexus_query` or `gitnexus_context` for unfamiliar ownership.
5. Run `gitnexus_impact` before non-trivial symbol edits.
6. Warn before proceeding when impact risk is high or critical.
7. Run `gitnexus_detect_changes` with manifest-owned changed files before finish.
8. Record the manifest freshness gate before close.

Read `references/gitnexus-mcp.md` for install and wrapper fallback details.

## GitNexus Wrapper Adapter

When `codeIntelligence.provider` is `gitnexus-wrapper`, or when MCP fails and
`wrapperFallback.enabled` is true:

1. Run the configured wrapper status command.
2. Refresh only when stale and the work is medium, large, unfamiliar, or structural.
3. Use wrapper query/context for unfamiliar ownership.
4. Run wrapper impact before non-trivial symbol edits.
5. Run wrapper detect with a manifest-owned changed-files list before finish.
6. Record the manifest freshness gate before close.

## Freshness Gate

For GitNexus-enabled non-tiny code slices, Apex requires freshness evidence in
the slice manifest before `close` or standalone `finish`:

- `preSliceStatus`: always required.
- `preSliceRefresh`: required when status is `stale`, `missing`, or marked
  `refreshRequired`.
- `postSliceRefresh`: required after graph-relevant code changes.
- `postSliceSkipReason`: required when post-slice refresh is intentionally
  skipped.

Record the gate explicitly:

```bash
apex-manifest \
  record-gitnexus-freshness \
  --config=apex.workflow.json \
  --slug=<slice> \
  --phase=pre-status \
  --status=fresh \
  --command="npm run gitnexus:status"
```

Use `--phase=pre-refresh --status=refreshed` after a required refresh. Use
`--phase=post-refresh --status=refreshed --graph-relevant=true` when changed
code should update the graph for the next slice. Use
`--phase=post-skip --status=skipped --reason="docs-only slice"` only when the
change does not affect future graph reasoning.

## Search-Only Adapter

When no graph tool is configured:

1. Use focused source search for owners and callers.
2. Read contracts before editing shared behavior.
3. Treat shared stores, shells, auth, and route owners as higher risk even without graph output.
4. Run `apex-manifest detect` anyway. The helper performs built-in changed-file coverage when no `detectCommand` exists.
5. Record the fallback in the manifest.

## Detect Changes

Prefer manifest-owned files over broad dirty-tree analysis.

Broad dirty-tree output is branch context. It is not proof that the current
slice stayed inside scope.

When `codeIntelligence.detectCommand` is missing, `apex-manifest detect` checks
the current dirty tree against `ownedFiles`. Changed files outside the current
manifest fail the detect step unless they are the manifest artifact itself.
The exception is an explicit `dirtyPolicy=owned-files-only`, which is the
default for reconciliation mode. In that mode, unrelated dirty files are
recorded in the manifest as external state and detect only fails when the
owned-file scope itself fails.
