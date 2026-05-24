# SpectraCleanse Engineering Plugin – Installation and Validation

This document explains how to install and validate the `spectracleanse-engineering` plugin locally before relying on it in engineering workflows.

---

## Installation

### Option 1: Point Claude at the plugin directory

From the SpectraCleanse repo root:

```bash
claude --plugin-dir ./spectracleanse-engineering
```

This loads the plugin for a single Claude session.

### Option 2: Add to Claude settings

Add to your `.claude/settings.json` (create if it doesn't exist):

```json
{
  "pluginDirs": [
    "./spectracleanse-engineering"
  ]
}
```

This loads the plugin for all Claude sessions in the SpectraCleanse repo directory.

### Option 3: Global plugin registration

If you want the plugin available from any directory:

```json
// ~/.claude/settings.json
{
  "pluginDirs": [
    "/absolute/path/to/SpectraCleanse/spectracleanse-engineering"
  ]
}
```

---

## Plugin structure validation

After installing, verify the plugin structure is intact:

```bash
# From the spectracleanse-engineering directory:
ls .claude-plugin/plugin.json          # Plugin manifest
ls skills/                              # 9 skill directories
ls agents/                              # 2 agent files
ls docs/                                # 6 doc files
ls .mcp.json.example                    # MCP config template
ls README.md CHANGELOG.md              # Plugin docs
```

Expected output:
```
skills/
  spectracleanse-code-review/SKILL.md
  spectracleanse-architecture/SKILL.md
  spectracleanse-deploy-readiness/SKILL.md
  spectracleanse-processing-pipeline/SKILL.md
  spectracleanse-auth-billing/SKILL.md
  spectracleanse-incident-response/SKILL.md
  spectracleanse-documentation/SKILL.md
  spectracleanse-testing-strategy/SKILL.md
  spectracleanse-founder-operating-review/SKILL.md

agents/
  spectracleanse-repo-researcher.md
  spectracleanse-incident-commander.md

docs/
  product-context.md
  render-deploy-checklist.md
  mcp-roadmap.md
  supported-formats-and-processing-boundaries.md
  env-and-secrets-reference.md
  plugin-validation.md
```

---

## Schema validation

The plugin manifest (`.claude-plugin/plugin.json`) follows the Claude plugin schema. Validate it:

```bash
# Check JSON syntax
python3 -c "import json; json.load(open('spectracleanse-engineering/.claude-plugin/plugin.json')); print('JSON valid')"

# Check all referenced skill paths exist
python3 - << 'EOF'
import json, os
manifest = json.load(open('spectracleanse-engineering/.claude-plugin/plugin.json'))
for skill in manifest.get('skills', []):
    path = os.path.join('spectracleanse-engineering', skill['path'])
    status = '✅' if os.path.exists(path) else '❌ MISSING'
    print(f"{status} {path}")
for agent in manifest.get('agents', []):
    path = os.path.join('spectracleanse-engineering', agent['path'])
    status = '✅' if os.path.exists(path) else '❌ MISSING'
    print(f"{status} {path}")
EOF
```

---

## Manual validation checklist

After loading the plugin in Claude, test each skill by description-matching:

### Skill availability

Ask Claude: _"What skills do you have for SpectraCleanse?"_
Expected: Claude should list and briefly describe the 9 SpectraCleanse skills.

### Code review skill

Ask Claude: _"Review this change to server.js: I moved the stripe-webhook route to after express.json()."_
Expected: Claude should immediately flag this as a critical regression (breaks Stripe webhook signature verification) using the `spectracleanse-code-review` skill's escalation rules.

### Deploy readiness skill

Ask Claude: _"Run the deploy readiness checklist for SpectraCleanse."_
Expected: Claude should produce a structured checklist with Node version, env vars, CORS, DB persistence, Stripe, and smoke test sections.

### Processing pipeline skill

Ask Claude: _"Does SpectraCleanse support WAV files for Full Server Cleanse?"_
Expected: Claude should correctly say WAV is accepted by Multer but rejected by the processor with HTTP 422, and direct users to convert to M4A/MP4. Should NOT say WAV is supported.

### Auth/billing skill

Ask Claude: _"A user upgraded to Creator but still sees Free plan. Walk me through debugging this."_
Expected: Claude should walk through Stripe webhook delivery, `session.metadata.userId`, DB plan column, `/api/me` refresh — in the order defined by the skill.

### Incident response skill

Ask Claude: _"Production is down — spectracleanse.com isn't loading."_
Expected: Claude should ask for or attempt `/api/health` check first, then provide ranked hypotheses (broken deploy, missing env vars, CORS) with a severity assessment.

### Documentation skill

Ask Claude: _"Write updated README format support documentation."_
Expected: Claude should correctly limit server-side support to MP4/M4A, note Quick Cleanse for MP3, and explicitly NOT claim WAV/FLAC are supported by Full Server Cleanse.

### Founder operating review skill

Ask Claude: _"Run my SpectraCleanse operating review."_
Expected: Claude should ask for or look up recent git log, then produce Shipped/In Progress/Risks/Friction/Highest-leverage next move/Next 3 actions format.

---

## MCP configuration (optional)

To enable MCP tools:

```bash
# Copy the example and fill in real values
cp spectracleanse-engineering/.mcp.json.example .mcp.json
# Edit .mcp.json with your actual tokens
# NEVER commit .mcp.json to version control
```

Add `.mcp.json` to `.gitignore`:
```bash
echo ".mcp.json" >> .gitignore
```

---

## Updating the plugin

When the SpectraCleanse codebase changes significantly:

1. Re-read the affected source files (`server.js`, `cleansePolicy.js`, `app.tsx`, `.env.example`)
2. Update the relevant SKILL.md file(s) with accurate facts
3. Update `docs/product-context.md` if stack facts changed
4. Update `CHANGELOG.md` with the change and date
5. Update `docs/env-and-secrets-reference.md` if env vars changed
6. Update `docs/supported-formats-and-processing-boundaries.md` if format support changed

The plugin is only as accurate as its last update. Treat it like documentation — it drifts if not maintained.

---

## Known schema uncertainty

The Claude plugin schema is evolving. If the `plugin.json` format changes:
- Check the latest Claude / Claude Code documentation for the current plugin manifest schema
- The `skills[].path` and `agents[].path` fields may change to `skills[].skillPath` or similar
- The `docs` array in the manifest may not be a standard field — if Claude doesn't recognize it, remove it without affecting skill or agent loading

The skills and agents will work regardless of schema version as long as `skills[].path` points to valid SKILL.md files.
