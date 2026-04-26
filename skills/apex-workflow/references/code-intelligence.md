# Code Intelligence

Use the profile's `codeIntelligence` adapter.

## GitNexus MCP Adapter

When `codeIntelligence.provider` is `gitnexus-mcp`:

1. Verify GitNexus MCP tools/resources are visible to the agent.
2. Read `gitnexus://repo/{name}/context` before graph-backed routing.
3. If stale, run `npx gitnexus analyze` from the target repo root.
4. Use `gitnexus_query` or `gitnexus_context` for unfamiliar ownership.
5. Run `gitnexus_impact` before non-trivial symbol edits.
6. Warn before proceeding when impact risk is high or critical.
7. Run `gitnexus_detect_changes` with manifest-owned changed files before finish.

Read `references/gitnexus-mcp.md` for install and wrapper fallback details.

## GitNexus Wrapper Adapter

When `codeIntelligence.provider` is `gitnexus-wrapper`, or when MCP fails and
`wrapperFallback.enabled` is true:

1. Run the configured wrapper status command.
2. Refresh only when stale and the work is medium, large, unfamiliar, or structural.
3. Use wrapper query/context for unfamiliar ownership.
4. Run wrapper impact before non-trivial symbol edits.
5. Run wrapper detect with a manifest-owned changed-files list before finish.

## Search-Only Adapter

When no graph tool is configured:

1. Use focused source search for owners and callers.
2. Read contracts before editing shared behavior.
3. Treat shared stores, shells, auth, and route owners as higher risk even without graph output.
4. Record the fallback in the manifest.

## Detect Changes

Prefer manifest-owned files over broad dirty-tree analysis.

Broad dirty-tree output is branch context. It is not proof that the current
slice stayed inside scope.
