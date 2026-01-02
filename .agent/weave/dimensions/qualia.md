# Q - Qualia (What it's like)

**Type:** Experiential knowledge and patterns
**Collections:** painPoints, solutions, workflows, bestPractices
**Count:** 2 painPoints, 1 solution, 5 workflows, 7 bestPractices

## Key Insights

### Critical Workflows
1. **Session Initialization** - MANDATORY workflow before any work: read SESSION-INIT.md and DESIGN-PRINCIPLES.md
2. **Test Writing** - Read .env FIRST, use hard assertions only, test HTTP API contracts
3. **Debugging Hierarchy** - Check configuration before code (80% issues are config, 15% environment, 5% code)

### Best Practices (High Priority)
- **Never Make Assumptions** - Ask clarifying questions when unclear (SESSION-INIT.md:8-14)
- **Test Before Claiming Success** - Always test yourself with Chrome MCP first (SESSION-INIT.md:26-32)
- **Start Simple First** - Try ORDER BY before is_latest flags, WHERE before caching (SESSION-INIT.md:33-38)
- **Check .env Before Tests** - NEVER hardcode configuration (SESSION-INIT.md:40-54)
- **Verify Before Assuming Missing** - Direct database queries before rebuilding features (SESSION-INIT.md:101-104)

## When to Query Full Dimension

- Need detailed pain point analysis
- Creating new workflows or best practices
- Understanding project-specific lessons learned
- Debugging user correction patterns

## Query Commands

```bash
# Get specific workflow
bun .agent/weave/scripts/query.ts qualia:session-initialization-workflow

# Search workflows
bun .agent/weave/scripts/search.ts --dimension=Q "test"

# Get all best practices
cat .agent/weave/qualia.json | jq '.bestPractices'
```

---
*Shard: ~800 tokens | Full: ~2.5K tokens | Load full for: detailed analysis, workflow creation, lesson documentation*
