# Routing And Contracts

Find the owning surface before editing. A symbol hit is routing evidence, not final context.

## Route

1. Read profile orientation docs. If `docs/CODEBASE_MAP.md` is present but `Status: draft`, use it only as a scaffold
   and verify ownership in source. Treat it as routing authority only after
   `apex-map-codebase --check --require-reviewed` passes.
2. Use configured code-intelligence query/context when ownership is unclear.
3. Route from low-level symbols back to product surfaces.
4. Read feature artifacts and state contracts from the configured paths.
5. If contract docs are missing, use configured surrogates and name the gap.
6. Check overlapping dirty work in the same owner or shared surface.
7. For route-owner work, check shell leakage, auth parity, and unshipped handoffs.
8. Edit only after owner, contract, and blast radius are clear enough for the selected mode.

## Fallbacks

- Missing feature artifact: read state contracts, route inventory, design plans, or tests.
- Missing state contract: inspect the shared code directly and name the missing contract.
- Unavailable graph tooling: use focused source search and the profile's code map.
- Suspiciously low graph output: manually confirm practical callers.
- Code and docs disagree: say which appears stale before editing further.

## No-Touch Surfaces

Every meaningful manifest should list no-touch surfaces when the repo is dirty, when another agent may be working, or
when adjacent high-risk areas are visible.
