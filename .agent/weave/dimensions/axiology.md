# A - Axiology (Value)

**Type:** Value judgments, tradeoffs, quality metrics
**Collections:** valueJudgments, tradeoffs, qualityMetrics
**Count:** 2 value judgments, 1 tradeoff, 1 quality metric

## Key Insights

### Value Judgments
1. **evidence-based-framework-decisions** - Comparative validation (A/B testing) superior to intuition
   - Example: Weave 7D validated through mw-core comparison
   - Result: Proved T adds value (8 insights, 0.94 confidence)

2. **user-corrections-are-valuable** - Treat corrections as high-priority learning opportunities
   - User knows domain better than AI
   - Immediate verification builds trust

### Quality Metrics
**Framework Validation Standard**: New dimensions must capture insights with ≥0.85 confidence to be valuable
- T dimension: 8 insights, 0.94 confidence = valuable ✓
- C+A dimensions: 0 insights = situational (still valuable)

### Tradeoffs
**multiple-commits-for-correctness** - Accepted transparent learning process (4 commits) over clean git history
- Rationale: Learning transparency > hiding mistakes

## When to Query Full Dimension

- Making design decisions with tradeoffs
- Evaluating framework changes
- Understanding quality standards
- Learning from value judgments

**Note:** A dimension is **situational** - populates during design sessions and tradeoff discussions. Empty during implementation is expected.

## Query Commands

```bash
# Get value judgment
bun .agent/weave/scripts/query.ts axiology:evidence-based-framework-decisions

# Search quality metrics
bun .agent/weave/scripts/search.ts --dimension=A "quality"

# Get all tradeoffs
cat .agent/weave/axiology.json | jq '.tradeoffs'
```

---
*Shard: ~800 tokens | Full: ~750 tokens | Load full for: design decisions, quality evaluation, tradeoff analysis*
