# Η - History (Temporal Evolution)

**Type:** Evolutions, timelines, legacy patterns
**Collections:** evolutions, timelines, legacyPatterns
**Count:** 2 evolutions, 1 timeline, 0 legacy patterns

## Key Insights

### Framework Evolution Timeline

**Weave Framework Progression**:
- **v1.0 (2025)** - 4D Framework (Q+E+O+M)
- **v1.5 (2025)** - 7D Framework (added C+A+T, validated via A/B testing)
- **v2.0 (2025-11-22)** - 11D Framework (added Η+Π+Μ+Δ for temporal, praxeological, modal, deontic knowledge)

### Critical Evolution: 7D to 11D Expansion

**When**: 2025-11-22
**Why**: Capture knowledge previously invisible - temporal evolution, WoW patterns, design alternatives, rules/obligations
**Impact**: Framework can now capture historical context, delegation strategies, rejected options, MUST/MAY/MUST NOT patterns
**Migration**: Created 4 new JSON files, updated extraction.ts with prompts, modified monitor for 3-column layout
**Evidence**: Commit 831aa1e, version bump 1.0.0 → 2.0.0

### Inflection Points
1. Comparative validation methodology established (A/B testing for framework changes)
2. Progressive disclosure architecture planned (Phase 2)
3. Agent delegation strategy for context preservation

## When to Query Full Dimension

- Understanding framework evolution
- Learning from past decisions
- Checking why changes were made
- Planning future expansions

## Query Commands

```bash
# Get evolution details
bun .agent/weave/scripts/query.ts history:weave-7d-to-11d-expansion

# Search timeline
bun .agent/weave/scripts/search.ts --dimension=Η "framework"

# Get all evolutions
cat .agent/weave/history.json | jq '.evolutions'
```

---
*Shard: ~800 tokens | Full: ~900 tokens | Load full for: evolution analysis, timeline context, migration planning*
