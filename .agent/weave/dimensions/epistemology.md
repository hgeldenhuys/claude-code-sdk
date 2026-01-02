# E - Epistemology (How we know)

**Type:** Knowledge confidence and provenance
**Collections:** patterns, validations
**Count:** 11 patterns, 2 validations

## Key Insights

### Critical Architectural Patterns
1. **CQRS Pattern** - GET (initial state) + SSE (delta updates) + POST/PUT/DELETE (commands)
2. **Real-time First** - PostgreSQL LISTEN/NOTIFY → SSE → UI. NEVER polling
3. **Idempotency at Database** - Prevent duplicates via UNIQUE constraints + onConflictDoNothing()
4. **Event-Driven Architecture** - Events are immutable (INSERT only, no UPDATE)
5. **Polymorphic Tables** - entity_type enum + entity_id (no FK on polymorphic columns)

### Testing Patterns
- **Hard Assertions Only** - Never use soft assertions that can pass when broken
- **API Contract Testing** - Test actual HTTP responses, not just service layers

### Development Patterns
- **Start Simple, Iterate** - Simple solution first, complexity only when proven necessary
- **Configuration Over Code** - Check config before debugging code (80% of issues)

## When to Query Full Dimension

- Understanding architecture patterns in depth
- Implementing new features (need CQRS/real-time examples)
- Debugging polymorphic table issues
- Learning testing standards

## Query Commands

```bash
# Get CQRS pattern details
bun .agent/weave/scripts/query.ts epistemology:cqrs-pattern

# Search for testing patterns
bun .agent/weave/scripts/search.ts --dimension=E "test"

# Get all patterns
cat .agent/weave/epistemology.json | jq '.patterns'
```

---
*Shard: ~800 tokens | Full: ~2.3K tokens | Load full for: architecture implementation, pattern validation, testing guidance*
