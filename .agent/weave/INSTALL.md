# Weave Installation Guide

Install the Weave 11D knowledge framework in any project.

## Quick Install

```bash
# 1. Copy Weave to new project
cp -r /path/to/agios/.agent/weave /path/to/new-project/.agent/
cp -r /path/to/agios/.claude/commands/weave /path/to/new-project/.claude/commands/
cp /path/to/agios/.claude/skills/weave.md /path/to/new-project/.claude/skills/

# 2. Add Weave summary to CLAUDE.md (automatic loading)
cat /path/to/agios/.agent/weave/summary.md >> /path/to/new-project/.claude/CLAUDE.md

# 3. Install slash commands (if needed)
cd /path/to/new-project
bun .agent/weave/weave.ts install

# 4. Restart Claude Code session
# Weave knowledge is now automatically available!
```

## What Gets Installed

Based on `.agent/weave/manifest.json`:

### Core Framework (Required)
- `.agent/weave/*.json` - 11 dimension files (Q+E+O+M+C+A+T+Η+Π+Μ+Δ)
- `.agent/weave/meta.json` - Framework metadata
- `.agent/weave/extraction.ts` - Knowledge extraction engine
- `.agent/weave/monitor-simple.ts` - Real-time monitor
- `.agent/weave/README.md` - Framework documentation

### Progressive Disclosure (Recommended)
- `.agent/weave/summary.md` - Lightweight summary (~219 tokens)
- `.agent/weave/dimensions/*.md` - 11 dimension shards (~500 tokens each)
- `.agent/weave/domains/*.md` - Domain-specific shards (~1K tokens each)
- `.agent/weave/scripts/*.ts` - Query scripts (query, search, related, generate-summary)
- `.claude/skills/weave.md` - Progressive disclosure skill

### Knowledge Capture (Optional)
- `.claude/commands/weave/reflect.md` - Capture conversational insights
- `.claude/commands/weave/extract.md` - Extract from code files

## Namespace Convention

All Weave components use the `weave` namespace:
- Skill: `weave` (invoke with skill name "weave")
- Slash commands: `/weave:reflect`, `/weave:extract`
- Files: `.agent/weave/*`, `.claude/commands/weave/*`

This makes it easy to identify and update Weave components.

## Usage After Installation

### 1. Load Knowledge (Progressive Disclosure)

```bash
# Load lightweight summary at session start (~219 tokens)
cat .agent/weave/summary.md

# Query specific details on demand
bun .agent/weave/scripts/query.ts π:context-preservation-through-delegation
bun .agent/weave/scripts/search.ts "delegation"
bun .agent/weave/scripts/related.ts agios-platform
```

### 2. Capture New Knowledge

```bash
# After conversations, capture insights
/weave:reflect

# After editing code files
/weave:extract <file-path>
```

### 3. Monitor Knowledge Growth

```bash
# Real-time dashboard of all 11 dimensions
bun .agent/weave/monitor-simple.ts
```

## Token Budget

- **Full load**: ~18,000 tokens (all 11 dimension JSON files)
- **Progressive load**: ~219 tokens (summary.md only)
- **Reduction**: 82x (98.8% savings)

Load the summary at session start, query details only when needed.

## Customization for Your Project

### 1. Clear Existing Knowledge (Optional)

Start fresh with empty dimensions:

```bash
cd .agent/weave
for file in *.json; do
  if [ "$file" != "meta.json" ]; then
    # Reset collections to empty objects
    bun ../scripts/reset-dimension.ts "$file"
  fi
done
```

### 2. Create Project-Specific Domains

Add domain shards in `.agent/weave/domains/`:

```markdown
# my-domain.md

**Overview:** Your domain description

## Entities
...

## Key Patterns
...
```

### 3. Capture Initial Knowledge

Run `/weave:reflect` on early conversations to bootstrap the knowledge base.

## Maintenance

### Regenerate Summary

After capturing new knowledge:

```bash
bun .agent/weave/scripts/generate-summary.ts
```

### Update Dimension Shards

Manually update `.agent/weave/dimensions/*.md` to reflect important new insights.

### Version Tracking

Check `.agent/weave/meta.json` for framework version:

```json
{
  "version": "2.0.0",
  "dimensions": 11,
  "frameworkEvolution": "4D → 7D → 11D"
}
```

## Verification

Test that installation worked:

```bash
# 1. Check files exist
ls .agent/weave/manifest.json
ls .agent/weave/summary.md
ls .agent/weave/scripts/query.ts

# 2. Test query scripts
bun .agent/weave/scripts/search.ts "test"

# 3. Verify skill loaded (restart Claude Code first)
# Type "weave" and it should autocomplete
```

## Troubleshooting

**Slash commands not appearing:**
- Run `bun .agent/weave/weave.ts install`
- Restart Claude Code session

**Query scripts fail:**
- Ensure Bun is installed: `bun --version`
- Check script permissions: `chmod +x .agent/weave/scripts/*.ts`

**Dimension files corrupted:**
- Validate JSON: `bun -e "JSON.parse(require('fs').readFileSync('.agent/weave/qualia.json', 'utf8'))"`
- Restore from backup or re-run `/weave:reflect`

## Support

See `.agent/weave/README.md` for complete framework documentation.
