# Weave Query Scripts

Progressive disclosure system for the Weave knowledge framework. Load lightweight summary at session start, query details on demand.

## Scripts

### 1. query.ts - Query specific entities

Get detailed information about a specific entity by dimension and ID.

**Usage:**
```bash
bun query.ts <dimension>:<entity-id>
```

**Examples:**
```bash
# Query using full dimension name
bun query.ts ontology:agios-platform

# Query using abbreviation
bun query.ts π:context-preservation-through-delegation
bun query.ts o:agios-platform

# Query using Greek symbol
bun query.ts Π:context-preservation-through-delegation
```

**Dimension Abbreviations:**
- `q` = qualia
- `e` = epistemology
- `o` = ontology
- `m` = mereology
- `c` = causation
- `a` = axiology
- `t` = teleology
- `h` or `η` = history
- `p` or `π` = praxeology
- `mod` or `μ` = modality
- `d` or `δ` = deontics

**Token Cost:** ~100-300 tokens per query (entity details only)

---

### 2. search.ts - Search across all dimensions

Search for a term across all dimensions or filter to specific dimension.

**Usage:**
```bash
bun search.ts "<search-term>"
bun search.ts --dimension=<dim> "<search-term>"
```

**Examples:**
```bash
# Search across all dimensions
bun search.ts "delegation"

# Search within specific dimension
bun search.ts --dimension=π "context"
bun search.ts --dimension=praxeology "context"

# Search for patterns
bun search.ts "electricsql"
```

**Token Cost:** ~50-200 tokens depending on results

---

### 3. related.ts - Find related knowledge

Find all references to an entity across all 11 dimensions.

**Usage:**
```bash
bun related.ts <entity-id>
```

**Examples:**
```bash
# Find all references to agios-platform
bun related.ts agios-platform

# Find references to a pattern
bun related.ts context-preservation-through-delegation
```

**Token Cost:** ~100-400 tokens depending on connections

---

### 4. generate-summary.ts - Auto-generate summary.md

Regenerate the summary.md file from current dimension data.

**Usage:**
```bash
bun generate-summary.ts
```

**Output:** Creates/updates `summary.md` in `.agent/weave/`

**Token Cost:** Summary is ~319 tokens (2.8% of full knowledge base)

---

## Workflow

### At Session Start
1. Load `summary.md` (~319 tokens)
2. Review high-level stats across 11 dimensions
3. Decide which details you need

### During Session
```bash
# Need to know about a specific entity?
bun query.ts o:agios-platform

# Looking for patterns related to "delegation"?
bun search.ts "delegation"

# Want to see all connections to an entity?
bun related.ts agios-platform

# Updated knowledge? Regenerate summary
bun generate-summary.ts
```

---

## Token Budget Example

**Without progressive disclosure:**
- Load all 11 dimensions: ~11,000 tokens
- Context consumed before starting work

**With progressive disclosure:**
- Load summary.md: ~319 tokens (2.8%)
- Query 3-5 entities as needed: ~500-1000 tokens
- Total: ~800-1300 tokens (7-12% of without)
- Savings: ~10,000 tokens for actual work

---

## Making Scripts Executable

All scripts have the `#!/usr/bin/env bun` shebang and are executable:

```bash
chmod +x *.ts
```

You can also run them directly:
```bash
./query.ts o:agios-platform
./search.ts "delegation"
```
