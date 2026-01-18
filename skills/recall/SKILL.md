---
name: recall
description: Deep search across all past Claude Code sessions for decisions, solutions, and discussions
version: 0.3.0
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

## MANDATORY Tool Usage

```bash
# CORRECT - Always use transcript CLI
transcript search "your query" --limit 20

# WRONG - Never do this
rg "query" ~/.claude/projects/  # DO NOT USE
grep -r "query" ~/.claude/      # DO NOT USE
find ~/.claude -name "*.jsonl"  # DO NOT USE
```

**Why this matters:**
- The `transcript` CLI handles JSONL parsing, session metadata, and formatting
- Raw tools return unreadable JSON blobs and miss context
- The CLI was built specifically for this purpose - USE IT

---

You are searching your own memory - past versions of yourself that share your session name or worked in the same project. This is recursive memory retrieval: search broadly, then drill deeper based on findings.

## Understanding Session Identity

Your identity persists through **session name**, not session ID:
- When a session is resumed, the ID changes but the name stays
- All session IDs sharing your name are "past versions of yourself"
- Use `sesh history <name>` to find all your past session IDs

## Step 1: Identify Your Session Context

```bash
# Check if you know your session name (from hook context injection)
# If CLAUDE_SESSION_NAME is set, use it

# Or find sessions for current project
sesh list --project "$(pwd)" --json
```

## Step 2: Search Broadly First

Start with a broad keyword search across your session history:

```bash
# Search within a specific session name's transcripts
transcript search "your query" --session-name <your-session-name>

# Or search by session ID if you have it
transcript search "your query" --session <session-id>

# Search current project's transcripts
transcript search "your query" --limit 20
```

**Examine the results:**
- Note which sessions have relevant matches
- Look for context clues about related topics
- Identify promising sessions to drill deeper

## Step 3: Drill Into Promising Results

When you find a relevant session, read more context:

```bash
# View specific session with search highlighting
transcript <session-id> --search "query" --human

# Get context around a specific topic
transcript <session-id> --search "query" -n 50 --human

# View assistant responses only (your past thoughts)
transcript <session-id> --search "query" --assistant --human

# View the full discussion (user + assistant)
transcript <session-id> --user-prompts --assistant --human
```

## Step 4: Follow Cross-References

If your search mentions related topics, follow those threads:

```bash
# Found mention of "database schema" in auth discussion?
transcript search "database schema" --session <same-session>

# Found reference to another session?
transcript <referenced-session> --search "relevant topic"
```

## Step 5: Synthesize Findings

After gathering memories:
1. Summarize what you found
2. Note any contradictions between past decisions
3. Identify if context has changed since the original decision
4. Present findings to the user with confidence levels

## Recursive Pattern

```
┌─────────────────────────────────────────────────┐
│  "I need to remember X"                         │
└─────────────────┬───────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────┐
│  Search broadly: transcript search "X"          │
└─────────────────┬───────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────┐
│  Scan results → identify promising sessions     │
└─────────────────┬───────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────┐
│  Drill into session: transcript <id> --search   │
└─────────────────┬───────────────────────────────┘
                  ▼
        ┌─────────┴─────────┐
        ▼                   ▼
┌───────────────┐   ┌───────────────────────┐
│ Found answer  │   │ Found cross-reference │
│ → Synthesize  │   │ → Follow that thread  │
└───────────────┘   └───────────┬───────────┘
                                │
                    ┌───────────┘
                    ▼
        (recurse with new query)
```

## Common Recall Scenarios

### "What did we decide about X?"
```bash
transcript search "decide" --session-name <name>
transcript search "X" --session-name <name>
# Cross-reference both result sets
```

### "We tried something before that didn't work"
```bash
transcript search "error" --session-name <name>
transcript search "failed" --session-name <name>
transcript search "didn't work" --session-name <name>
```

### "What was the solution to Y problem?"
```bash
transcript search "Y" --session-name <name>
# Look for tool_result entries showing successful outcomes
transcript <session-id> --tools --search "Y"
```

### "Do you remember the architecture we discussed?"
```bash
transcript search "architecture" --session-name <name>
transcript search "design" --session-name <name>
# Check assistant responses for diagrams/explanations
transcript <session-id> --assistant --search "architecture"
```

## Tips for Effective Recall

1. **Start broad, narrow down** - Don't over-specify initial search
2. **Use multiple keywords** - Try synonyms if first search fails
3. **Check assistant responses** - Your past thoughts are in `--assistant` output
4. **Look at tool results** - Actual outcomes are in `--tools` output
5. **Note timestamps** - Recent memories may be more relevant
6. **Trust but verify** - Past decisions may need updating for new context

## When Memory Fails

If you can't find what you're looking for:
1. Ask the user for more context clues
2. Try related keywords
3. Check if it might be in a different project
4. Acknowledge the gap honestly: "I couldn't find a record of that discussion"

## Example Invocation

User: "Do you remember what we decided about the caching strategy?"

You:
```bash
# Search for caching discussions
transcript search "caching strategy" --limit 10

# Found in session abc123, drill deeper
transcript abc123 --search "caching" --assistant --human -n 30
```

Then synthesize: "I found our discussion from [date]. We decided to use Redis with a 5-minute TTL because..."
