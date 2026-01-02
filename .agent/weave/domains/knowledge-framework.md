# Knowledge Framework Domain (Weave)

**Overview:** 11-dimension institutional memory system for capturing and preserving project knowledge across sessions

## Evolution History

### Version Timeline
- **v1.0 (2025)** - 4D Framework
  - Q (Qualia) - What it's like: experiences, pain points, workflows
  - E (Epistemology) - How we know: patterns, validations
  - O (Ontology) - What exists: entities, relations, constraints
  - M (Mereology) - How parts compose: component hierarchies

- **v1.5 (2025)** - 7D Framework (added CAT)
  - C (Causation) - What caused what: causal chains, root causes
  - A (Axiology) - What is valuable: value judgments, tradeoffs
  - T (Teleology) - What is this for: purposes, goals, intents
  - Validated through A/B testing (mw-core comparison)

- **v2.0 (2025-11-22)** - 11D Framework (added ΗΠΜΔ)
  - Η (History) - How we got here: evolutions, timelines
  - Π (Praxeology) - How we work: WoW patterns, delegation
  - Μ (Modality) - What could be: alternatives, rejected options
  - Δ (Deontics) - What must/can/cannot be: obligations, prohibitions

## Key Components

### Dimension Files (.agent/weave/*.json)
- JSON format with structured collections per dimension
- Each item has: id, type, description, confidence (0.0-1.0), evidence
- Total: ~18K tokens across all 11 dimensions

### Scripts (.agent/weave/scripts/)
- **extraction.ts** - Extract knowledge from conversations using Claude API
- **monitor-simple.ts** - Display live 3-column dashboard of all dimensions
- **query.ts** - Query specific items by dimension:id
- **search.ts** - Search across dimensions by keyword
- **related.ts** - Find related items across dimensions

### Slash Commands (.claude/commands/weave/)
- **/weave:reflect** - Extract knowledge and update dimensions
- **/weave:extract** - Manual extraction from specific content
- Filesystem: folders (.claude/commands/weave/*.md)
- CLI display: colons (/weave:reflect)

### Monitor Dashboard
- 3-column × 4-row layout: `Q|E|O`, `M|C|A`, `T|Η|Π`, `Μ|Δ|Health`
- Real-time display of dimension item counts
- Color-coded health summary (green ≥10, yellow 5-9, red <5)
- Fits ~120 char terminal width

## Way of Working Patterns

### Context Preservation Through Delegation
- When context >80%, delegate implementation to specialized agents
- Preserves main context for oversight, testing, decision-making
- Pattern: TodoWrite → Delegate → Review → Test → Commit

### Plan Mode for Complex Features
- Activate Plan mode for research and design phase
- Ask clarifying questions (AskUserQuestion)
- User approves plan before execution
- Prevents assumptions and wrong implementations

### Comparative Validation Before Adoption
- A/B test framework changes before full adoption
- Quantitative metrics: insight count, confidence scores
- Example: Validated 7D > 4D through mw-core comparison
- Quality threshold: ≥0.85 confidence for new dimensions

## Situational Dimensions

**C (Causation)** and **A (Axiology)** are situational:
- C populates during: debugging sessions, root cause analysis, post-mortems
- A populates during: design sessions, tradeoff discussions, quality debates
- Empty during normal feature work is expected and normal

## Planned Evolution: Phase 2

### Progressive Disclosure (Token Optimization)
- **Current**: Load all dimensions at startup (~18K tokens)
- **Future**: Load summary.md (~500 tokens) + query details on demand
- **Architecture**: Skills with markdown sharding
  - summary.md - High-level overview (~500 tokens)
  - Domain shards - crm.md, realtime.md (~1K each)
  - Dimension shards - ontology.md, teleology.md (~800 each)
  - Query scripts - query.ts, search.ts, related.ts
- **Benefits**: 36x token reduction, faster session init, scales to large KBs
- **Status**: Planned but not yet implemented (deferred to test Phase 1 first)

## Related Dimensions

- **Η (History)**: Evolution timeline - `history:weave-7d-to-11d-expansion`
- **Π (Praxeology)**: WoW patterns - `praxeology:context-preservation-through-delegation`
- **Μ (Modality)**: Future plans - `modality:phase-2-progressive-disclosure`
- **T (Teleology)**: Purpose - `teleology:weave-7d-expansion-purpose`
- **A (Axiology)**: Value - `axiology:evidence-based-framework-decisions`

## Query Full Details

```bash
# Get Weave evolution history
bun .agent/weave/scripts/query.ts history:weave-7d-to-11d-expansion

# Search WoW patterns
bun .agent/weave/scripts/search.ts --dimension=Π "delegation"

# Get progressive disclosure plan
bun .agent/weave/scripts/query.ts modality:phase-2-progressive-disclosure

# Find all Weave-related items
bun .agent/weave/scripts/search.ts "weave framework"
```

---
*Domain shard: ~1100 tokens | Covers: evolution, components, patterns, future plans*
