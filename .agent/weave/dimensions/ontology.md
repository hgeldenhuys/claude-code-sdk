# O - Ontology (What exists)

**Type:** Formal structure of entities, relations, and constraints
**Collections:** entities, relations, constraints
**Count:** 9 entities, 7 relations, 5 constraints

## Key Insights

### Core Platform Components
- **agios-platform** - Claude Code observability platform (root entity)
- **api-application** - ElysiaJS backend (apps/api) with SSE streaming
- **web-application** - React Router v7 dashboard (apps/web)
- **weave-knowledge-system** - 11D knowledge framework (.agent/weave)

### Critical Constraints
1. **no-polling-constraint** - NEVER use polling, use SSE/real-time streaming
2. **cqrs-pattern-constraint** - GET for initial state, SSE for delta updates
3. **database-idempotency-constraint** - Enforce at DB level, not application logic
4. **testing-protocol-constraint** - Always test yourself first with Chrome MCP
5. **field-naming-consistency** - Consistent camelCase or snake_case, never mix

### Relations
- Platform contains: API, Web, CLI
- API uses: Database package, Hooks SDK
- Web uses: API client package
- Platform uses: Weave knowledge system

## When to Query Full Dimension

- Understanding system architecture
- Adding new entities or components
- Verifying constraint requirements
- Mapping dependencies between packages

## Query Commands

```bash
# Get entity details
bun .agent/weave/scripts/query.ts ontology:agios-platform

# Search constraints
bun .agent/weave/scripts/search.ts --dimension=O "polling"

# Get all constraints
cat .agent/weave/ontology.json | jq '.constraints'
```

---
*Shard: ~800 tokens | Full: ~1.8K tokens | Load full for: architecture understanding, component relationships, constraint verification*
