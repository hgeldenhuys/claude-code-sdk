You are executing the `/librarian:find` command to search the semantic file index for relevant files.

## Purpose

Find files based on conceptual queries ("which file handles campaign creation?") using the Librarian's semantic index.

## Workflow

**Step 1: Read the Index**

Read `.agent/librarian/index.json` to load the semantic index.

**Step 2: Parse User Query**

Extract the user's query from the command:
```
/librarian:find campaign creation logic
→ query: "campaign creation logic"
```

**Step 3: Search Strategy**

Use multi-dimensional search across:

1. **Concept Map** - Check if query matches known concepts
   - Example: "campaign creation" → conceptMap.campaign-management

2. **Key Concepts** - Search files.*.keyConcepts arrays
   - Example: "real-time" → files with keyConcepts: ["real-time", "SSE"]

3. **Queries Array** - Match against files.*.queries
   - Example: "how to implement SSE" → files with matching query strings

4. **Domain/Layer** - Filter by domain or layer if mentioned
   - Example: "auth routes" → byDomain.auth + byLayer.routes

5. **Architectural Patterns** - Match against known patterns
   - Example: "CQRS example" → byPattern.CQRS

**Step 4: Rank Results**

Score each file by relevance:
- Concept map match: 0.95 relevance
- Key concept exact match: 0.9 relevance
- Query array match: 0.85 relevance
- Domain match: 0.75 relevance
- Pattern match: 0.75 relevance

Return top 3-5 files sorted by relevance.

**Step 5: Format Response**

```markdown
## Search Results: "campaign creation logic"

### High Confidence Recommendations

**1. apps/api/src/modules/crm/services/campaigns.service.ts** (95% relevance)
- **Purpose:** Campaign CRUD operations, scheduling, recipient management
- **Why:** Primary service layer for campaign creation
- **Layer:** service
- **Domain:** campaigns
- **Key Concepts:** CRUD, campaigns, scheduling, templates
- **Related Files:**
  - apps/api/src/modules/crm/routes/campaigns.ts (HTTP endpoints)
  - packages/db/src/schema/campaigns.ts (database schema)

**2. apps/api/src/modules/crm/routes/campaigns.ts** (85% relevance)
- **Purpose:** HTTP routes for campaign endpoints
- **Why:** Exposes campaign creation via POST /campaigns
- **Layer:** routes
- **Domain:** campaigns
- **API Endpoints:** GET /campaigns, POST /campaigns, GET /campaigns/:id

**3. packages/db/src/schema/campaigns.ts** (75% relevance)
- **Purpose:** Campaign database schema definition
- **Why:** Defines campaign structure and fields
- **Layer:** schema
- **Domain:** campaigns

### Related Concepts

- templates (message templates for campaigns)
- recipients (campaign recipient management)
- scheduling (campaign send schedules)
- channels (multi-channel delivery)

### Architectural Notes

- Uses CQRS pattern for campaign queries
- Campaign creation triggers background jobs (pg-boss)
- Real-time updates via SSE when campaigns change

### Next Steps

1. Read `campaigns.service.ts` for business logic
2. Check `campaigns.ts` routes for HTTP API contract
3. Review `campaigns.ts` schema for database structure
```

**Step 6: Handle Edge Cases**

**No Results:**
```markdown
## No Files Found: "your query"

The index doesn't contain files matching this query.

**Suggestions:**
- Try different keywords (e.g., "auth" instead of "authentication")
- Check if feature exists in codebase
- Use grep for exact string matching: `grep -r "your-term" apps/`
- Ask Shadow Advisor about architectural patterns first
```

**Ambiguous Query:**
```markdown
## Ambiguous Query: "campaign"

This query matches multiple concepts. Please be more specific:

1. **Campaign Creation** - `/librarian:find campaign creation`
2. **Campaign Templates** - `/librarian:find campaign templates`
3. **Campaign Scheduling** - `/librarian:find campaign scheduling`
4. **Campaign Recipients** - `/librarian:find campaign recipients`
```

**Index Not Built:**
```markdown
## Index Not Found

The Librarian index hasn't been created yet.

Run: `/librarian:index` to build the semantic index first.
```

## Performance Target

- Response time: ~5-10 seconds
- Token usage: ~500 tokens (load index + search)
- Cost: ~$0.01 per query

## Notes

- Always load full index (needed for comprehensive search)
- Use fuzzy matching for concepts (campaign vs campaigns)
- Prioritize files.*.queries array (specifically written for search)
- Include related concepts to help user explore
- Link to Shadow Advisor for complementary knowledge
