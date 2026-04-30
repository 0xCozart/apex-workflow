# Modes

Use the app profile's mode list as authority. These are the extracted defaults.

## tiny

Use for a single known file with low risk and no durable tracker state.

Required evidence:

- direct file read
- path-scoped check
- concise finish summary

Do not create tracker work unless the user explicitly wants it.

## route-local

Use when one owner is clear and callers are obvious.

Required evidence:

- manifest
- owner or contract read
- focused impact where relevant
- focused tests/checks
- scoped changed-file review before finish

## shared-surface

Use when a shell, store, hook, auth path, workspace state, route owner, or multi-route surface can affect neighbors.

Required evidence:

- manifest
- contract-first routing
- code-intelligence impact or documented fallback
- practical caller confirmation when graph output is suspicious
- broader verification matching the blast radius

Warn before edits when impact risk is high or critical.

## issue-resume

Use for named tracker issues, dirty branches, and multi-slice continuations.

Required evidence:

- latest tracker/plan/diff state
- next safe slice
- no-touch surfaces
- manifest for the current slice
- verification of the first real gap

Do not widen the issue just because adjacent problems are visible.

## planning

Use when the work is product, design, architecture, or workflow decision-making before code.

Required evidence:

- product authority read
- execution-state read when sequencing matters
- dated plan artifact when the decision must survive sessions
- plan validation when the profile configures it

## reconciliation

Use when implementation appears landed and remaining work is review, tracker, audit, or wait-state management.

Required evidence:

- reduced evidence packet
- tracker disposition
- no code-flow reopening unless a real implementation gap appears
