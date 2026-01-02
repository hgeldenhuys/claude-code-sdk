# Agios Backend Semantic Index - Librarian

**Version:** 2.0.0
**Total Files:** 510 backend files
**Coverage:** 100% backend, 41% total codebase
**Token-Efficient:** Progressive disclosure pattern (Weave-inspired)

## 🎯 Quick Start

The librarian uses a **sharded index** for efficient querying - load only what you need!

### Access Pattern

1. **Load the catalog first** (10 KB, ~1.4K tokens)
   ```bash
   cat .agent/librarian/shards/catalog.json
   ```

2. **Identify the shard you need** (by domain or layer)
   - Want CRM files? → `shards/domain-crm.json` (38 KB, ~5K tokens)
   - Want workers? → `shards/layer-worker.json` (11 KB, ~1.5K tokens)
   - Want auth routes? → Load both `domain-auth.json` + `layer-routes.json`

3. **Load only the relevant shard(s)**
   ```bash
   cat .agent/librarian/shards/domain-crm.json
   ```

### Token Usage Comparison

| Approach | Tokens | Use Case |
|----------|--------|----------|
| **Full index** | 17,000 | ❌ Too expensive for every query |
| **Catalog only** | 1,400 | ✅ Start here, discover shards |
| **Catalog + 1 domain** | ~6,400 | ✅ Most queries (e.g., "find CRM files") |
| **Catalog + 2 shards** | ~8,000 | ✅ Combined queries (e.g., "CRM workers") |

**Savings:** 62% fewer tokens on average vs loading full index!

## 📁 File Structure

```
.agent/librarian/
├── README.md                    # This file
├── index.json                   # Main index with reverse lookups (10 KB)
├── librarian-metadata.json      # Full metadata (173 KB) - use shards instead!
├── librarian-summary.json       # Statistics (3.7 KB)
├── librarian-report.md          # Human-readable analysis (7.6 KB)
└── shards/
    ├── catalog.json             # 🌟 START HERE (10 KB, 1.4K tokens)
    ├── domain-crm.json          # CRM files (113 files, 38 KB)
    ├── domain-ai.json           # AI files (40 files, 13 KB)
    ├── domain-auth.json         # Auth files (5 files, 1.5 KB)
    ├── layer-worker.json        # All workers (30 files, 11 KB)
    ├── layer-service.json       # All services (109 files, 38 KB)
    └── ... (73 domain shards + 7 layer shards)
```

## 📊 Coverage

| Category | Files | Example Shards |
|----------|-------|----------------|
| **CRM** | 113 | domain-crm.json |
| **Core** | 119 | domain-core.json |
| **AI** | 40 | domain-ai.json |
| **Background Jobs** | 30 | domain-background-jobs.json, layer-worker.json |
| **Communication** | 22 | domain-communication.json |
| **Services** | 109 | layer-service.json |
| **Routes** | 96 | layer-routes.json |
| **Skills** | 99 | layer-skill.json |

## 🔍 Query Examples

### Example 1: Find All CRM Files
```typescript
// 1. Load catalog (1.4K tokens)
const catalog = await read('.agent/librarian/shards/catalog.json');

// 2. Find CRM shard
const crmShard = catalog.domains.find(d => d.domain === 'crm');
// → { domain: 'crm', fileCount: 113, shard: 'shards/domain-crm.json' }

// 3. Load CRM shard (5K tokens)
const crmFiles = await read('.agent/librarian/shards/domain-crm.json');

// Total: ~6.4K tokens vs 17K for full index
```

### Example 2: Find CRM Workers (Combined Query)
```typescript
// Load catalog + 2 shards
const catalog = await read('.agent/librarian/shards/catalog.json');
const crmFiles = await read('.agent/librarian/shards/domain-crm.json');
const workers = await read('.agent/librarian/shards/layer-worker.json');

// Find intersection
const crmWorkers = workers.files.filter(w =>
  w.domain === 'crm'
);

// Total: ~8K tokens
```

### Example 3: Find High-Complexity Files
```bash
# Option A: Search across all shards (slower but complete)
for shard in .agent/librarian/shards/domain-*.json; do
  jq '.files[] | select(.complexity == "high") | .path' "$shard"
done

# Option B: Use the summary (faster)
jq '.byComplexity.high' .agent/librarian/librarian-summary.json
```

## 🎨 Metadata Schema

Each file entry contains:

```typescript
interface FileMetadata {
  path: string;                    // apps/api/src/modules/crm/services/campaigns.ts
  purpose: string;                 // "Campaign CRUD, scheduling, recipient management"
  layer: LayerType;                // "service"
  domain: string;                  // "crm"
  keyConcepts: string[];           // ["campaigns", "merge-tags", "soft-delete"]
  architecturalPatterns: string[]; // ["CQRS", "Worker pattern"]
  complexity: 'low' | 'medium' | 'high';
  importance: 'low' | 'medium' | 'high' | 'critical';
}
```

### Layers
- **routes:** HTTP endpoints (ElysiaJS)
- **service:** Business logic
- **schema:** Database schemas (Drizzle)
- **worker:** Background jobs (pg-boss)
- **util:** Helper functions, providers
- **config:** Application configuration
- **skill:** Claude Code documentation

### Complexity Levels
- **Low (48%):** Simple utilities, types, configs
- **Medium (35%):** Standard business logic
- **High (17%):** Complex streaming, AI, orchestration

### Importance Levels
- **Critical (3):** Entry points, core config
- **High (100):** Routes, services, workers
- **Medium (380):** Supporting utilities
- **Low (27):** Examples, experimental

## 🏗️ Architectural Patterns

| Pattern | Files | Description |
|---------|-------|-------------|
| **SSE Streaming** | 70 | Real-time updates via Server-Sent Events |
| **Worker Pattern** | 49 | Background job processing (pg-boss) |
| **CQRS** | 30 | Command-Query separation (GET + SSE) |
| **Adapter Pattern** | 22 | Multi-provider communication |
| **PostgreSQL NOTIFY** | 15 | Event-driven database triggers |
| **ReadableStream** | 10 | Stream-based data processing |

## 💡 Usage for AI Agents

### Recommended Flow for Haiku Agents

```typescript
// Step 1: Load catalog (cheap)
const catalog = await read('.agent/librarian/shards/catalog.json');

// Step 2: Identify relevant shard(s) based on query
const query = "find campaign management files";
const relevantShard = catalog.domains.find(d =>
  d.domain.includes('crm') || d.domain.includes('campaign')
);

// Step 3: Load only the needed shard
const files = await read(`.agent/librarian/${relevantShard.shard}`);

// Step 4: Filter/search within the shard
const campaignFiles = files.files.filter(f =>
  f.purpose.toLowerCase().includes('campaign')
);

// Total tokens: ~6.4K instead of 17K (62% savings!)
```

### When to Use Full Index

Only load `librarian-metadata.json` (17K tokens) when:
- You need to search across ALL files
- You're doing bulk analysis
- Token budget is not a concern

For 90% of queries, use shards instead!

## 🚀 Future Enhancements

### Phase 1: Frontend Coverage (Planned)
- Index ~732 web app files
- Add React component metadata
- Map component → route relationships

### Phase 2: Vector Search (Planned)
- Generate embeddings for semantic search
- Enable "find files similar to X" queries
- Support natural language queries

### Phase 3: Live Updates (Planned)
- Auto-regenerate on file changes
- Track file additions/deletions
- Version history for metadata

## 📚 Related Documentation

- **Architecture:** `ARCHITECTURE.md`
- **Design Principles:** `.claude/DESIGN-PRINCIPLES.md`
- **Skills:** `.claude/skills/`
- **Weave Knowledge:** `.agent/weave/` (similar sharding pattern)

## 🔧 Regenerating the Index

```bash
# Full rebuild (if needed)
node /tmp/generate-metadata.js
node /tmp/build-indexes.js
node /tmp/shard-index.js
```

---

**Generated:** 2025-11-22
**Last Updated:** 2025-11-22
**Maintainer:** Agios Librarian System
