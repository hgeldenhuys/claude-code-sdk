# T - Teleology (Purpose)

**Type:** Purposes, goals, intents, functions
**Collections:** purposes, goals, intents
**Count:** 2 purposes, 1 goal, 1 intent

## Key Insights

### Critical Purposes

**weave-7d-expansion-purpose** - WHY 7D framework exists
- Purpose: Capture richer institutional knowledge (C+A+T on top of Q+E+O+M)
- Rationale: WHY things exist (T), value judgments (A), cause-effect (C) are critical knowledge often lost
- Evidence: T dimension captured 8 high-value insights (0.94 confidence)

**feature-complete-documentation-purpose** - WHY comprehensive docs matter
- Purpose: Future sessions have complete context about what was built, why, and how to maintain
- Rationale: Without documentation, features become black boxes and knowledge is lost

### Goals

**validate-before-adopt** - Never adopt framework changes without evidence
- Success criteria: A/B comparison, ≥0.85 confidence, clear value over baseline
- Example: Weave 7D validated through mw-core comparison

### Intents

**correct-slash-command-installation** - Ensure commands work properly for future use
- Expected outcome: Commands appear correctly without duplicates after session restart

## When to Query Full Dimension

- Understanding WHY components exist
- Learning design goals and motivations
- Checking intent behind implementations
- Architectural decision context

## Query Commands

```bash
# Get purpose details
bun .agent/weave/scripts/query.ts teleology:weave-7d-expansion-purpose

# Search goals
bun .agent/weave/scripts/search.ts --dimension=T "validate"

# Get all purposes
cat .agent/weave/teleology.json | jq '.purposes'
```

---
*Shard: ~800 tokens | Full: ~750 tokens | Load full for: understanding motivations, design rationale, purpose analysis*
