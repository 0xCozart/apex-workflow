# Minty Profile

Minty is the first extracted Apex Workflow profile.

## Authority

- Product truth: `minty_master_plan_prd.md`
- Execution truth: `minty_master_plan_tracker.md`
- Workflow rules: `AGENTS.md`, `CLAUDE.md`, `docs/CODEBASE_MAP.md`
- Do not use as authority: `PRODUCT_THESIS.md`

## Tooling

- Tracker: Linear, team `XMinty`, project `Minty Master Plan Alignment`
- Code intelligence: repo-local GitNexus wrapper
- Browser: `agent-browser`, default origin `http://127.0.0.1:3000`
- Known failures: `docs/runbooks/known-verification-failures.md`

## Design Rule

For Minty, browser evidence is functional-only. Visible UI changes still need a human visual audit checklist.

## Skill Mapping

- `minty-exec` -> Apex mode selection and manifest kernel
- `minty-contract-routing` / `minty-route-first` -> routing and contracts reference
- `minty-linear-chief` -> tracker adapter
- `minty-product-ops` -> product authority and planning behavior
- `agent-browser` Minty notes -> browser policy
