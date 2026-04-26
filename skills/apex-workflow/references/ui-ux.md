# UI/UX And Browser Verification

Use the profile's `uiUx` and `verification.browser` fields.

## Frontend Work

Before frontend or interaction changes:

1. Read configured design-system docs.
2. Identify whether the route or component has an existing design contract.
3. Preserve product truth and truthful UI affordances.
4. Verify loading, empty, error, disabled, and edge states when they are part of the behavior.

## Browser Evidence

Browser automation can prove:

- route reachability
- auth gating
- console/runtime errors
- basic interaction behavior
- obvious rendering failures

It is not visual signoff unless the profile explicitly allows that.

## Human Visual Signoff

When the profile says visual signoff is human-only, finish visible UI work with
a short checklist of what a human should inspect. Do not claim final visual
approval from screenshots.

