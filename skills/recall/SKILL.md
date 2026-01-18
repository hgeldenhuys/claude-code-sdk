---
name: recall
description: Deep search across all past Claude Code sessions for decisions, solutions, and discussions
version: 0.5.0
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

> **STOP. READ THIS FIRST.**
>
> **THE ONLY COMMAND YOU MAY USE IS:**
> ```
> transcript recall "your query"
> ```
>
> **YOU MUST NOT USE:**
> - `rg` - FORBIDDEN
> - `grep` - FORBIDDEN
> - `find` - FORBIDDEN
> - `cat ~/.claude/` - FORBIDDEN
> - Any direct file access to `~/.claude/projects/` - FORBIDDEN
>
> If you use any forbidden command, you are violating this skill's requirements.

## Why This Matters

The `transcript` CLI:
- Handles JSONL parsing correctly
- Groups results by session
- Shows timestamps and context
- Finds related skills automatically

Raw tools like `rg` return unreadable JSON blobs and miss context. **Using them is a failure mode.**

## The Command

```bash
transcript recall "your query"
```

That's it. Run this command. Read the output. Done.

### Options (if needed)

```bash
transcript recall "query" --max-sessions 5    # Limit sessions shown
transcript recall "query" --context 3         # Matches per session
transcript recall "query" --limit 100         # Total matches to search
```

## Example

User asks: "Do you remember the sandbox integration tests?"

You run:
```bash
transcript recall "sandbox integration tests"
```

You get grouped results showing which sessions discussed it, with context snippets and drill-down commands.

## If You Need More Detail

After running `transcript recall`, you may want to drill deeper into a specific session. Use the drill-down command shown in the output:

```bash
transcript <session-slug> --search "query" --human
```

## Workflow

```
User asks about past discussion
         ↓
transcript recall "topic"     ← START HERE, ALWAYS
         ↓
Read the grouped output
         ↓
Need more detail? → Use drill-down command from output
         ↓
Synthesize and respond to user
```

## Common Mistakes (DO NOT DO THESE)

```bash
# WRONG - Do not use rg
rg "sandbox" ~/.claude/projects/

# WRONG - Do not use grep
grep -r "sandbox" ~/.claude/

# WRONG - Do not use find
find ~/.claude -name "*.jsonl" | xargs grep sandbox

# WRONG - Do not cat jsonl files directly
cat ~/.claude/projects/*/abc123.jsonl | grep sandbox
```

```bash
# CORRECT - Use transcript recall
transcript recall "sandbox"
```

## Summary

1. **USE:** `transcript recall "query"`
2. **DO NOT USE:** `rg`, `grep`, `find`, `cat` on transcript files
3. Read the grouped output
4. Drill down if needed using commands from the output
5. Synthesize findings for the user
