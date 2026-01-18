---
name: recall
description: Deep search across all past Claude Code sessions for decisions, solutions, and discussions
version: 0.4.0
triggers:
  - "I forgot"
  - "do you remember"
  - "what did we decide"
  - "we discussed this before"
  - "I need to recall"
  - "search my memory"
  - "/recall"
tools:
  - Bash
  - Read
---

# Recall: Self-Memory Retrieval

**CRITICAL: You MUST use the `transcript` CLI for all searches. NEVER use raw tools like `rg`, `grep`, or `find` to search transcripts directly.**

## Quick Start - Use `transcript recall`

The `transcript recall` command is optimized for memory retrieval. **Always start here:**

```bash
# Primary method - groups results by session automatically
transcript recall "your query"

# With options
transcript recall "caching strategy" --max-sessions 5 --context 3
```

**Output includes:**
- Results grouped by session with timestamps
- Match counts and context snippets
- Related skills found in skills directories
- Drill-down commands for each session

## When to Use Each Command

| Command | Use Case |
|---------|----------|
| `transcript recall "X"` | Memory retrieval - "what did we discuss about X?" |
| `transcript search "X"` | Raw search - need specific line numbers |
| `transcript <session> --search "X"` | Drill into a specific session |

## Step-by-Step Workflow

### Step 1: Recall Broadly

```bash
# Start with recall - it groups results and finds related skills
transcript recall "database migration"
```

This returns:
- Sessions grouped by relevance
- Timestamp ranges for each session
- Context snippets with highlights
- Related skills (if any match your query)
- Drill-down commands for each session

### Step 2: Drill Into Promising Sessions

When recall shows a promising session, dig deeper:

```bash
# View specific session with search highlighting
transcript <session-id> --search "query" --human

# Get more context (50 lines)
transcript <session-id> --search "query" -n 50 --human

# View only your past thoughts (assistant responses)
transcript <session-id> --search "query" --assistant --human

# View the full discussion
transcript <session-id> --user-prompts --assistant --human
```

### Step 3: Follow Cross-References

If you find mentions of related topics:

```bash
# Search for related topic in same session
transcript <session-id> --search "related topic" --human

# Or recall the related topic across all sessions
transcript recall "related topic"
```

### Step 4: Synthesize Findings

After gathering memories:
1. Summarize what you found
2. Note any contradictions between past decisions
3. Identify if context has changed since the original decision
4. Present findings to the user with confidence levels

## Workflow Diagram

```
┌─────────────────────────────────────────────────┐
│  "I need to remember X"                         │
└─────────────────┬───────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────┐
│  transcript recall "X"                          │
│  → Groups results by session                    │
│  → Shows related skills                         │
│  → Provides drill-down commands                 │
└─────────────────┬───────────────────────────────┘
                  ▼
        ┌─────────┴─────────┐
        ▼                   ▼
┌───────────────┐   ┌───────────────────────┐
│ Found answer  │   │ Need more context?    │
│ → Synthesize  │   │ → Use drill-down cmd  │
└───────────────┘   └───────────┬───────────┘
                                │
                    ┌───────────┘
                    ▼
┌─────────────────────────────────────────────────┐
│  transcript <session> --search "X" --human      │
└─────────────────┬───────────────────────────────┘
                  ▼
        ┌─────────┴─────────┐
        ▼                   ▼
┌───────────────┐   ┌───────────────────────┐
│ Found answer  │   │ Found cross-reference │
│ → Synthesize  │   │ → Recall that topic   │
└───────────────┘   └───────────────────────┘
```

## Common Recall Scenarios

### "What did we decide about X?"
```bash
transcript recall "X decision"
# or
transcript recall "decided X"
```

### "We tried something before that didn't work"
```bash
transcript recall "error failed"
# or
transcript recall "didn't work broken"
```

### "What was the solution to Y problem?"
```bash
transcript recall "Y solution"
transcript recall "Y fix"
```

### "Do you remember the architecture we discussed?"
```bash
transcript recall "architecture design"
```

## Recall Command Options

```bash
transcript recall <query> [options]

Options:
  --max-sessions <n>    Maximum sessions to show (default: 5)
  --context <n>         Matches per session to show (default: 3)
  --limit <n>           Total matches to search (default: 100)
  --artifacts           Include related skills (default: true)
  --no-artifacts        Exclude related skills
  --json                Output as JSON for programmatic use
```

## Understanding Session Identity

Your identity persists through **session name**, not session ID:
- When a session is resumed, the ID changes but the name stays
- All session IDs sharing your name are "past versions of yourself"
- Use `sesh history <name>` to find all your past session IDs

## Tips for Effective Recall

1. **Start with recall, not search** - `transcript recall` groups results automatically
2. **Use multiple keywords** - "caching redis strategy" finds more than just "caching"
3. **Check related skills** - recall shows skills that match your query
4. **Drill down when needed** - use the provided drill-down commands
5. **Note timestamps** - recent memories may be more relevant
6. **Trust but verify** - past decisions may need updating for new context

## When Memory Fails

If you can't find what you're looking for:
1. Try different keywords or synonyms
2. Ask the user for more context clues
3. Check if it might be in a different project
4. Acknowledge the gap honestly: "I couldn't find a record of that discussion"

## Example Session

User: "Do you remember what we decided about the caching strategy?"

You:
```bash
transcript recall "caching strategy"
```

Output:
```
🔍 Recall: "caching strategy"

Found 12 matches across 2 sessions

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📁 loyal-whippet (10 matches)
   Jan 15 at 2:30 PM → Jan 15 at 4:45 PM

   [02:35 PM] assistant  Line 1234
   We decided to use Redis with a 5-minute TTL because...

   → transcript loyal-whippet --search "caching strategy" --human
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Then synthesize: "I found our discussion from January 15th. We decided to use Redis with a 5-minute TTL because of the high read volume on the product catalog endpoint. The key decision factors were..."
