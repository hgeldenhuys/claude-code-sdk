# M - Mereology (How parts compose)

**Type:** Component hierarchies and part-whole relationships
**Collections:** components, compositions, hierarchy, partWholeRelations
**Count:** 5 layers, 6 compositions, 3 hierarchy levels

## Key Insights

### Layer Structure (Level 1)
1. **frontend-layer** - Web dashboard + CLI
2. **backend-layer** - API services and business logic
3. **data-layer** - Database, ORM, data access
4. **sdk-layer** - Reusable libraries (hooks-sdk, api-client, transcript-types)
5. **knowledge-layer** - Weave institutional memory system

### Applications & Packages (Level 2)
- **Applications**: web-application, cli-application, api-application
- **Packages**: db-package, hooks-sdk-package, api-client-package, transcript-types-package
- **Knowledge**: weave-knowledge-system

### Hierarchy
```
agios-platform (root)
├── frontend-layer
│   ├── web-application
│   └── cli-application
├── backend-layer
│   └── api-application
├── data-layer
│   └── db-package
├── sdk-layer
│   ├── hooks-sdk-package
│   ├── api-client-package
│   └── transcript-types-package
└── knowledge-layer
    └── weave-knowledge-system
```

## When to Query Full Dimension

- Understanding component structure
- Finding which layer a package belongs to
- Mapping part-whole relationships
- Architecture planning for new features

## Query Commands

```bash
# Get layer composition
bun .agent/weave/scripts/query.ts mereology:frontend-layer-composition

# Search components
bun .agent/weave/scripts/search.ts --dimension=M "web"

# Get hierarchy structure
cat .agent/weave/mereology.json | jq '.hierarchy'
```

---
*Shard: ~800 tokens | Full: ~1.7K tokens | Load full for: structural analysis, layer planning, component relationships*
