# Tracker Adapters

Tracker state reflects execution. It does not define product truth unless the
profile explicitly says so.

## Record Work When

Use the profile's `tracker.recordWhen`. Default triggers:

- medium or large change
- user-facing flow, contract, or cross-surface behavior
- likely follow-up, coordination, or prioritization need
- roadmap, scope, acceptance-criteria, or sequencing change

Do not create busywork records for tiny edits with no durable execution value.

## Linear

When `tracker.provider` is `linear`:

- inspect existing related work before creating new issues
- update the best existing issue when it owns the same execution track
- keep active-coding state honest
- record last landed, next safe slice, no-touch surfaces, and verification

## GitHub Issues

When `tracker.provider` is `github`:

- search existing issues and PRs before creating new records
- use labels or milestones only if the repo already relies on them
- keep acceptance criteria concrete and testable

## File Tracker

When `tracker.provider` is `file`:

- use the configured tracker file
- keep entries compact and stateful
- do not turn the file into a narrative log

## None

When `tracker.provider` is `none`, record `tracker.disposition = none` in the
manifest and explain why durable tracking is not needed.

