# Quickstart

This path proves Apex on a temporary demo target with no tracker, no GitNexus,
no browser automation, and no external accounts.

## 1. Verify Apex

From the Apex repo:

```bash
npm run self-check
```

## 2. Link Local Commands

```bash
npm link
```

This makes `apex-init`, `apex-doctor`, `apex-manifest`, and
`apex-check-config` available for local target repos.

## 3. Create A Demo Target

```bash
DEMO_TARGET="$(mktemp -d)"
cd "$DEMO_TARGET"
git init
cat > package.json <<'JSON'
{
  "name": "apex-demo-target",
  "private": true,
  "scripts": {
    "test": "node --version"
  }
}
JSON
printf '# Apex Demo Target\n' > README.md
printf '# Product\n\nA tiny local app for Apex verification.\n' > PRODUCT.md
printf 'node_modules/\ntmp/\n' > .gitignore
git add .
git -c user.email=apex@example.local -c user.name="Apex Test" commit -m baseline
```

## 4. Install Apex

```bash
apex-init \
  --target=. \
  --config-mode=custom \
  --tracker=none \
  --code-intelligence=focused-search \
  --browser=none \
  --yes
```

Commit the generated setup before the first slice:

```bash
git add AGENTS.md apex.workflow.json .gitignore
git -c user.email=apex@example.local -c user.name="Apex Test" commit -m "install Apex workflow"
```

## 5. Run Doctor

```bash
apex-doctor --target=. --config=apex.workflow.json --skip-commands
```

## 6. Open A Slice Manifest

```bash
apex-manifest new \
  --config=apex.workflow.json \
  --slug=quickstart-demo \
  --issue=none \
  --mode=tiny \
  --surface="README demo doc" \
  --files=README.md \
  --downshift="tiny: quickstart smoke touches one known doc" \
  --browser="skip: no UI in demo target" \
  --typecheck="skip: demo target has no typecheck" \
  --required="npm test"
```

## 7. Detect Scope

```bash
apex-manifest detect --config=apex.workflow.json --slug=quickstart-demo --write
```

## 8. Run A Check

```bash
apex-manifest run-check --config=apex.workflow.json --slug=quickstart-demo --cmd="npm test"
```

## 9. Close The Slice

Preview first:

```bash
apex-manifest close --config=apex.workflow.json --slug=quickstart-demo --preview-commands
```

Close using the already-recorded fresh `npm test` evidence:

```bash
apex-manifest close --config=apex.workflow.json --slug=quickstart-demo --skip-required --next=none
```

## 10. Read The Finish Packet

```bash
apex-manifest finish --config=apex.workflow.json --slug=quickstart-demo --next=none
```

The manifest is at `tmp/apex-workflow/quickstart-demo.json`. Command logs are
under `tmp/apex-workflow/logs/quickstart-demo/`.

## Automated Smoke

The same no-service path is exercised by:

```bash
npm run test:demo
```
