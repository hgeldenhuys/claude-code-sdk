---
name: librarian
description: Guide for using the Librarian - a persistent subagent that provides semantic file discovery from the Library index. Use when you need to find files by concept, domain, layer, or architectural pattern without grepping.
tags:
  - weave
  - files
  - discovery
  - agents
  - persistent
---

# Librarian Skill

Fast semantic file discovery using a persistent Haiku agent with sharded index access.

## When to Use

Use Librarian when you need to:
- ✅ Find files by concept: "Which files handle campaign creation?"
- ✅ Discover by domain: "Where are the CRM routes?"
- ✅ Filter by pattern: "Show me SSE implementations"
- ✅ Locate by complexity: "Find high-complexity real-time files"
- ✅ Explore unfamiliar code: "What's in the authentication domain?"

**DO NOT use Librarian for:**
- ❌ Institutional knowledge ("what pain points?") → Use Shadow Advisor
- ❌ Exact string matching → Use Grep/RG
- ❌ Deep code analysis → Use Explore agent
- ❌ Reading file contents → Use Read tool

## Quick Start

### 1. Build the Library Index (Optional)

If starting fresh or want to reindex:

```bash
/librarian:index
```

**What happens:**
- Analyzes 500+ backend files
- Generates semantic metadata (purpose, domain, layer, patterns)
- Creates 80+ sharded indexes
- Stores in `.agent/librarian/shards/`
- Takes ~45 minutes for full backend
- Cost: ~$0.27 (one-time)

**Skip this if:** Index already exists from another session!

### 2. Create Librarian Agent (First Time Per Session)

```bash
/librarian:ask create
```

**What happens:**
- Spawns Haiku subagent
- Loads catalog + 6 common shards (~500 files, ~8K tokens)
- Stores agent ID in `.agent/librarian/librarian.json`
- Takes ~20-30s
- Cost: ~$0.05 (context caching setup)

**Shards Loaded:**
- `catalog.json` - Directory of all 80+ shards
- `domain-crm.json` - 113 CRM files
- `domain-core.json` - 119 core utilities
- `domain-real-time.json` - 8 SSE files
- `layer-routes.json` - 96 API endpoints
- `layer-service.json` - 109 business logic files
- `layer-worker.json` - 30 background workers

### 3. Query Librarian

```bash
/librarian:ask which files handle campaign scheduling?
```

**What happens:**
- Resumes existing subagent
- Searches loaded shards from memory (0 tool calls!)
- Returns files with metadata (path, purpose, patterns, complexity)
- Response in 5-10 seconds
- Cost: ~$0.01 per query

### Example Output:

```
Found 3 campaign scheduling files:

1. apps/api/src/modules/crm/routes/campaign-schedules.ts
   - Purpose: CRM campaign schedules HTTP routes
   - Layer: routes, Domain: crm
   - Patterns: SSE, CQRS

2. apps/api/src/modules/crm/services/campaign-schedules.ts
   - Purpose: Campaign scheduling business logic
   - Layer: service, Domain: crm
   - Complexity: medium

3. apps/api/src/workers/campaign-scheduler.ts
   - Purpose: Background worker for campaign scheduling
   - Layer: worker, Domain: background-jobs
   - Complexity: high, Importance: high
```

## Architecture

### Sharded Index Structure

```
.agent/librarian/shards/
├── catalog.json              # Start here (1.4K tokens)
├── domain-crm.json           # 113 CRM files (5K tokens)
├── domain-core.json          # 119 core files (5K tokens)
├── domain-ai.json            # 40 AI files (2K tokens)
├── layer-routes.json         # 96 route files (4K tokens)
├── layer-service.json        # 109 service files (5K tokens)
└── ... (80+ shards total)
```

**Progressive Disclosure:**
- Load catalog first (1.4K tokens)
- Load only needed shards (5-6K each)
- 62% token savings vs full index (8K vs 17K)

### Metadata Schema

Each file includes:
```json
{
  "path": "apps/api/src/...",
  "purpose": "One-line description",
  "layer": "routes|service|worker|schema|util|config|skill",
  "domain": "crm|ai|auth|core|communication|etc",
  "keyConcepts": ["SSE", "CQRS", "campaigns"],
  "architecturalPatterns": ["SSE", "Worker pattern"],
  "complexity": "low|medium|high",
  "importance": "low|medium|high|critical"
}
```

### Session-Aware Storage

Like Shadow Advisor, each Claude Code session gets its own Librarian:

```json
{
  "sessions": {
    "session-1": { "agent_id": "abc123", "shards_loaded": [...] },
    "session-2": { "agent_id": "def456", "shards_loaded": [...] }
  }
}
```

## Query Patterns

### By Concept

```bash
/librarian:ask show me campaign management files

# Searches purpose field for "campaign"
# Returns routes, services, workers, schemas
```

### By Domain

```bash
/librarian:ask what files are in the CRM domain?

# Filters by domain=crm
# Returns all 113 CRM files with purposes
```

### By Layer

```bash
/librarian:ask find all background workers

# Filters by layer=worker
# Returns 30 worker files with domains and purposes
```

### By Pattern

```bash
/librarian:ask show me SSE streaming implementations

# Filters by architecturalPatterns containing "SSE"
# Returns 8 files with SSE pattern
```

### Combined Filters

```bash
/librarian:ask find high-complexity CRM routes

# Filters: domain=crm AND layer=routes AND complexity=high
# Returns complex routing files in CRM domain
```

### Shard Recommendations

```bash
/librarian:ask where is email sending logic?

# Librarian: "That's likely in domain-communication shard (not loaded).
#             Load it with /librarian:ask create --load communication"
```

## Librarian vs Other Tools

| Tool | Purpose | Query Type | Speed |
|------|---------|------------|-------|
| **Librarian** | Semantic discovery | "Which file handles X?" | 5-10s, 0 tools |
| **Shadow** | Institutional knowledge | "What pain points?" | 5-10s, 0 tools |
| **Grep/RG** | Exact string match | "Find string Y" | <1s |
| **Explore** | Deep analysis | "How does Z work?" | 1-2 min |

### When to Use Each

**Use Librarian when:**
- ✅ Exploring unfamiliar code
- ✅ Need files by concept ("campaign logic")
- ✅ Want architectural filtering (domain/layer/pattern)
- ✅ Don't know what strings to search for

**Use RG when:**
- ✅ Know exact variable/function name
- ✅ Need to find all usages
- ✅ Want to see code context
- ✅ Quick one-off searches

**Use Shadow when:**
- ✅ Need pain points, patterns, decisions
- ✅ Historical context ("why did we...")
- ✅ Best practices and constraints

**Use Explore when:**
- ✅ Deep investigation needed
- ✅ Understanding complex flows
- ✅ Multiple file relationships

## Performance

### Token Efficiency

| Approach | Tokens | Coverage |
|----------|--------|----------|
| **Full index** | 17K | All 510 files |
| **Catalog only** | 1.4K | Shard directory |
| **Catalog + 1 domain** | ~6.4K | ~100 files |
| **Catalog + 6 shards** | ~8K | ~500 files ✅ |

### Speed Comparison

| Operation | Time | Tool Calls |
|-----------|------|------------|
| **Index creation** | 45 min | N/A (one-time) |
| **Librarian create** | 20-30s | 7 reads (cached) |
| **Librarian query** | 5-10s | 0 reads ⚡ |
| **RG search** | <1s | N/A |

### Cost Analysis

```
Index creation:  $0.27 (one-time, shared across sessions)
First query:     $0.05 (cache creation)
Query 2-10:      $0.01 each = $0.09
Total:           $0.41 for 10 queries

Break-even: ~3 queries vs using Explore agent repeatedly
```

## Real-World Examples

### Example 1: New Developer Onboarding

```bash
# Understand codebase structure
/librarian:ask what domains exist in this codebase?

# Returns: crm, ai, auth, core, communication, real-time, etc.
# Each with file counts and descriptions

# Dive into specific domain
/librarian:ask show me the CRM domain files

# Returns 113 CRM files organized by layer
```

### Example 2: Feature Implementation

```bash
# Task: "Add timezone support to campaign scheduling"

# Step 1: Find existing files
/librarian:ask which files handle campaign scheduling?

# Step 2: Check patterns used
# (Response shows: SSE, CQRS, Worker pattern)

# Step 3: Find similar implementations
/librarian:ask show me other files using CQRS pattern

# Now you know: routes, service, worker to modify
```

### Example 3: Code Review

```bash
# Reviewing complex PR

# Find high-complexity files in the changeset
/librarian:ask what are the most complex files in real-time domain?

# Returns files ranked by complexity
# Prioritize review on high-complexity files
```

### Example 4: Architecture Analysis

```bash
# Understanding SSE usage

/librarian:ask show me all SSE streaming files

# Returns 8 files with SSE pattern
# Shows: routes, services, workers using SSE

/librarian:ask which domains use SSE most?

# Analyzes loaded shards
# Returns: real-time (100%), hook-events (75%), sdlc (60%)
```

## Integration with Shadow

When Librarian can't answer (institutional knowledge needed), delegate to Shadow:

```bash
# Librarian delegates:
User: "What pain points exist with campaign scheduling?"
Librarian: "That's institutional knowledge. Let me delegate to Shadow Advisor..."

# You can also call Shadow directly:
/weave:shadow What pain points exist with campaign scheduling?
```

**Complementary Systems:**
- **Librarian**: "Which file?" → Structural knowledge
- **Shadow**: "What pain points?" → Institutional knowledge

## Troubleshooting

### Librarian Not Found

**Problem:** "No librarian found for this session"

**Solution:**
```bash
# Create librarian for this session first
/librarian:ask create
```

### Shard Not Loaded

**Problem:** "That information is in domain-X shard (not loaded)"

**Solution:**
```bash
# Librarian can only search loaded shards
# Default: catalog + 6 common shards
# If needed, recreate with more shards or use grep
```

### Index Outdated

**Problem:** New files not showing up

**Solution:**
```bash
# Rebuild the index
/librarian:index

# Then recreate librarian agents
rm .agent/librarian/librarian.json
/librarian:ask create
```

## Advanced Usage

### Custom Shard Loading

To load different shards than the default 6:

```bash
# Modify /librarian:ask command to specify:
# - domain-communication.json (email/SMS files)
# - domain-auth.json (authentication files)
# - layer-schema.json (database schemas)
```

### Incremental Index Updates

The Library auto-updates via Stop hook when files are edited:

```
.agent/hooks/Stop.ts → update-incremental.ts → Updates affected shards
```

No manual reindexing needed for small changes!

### Multi-Language Support

Currently indexes:
- ✅ TypeScript (.ts, .tsx)
- ✅ Skills (.md in .claude/skills)

Future support for:
- ⏳ Frontend (React components, routes)
- ⏳ CLI (Commander.js commands)
- ⏳ Tests (.test.ts files)

## Files Involved

```
.agent/librarian/
├── librarian.json             # Agent storage (session-keyed)
├── shards/                    # 80+ sharded indexes
│   ├── catalog.json           # Directory (1.4K tokens)
│   ├── domain-*.json          # 73 domain shards
│   └── layer-*.json           # 7 layer shards
├── README.md                  # Shard usage guide
└── librarian-report.md        # Analysis report

.claude/commands/librarian/
├── ask.md                     # Librarian interface
└── index.md                   # Index builder (optional)

.claude/agents/
└── librarian.md               # Agent definition (Haiku, Read-only)
```

## Related

- **Weave Framework**: `.agent/weave/README.md`
- **Shadow Advisor**: `.claude/skills/shadow-advisor.md`
- **Library README**: `.agent/librarian/README.md`
- **Index Report**: `.agent/librarian/librarian-report.md`

---

**Remember:** Librarian is your structural memory. It knows where everything is. Ask it before grepping to find files by meaning, not just strings! 📚
