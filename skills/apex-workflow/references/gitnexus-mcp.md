# GitNexus MCP And Wrapper Fallback

Use GitNexus as MCP first when the target repo chooses GitNexus.

## MCP Install Contract

The installing agent should:

1. Add the GitNexus MCP server to the host agent's MCP configuration.
2. From the target repo root, build the index:

```bash
npx gitnexus analyze
```

3. Restart or reload the agent session if the host requires MCP reloads.
4. Verify the agent can see GitNexus MCP tools and resources:
   - `gitnexus_query`
   - `gitnexus_context`
   - `gitnexus_impact`
   - `gitnexus_detect_changes`
   - `gitnexus_rename`
   - `gitnexus://repo/{name}/context`

If the host's GitNexus package exposes a different MCP server command, use that
host/package command. The Apex profile records the desired behavior, not one
hard-coded MCP transport command.

## MCP Usage

- Read `gitnexus://repo/{name}/context` before graph-backed routing.
- If the index is stale, run `npx gitnexus analyze`.
- Use `gitnexus_query` and `gitnexus_context` to find owners.
- Use `gitnexus_impact` before non-trivial symbol edits.
- Use `gitnexus_detect_changes` before finish with the current manifest file list.

## Wrapper Fallback

If MCP fails because of local storage, package/runtime, transport, stale reload,
or host config problems, use a repo-local wrapper fallback instead of blocking
the work.

The wrapper should expose the same intent:

```json
{
  "scripts": {
    "gitnexus": "node scripts/run-gitnexus-local.mjs",
    "gitnexus:status": "node scripts/run-gitnexus-local.mjs status",
    "gitnexus:analyze": "node scripts/run-gitnexus-local.mjs analyze",
    "gitnexus:ensure-fresh": "node scripts/run-gitnexus-local.mjs ensure-fresh"
  }
}
```

Minimum wrapper behavior:

- isolate GitNexus home/config if the host global config is fragile
- provide `status`, `analyze`, `query`, `context`, `impact`, and `detect_changes`
- accept an explicit changed-files file for scoped detect
- fall back to focused source search when graph output is unavailable or suspicious

The wrapper is a fallback path, not the preferred install path.

