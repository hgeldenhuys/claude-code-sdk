# Π - Praxeology (Way of Working)

**Type:** WoW patterns, delegation strategies, best practices
**Collections:** wowPatterns, delegationStrategies, bestPractices
**Count:** 3 WoW patterns, 1 delegation strategy, 2 best practices

## Key Insights

### Critical WoW Patterns

**1. Context Preservation Through Delegation**
- **When**: Context >80% used, complex multi-step features, need architectural oversight
- **How**: Create TodoWrite task list → Delegate to specialized agents (backend-dev, frontend-dev, spec-writer) → Review outputs → Test integration
- **Benefits**: Preserves ~35K tokens for oversight and testing, maintains architectural vision
- **Evidence**: User said "ask subagents to make changes to preserve your remaining context"

**2. Plan Mode for Complex Features**
- **When**: Complex feature with unknowns, user wants explicit planning phase
- **How**: Activate Plan mode → Research patterns → Ask questions (AskUserQuestion) → Present plan → User approves → Execute with delegation
- **Benefits**: Clear plan before execution reduces errors, user can review/adjust, identifies missing info early

**3. Progressive Disclosure Architecture**
- **When**: Knowledge base >18K tokens, want fast startup, need selective loading
- **How**: Create summary.md (~500 tokens) → Shard by domain/dimension (~800-1K each) → Provide query scripts → Load summary at startup, query details on demand
- **Benefits**: 36x token reduction (18K → 500 at startup), scales to large knowledge bases

### Delegation Strategy

**Three-Agent Pattern for Full-Stack**:
- **backend-dev**: Data models, API logic, database ops, extraction/processing
- **frontend-dev**: UI components, display logic, user interactions, dashboards
- **spec-writer**: Documentation updates, README, slash commands, specs
- **When**: Complex features touching backend + frontend + docs, context pressure >80%

### Best Practices

1. **Ask Clarifying Questions in Plan Mode** - Use AskUserQuestion to resolve ambiguities before implementation
2. **Test Before Completing Todos** - Run monitor, validate JSON, verify functionality before marking complete

## When to Query Full Dimension

- Planning delegation strategy
- Learning context preservation techniques
- Understanding Plan mode workflow
- Implementing progressive disclosure

## Query Commands

```bash
# Get WoW pattern
bun .agent/weave/scripts/query.ts praxeology:context-preservation-through-delegation

# Search delegation strategies
bun .agent/weave/scripts/search.ts --dimension=Π "delegate"

# Get all patterns
cat .agent/weave/praxeology.json | jq '.wowPatterns'
```

---
*Shard: ~800 tokens | Full: ~1.8K tokens | Load full for: delegation planning, WoW implementation, context management*
