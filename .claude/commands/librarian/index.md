You are executing the `/librarian:index` command to build a semantic index of important source files.

## Purpose

Create a searchable semantic index that enables meaning-based file discovery ("which file handles campaign creation?") instead of keyword grep.

## MVP Scope (50 Files)

Index these core domains:
1. **Hook Events** (routes, service, schema)
2. **Campaigns** (routes, service, schema)
3. **Auth** (routes, service, schema)

## Workflow

**Step 1: Identify Files to Index**

Use Glob to find files in these patterns:
```
apps/api/src/modules/hook-events/**/*.ts
apps/api/src/modules/crm/routes/campaigns.ts
apps/api/src/modules/crm/services/campaigns*.ts
apps/api/src/modules/auth/**/*.ts
packages/db/src/schema/hook-events.ts
packages/db/src/schema/campaigns.ts
packages/db/src/schema/auth.ts
.claude/skills/realtime-sse-architecture.md
```

Exclude test files (*.test.ts, *.spec.ts).

**Step 2: For Each File, Extract Metadata**

For each file, use Task tool with `subagent_type="general-purpose"`, `model="haiku"` to analyze and extract:

```json
{
  "path": "apps/api/src/modules/hook-events/routes.ts",
  "purpose": "One-line summary of what this file does",
  "layer": "routes|service|schema|component|util|config",
  "domain": "hook-events|campaigns|auth|crm",
  "keyConcepts": ["SSE", "CQRS", "real-time", "ElectricSQL"],
  "architecturalPatterns": ["CQRS pattern", "SSE streaming"],
  "exports": {
    "main": "hookEventRoutes",
    "types": ["HookEventQuery"],
    "functions": []
  },
  "dependencies": {
    "internal": ["./service", "../../lib/electric-shapes"],
    "external": ["elysia"]
  },
  "relatedFiles": [
    "apps/api/src/modules/hook-events/service.ts",
    "packages/db/src/schema/hook-events.ts"
  ],
  "queries": [
    "how to implement SSE streaming",
    "CQRS pattern example",
    "real-time updates implementation"
  ],
  "complexity": "low|medium|high",
  "importance": "low|medium|high|critical",
  "tokensUsed": 180
}
```

Prompt for analysis agent:
```
Analyze this file and extract semantic metadata for the Librarian index.

File path: {file_path}

Extract:
1. Purpose (one line summary)
2. Layer (routes/service/schema/component/util/config)
3. Domain (which feature area?)
4. Key concepts (technologies, patterns used)
5. Architectural patterns (CQRS, SSE, etc.)
6. Exports (main export, types, functions)
7. Dependencies (internal and external)
8. Related files (files this depends on or that depend on this)
9. Queries (questions this file answers: "how to...", "where is...")
10. Complexity (low/medium/high)
11. Importance (low/medium/high/critical)

Keep token usage low (~180 tokens output).

Return ONLY valid JSON matching the schema above.
```

**Step 3: Build Indexes**

After collecting all file metadata, build reverse indexes:

```json
{
  "byDomain": {
    "hook-events": ["apps/api/src/modules/hook-events/routes.ts", ...],
    "campaigns": ["apps/api/src/modules/crm/routes/campaigns.ts", ...]
  },
  "byLayer": {
    "routes": ["apps/api/src/modules/hook-events/routes.ts", ...],
    "service": ["apps/api/src/modules/hook-events/service.ts", ...]
  },
  "byPattern": {
    "CQRS": ["apps/api/src/modules/hook-events/routes.ts", ...],
    "SSE": ["apps/api/src/modules/hook-events/routes.ts", ...]
  },
  "byConcept": {
    "real-time-streaming": ["apps/api/src/modules/hook-events/routes.ts", ...],
    "authentication": ["apps/api/src/modules/auth/routes.ts", ...]
  }
}
```

**Step 4: Build Concept Map**

Create high-level concept → files mapping:

```json
{
  "real-time-updates": {
    "description": "SSE streaming, CQRS pattern, ElectricSQL integration",
    "primaryFiles": [
      "apps/api/src/modules/hook-events/routes.ts",
      "apps/api/src/lib/electric-shapes.ts"
    ],
    "relatedConcepts": ["CQRS", "PostgreSQL NOTIFY", "SSE"]
  },
  "campaign-management": {
    "description": "Campaign CRUD, scheduling, recipient management",
    "primaryFiles": [
      "apps/api/src/modules/crm/routes/campaigns.ts",
      "apps/api/src/modules/crm/services/campaigns.service.ts"
    ],
    "relatedConcepts": ["messaging", "templates", "channels"]
  }
}
```

**Step 5: Update index.json**

Write the complete index to `.agent/librarian/index.json` with:
- All file metadata
- All indexes (byDomain, byLayer, byPattern, byConcept)
- Concept map
- Metadata (total files, tokens used, timestamp, git commit)

**Step 6: Report Results**

```
✅ Librarian Index Created

Files Indexed: 50
Tokens Used: ~9,000 (180 per file × 50)
Cost: ~$0.27

Domains:
- hook-events: 15 files
- campaigns: 12 files
- auth: 18 files
- utilities: 5 files

Ready for queries via /librarian:find <concept>
```

## Performance Target

- Total time: 2-3 minutes
- Token usage: ~9,000 tokens
- Cost: ~$0.27
- Files indexed: 50

## Notes

- Use Haiku model for all analysis (fast + cheap)
- Process files in parallel if possible (multiple Task calls)
- Keep individual file analysis under 200 tokens
- Store git commit hash for version tracking
