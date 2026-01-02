# C - Causation (Etiology)

**Type:** Causal chains, root causes, mechanisms
**Collections:** causalChains, rootCauses, mechanisms
**Count:** 1 causal chain, 1 root cause, 1 mechanism

## Key Insights

### Root Cause Pattern
**assumption-over-verification** - Making assumptions instead of verifying documentation causes errors
- Example: Assumed slash command colon notation was filesystem convention
- Resolution: Always verify conventions before implementing
- Evidence: Multiple commits needed to fix (04be33e, 51b0fe0, cea1f0c, bdadc41)

### Mechanism Understanding
**Claude Code Slash Command Transformation**:
1. File: `.claude/commands/weave/extract.md`
2. CLI reads folder structure: `weave/extract`
3. Transforms to namespace:command format
4. Displays as: `/weave:extract`

Key: Filesystem uses **folders**, CLI transforms to **colons** for display

## When to Query Full Dimension

- Debugging root causes of issues
- Understanding system mechanisms
- Analyzing causal chains during post-mortems
- Creating retrospectives

**Note:** C dimension is **situational** - populates during debugging sessions and root cause analysis. Empty during normal feature work is expected.

## Query Commands

```bash
# Get root cause analysis
bun .agent/weave/scripts/query.ts causation:assumption-over-verification

# Search mechanisms
bun .agent/weave/scripts/search.ts --dimension=C "transform"

# Get all causal chains
cat .agent/weave/causation.json | jq '.causalChains'
```

---
*Shard: ~800 tokens | Full: ~700 tokens | Load full for: root cause analysis, mechanism understanding, debugging patterns*
