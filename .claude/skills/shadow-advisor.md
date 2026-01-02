---
name: shadow-advisor
description: Guide for using the Shadow Advisor - a persistent subagent that provides instant access to institutional knowledge from the Weave 11D framework. Use when you need to query pain points, patterns, decisions, or best practices without loading 18K tokens of dimension files.
tags:
  - weave
  - knowledge
  - agents
  - persistent
---

# Shadow Advisor Skill

Fast knowledge retrieval from Weave's institutional memory using a persistent Haiku agent with context caching.

## When to Use

Use Shadow Advisor when you need to:
- ✅ Query pain points: "What issues have we encountered with X?"
- ✅ Find patterns: "What's our established pattern for Y?"
- ✅ Understand decisions: "Why did we choose Z?"
- ✅ Get best practices: "What's recommended for W?"
- ✅ Avoid token bloat: Don't load 18K tokens just to answer one question

**DO NOT use Shadow Advisor for:**
- ❌ File discovery ("which file handles X?") → Use Librarian instead
- ❌ Code exploration → Use Explore agent
- ❌ Implementation work → Use dev agents

## Quick Start

### 1. Create Shadow Advisor (First Time Only)

```bash
/weave:shadow create
```

**What happens:**
- Spawns Haiku subagent
- Loads all 11 Weave dimensions (~18K tokens)
- Stores agent ID in `.agent/weave/shadow.json`
- Takes ~30-40s first time
- Cost: ~$0.10 (context caching setup)

**Verify:**
```bash
cat .agent/weave/shadow.json
# Should show your session with agent_id
```

### 2. Query Shadow Advisor

```bash
/weave:shadow What pain points should I avoid with real-time features?
```

**What happens:**
- Resumes existing subagent (uses agent_id from shadow.json)
- Queries from loaded memory (0 tool calls!)
- Response in 5-10 seconds
- Cost: ~$0.01 per query (Haiku + cache reads)

### 3. Subsequent Queries

```bash
/weave:shadow What's our CQRS pattern?
/weave:shadow Why did we choose SSE over polling?
/weave:shadow What are the deontic rules for testing?
```

**Performance:**
- Query time: 5-10s (pure memory retrieval)
- Tool calls: 0 (all answers from loaded dimensions)
- Cache efficiency: ~99% (reads 35-43K cached tokens)
- New input: Only 2 tokens per query 🎯

## Architecture

### Session-Aware Storage

```json
{
  "sessions": {
    "session-1": { "agent_id": "abc123", ... },
    "session-2": { "agent_id": "def456", ... }
  }
}
```

Each Claude Code session gets its own persistent Shadow Advisor that can be resumed across queries.

### Context Caching Magic

**First Query (create):**
```
Input: 18K tokens (11 dimension files)
Creates cache: 18K tokens cached
Cost: $0.10 (cache creation)
```

**Subsequent Queries (resume):**
```
Input: 2 tokens (just the question)
Cache read: 35-43K tokens (grows with conversation)
Cost: $0.01 (90% cache discount)
```

**Break-even:** ~5 queries. After that, massive savings!

## Usage Patterns

### Pattern 1: Pain Point Discovery

```bash
# Before implementing a feature
/weave:shadow What pain points exist around campaign scheduling?

# Returns pain points from Qualia dimension
# Warns about previous issues
# Saves you from repeating mistakes
```

### Pattern 2: Pattern Lookup

```bash
# When implementing similar functionality
/weave:shadow What's our established pattern for SSE streaming?

# Returns pattern from Epistemology dimension
# Includes examples from Praxeology
# Shows related files from Mereology
```

### Pattern 3: Decision Context

```bash
# When questioning an existing choice
/weave:shadow Why did we choose PostgreSQL NOTIFY over polling?

# Returns decision from Deontics dimension
# Explains rationale from Axiology
# Shows rejected alternatives from Modality
```

### Pattern 4: Best Practice Retrieval

```bash
# Before writing code
/weave:shadow What are the testing best practices?

# Returns practices from Praxeology dimension
# Includes quality metrics from Axiology
# References constraints from Ontology
```

## Integration with Librarian

When Shadow gets file-related questions, it should delegate to Librarian:

```bash
# Shadow delegates this automatically:
User: "Which file handles campaign scheduling?"
Shadow: "That's structural knowledge. Let me delegate to Librarian..."

# You can also call Librarian directly:
/librarian:ask which file handles campaign scheduling?
```

**Complementary Systems:**
- **Shadow**: "What pain points?" → Institutional knowledge
- **Librarian**: "Which file?" → Structural knowledge

## Troubleshooting

### Shadow Not Found

**Problem:** "No shadow found for this session"

**Solution:**
```bash
# Create shadow for this session first
/weave:shadow create
```

### Stale Cache

**Problem:** Shadow returns outdated knowledge after Weave updates

**Solution:**
```bash
# Delete old shadow, create fresh one
rm .agent/weave/shadow.json
/weave:shadow create
```

### Wrong Session

**Problem:** Shadow created in different Claude Code session

**Expected:** Each session gets its own shadow (this is correct behavior!)

**Verify:**
```bash
# Check which session you're in
# (shown in UserPromptSubmit hook: "Session: uuid")

# Check shadow.json for that session
cat .agent/weave/shadow.json | jq '.sessions["your-session-id"]'
```

## Performance Optimization

### Token Efficiency

| Approach | Tokens | Use Case |
|----------|--------|----------|
| **Direct dimension load** | 18K | ❌ Never do this |
| **Shadow (first query)** | 18K cached | ✅ One-time cost |
| **Shadow (subsequent)** | 2 input + 40K cached | ✅ 90% discount |

### Speed Comparison

| Method | Time | Tool Calls |
|--------|------|------------|
| **Read 11 files manually** | 2-3 min | 11+ reads |
| **Shadow (first query)** | 30-40s | 11 reads (cached) |
| **Shadow (subsequent)** | 5-10s | 0 reads ⚡ |

### Cost Analysis

```
First query:  $0.10 (cache creation)
Query 2-10:   $0.01 each = $0.09
Total:        $0.19 for 10 queries

vs.

Manual loads: $0.15 × 10 = $1.50

Savings: 87% after break-even (5 queries)
```

## Advanced Usage

### Query-Specific Dimensions

Shadow loads all 11 dimensions, but you can ask about specific ones:

```bash
/weave:shadow What's in the Praxeology dimension about delegation?
/weave:shadow List all entities in Ontology
/weave:shadow Show me the Deontic obligations for testing
```

### Cross-Dimensional Synthesis

Shadow excels at connecting insights across dimensions:

```bash
/weave:shadow How does the CQRS pattern (Epistemology) relate to
              the pain points (Qualia) and decisions (Deontics)?

# Shadow synthesizes across all relevant dimensions
# Provides holistic answer with cross-references
```

### Historical Context

```bash
/weave:shadow What's the evolution of our real-time architecture?

# Queries History dimension
# Shows timeline of changes
# Connects to current patterns and decisions
```

## Integration with Workflow

### Before Implementation

```bash
1. /weave:shadow What pain points exist for this feature?
2. /weave:shadow What's our pattern for similar functionality?
3. /librarian:ask Which files implement that pattern?
4. Proceed with implementation
```

### During Code Review

```bash
1. /weave:shadow Does this follow our established patterns?
2. /weave:shadow What are the quality metrics for this?
3. /weave:shadow Any deontic rules being violated?
```

### After Completion

```bash
1. /weave:reflect  # Capture new knowledge
2. /weave:shadow What did we learn?  # Verify it was captured
```

## Files Involved

```
.agent/weave/shadow.json           # Agent storage (session-keyed)
.claude/commands/weave/shadow.md   # Slash command implementation
.claude/agents/shadow-advisor.md   # Agent definition (Haiku, Read-only)
.agent/weave/*.json                # 11 dimension files (loaded by shadow)
```

## Related

- **Weave Framework**: `.agent/weave/README.md`
- **Librarian**: `.claude/skills/librarian.md`
- **Slash Commands**: `/weave:reflect`, `/weave:extract`
- **Monitoring**: `bun .agent/weave/monitor-simple.ts`

---

**Remember:** Shadow is your institutional memory. It knows everything the project has learned. Ask it before implementing, reviewing, or making decisions to avoid repeating past mistakes! 🎯
