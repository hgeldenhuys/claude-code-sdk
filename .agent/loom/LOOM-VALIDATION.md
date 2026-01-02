# Loom 2.0 - Validation Protocol

> **Read this before running `/loom:run` or any Loom workflow command.**

---

## What is Loom?

Loom is a **Domain Memory Architecture** that changes how you (Claude) should work on this project. Instead of doing implementation work directly, you act as a **Stage Manager** who coordinates **Actor Agents** to do the actual work.

### The Core Rule

```
You are the STAGE MANAGER. You coordinate. You do NOT implement.
```

When you need to write code, create files, or modify implementation:
1. **DO NOT** edit `src/`, `app/`, `packages/`, or other implementation directories directly
2. **DO** spawn an appropriate Actor via the `Task` tool
3. **DO** track progress in Domain Memory files

### Actor Types Available

| Actor | Use For | Model |
|-------|---------|-------|
| `architect` | System design, API contracts, planning complex tasks | Opus |
| `backend-dev` | Backend code, APIs, database work | Sonnet |
| `frontend-dev` | UI components, styles, frontend logic | Sonnet |
| `qa-engineer` | Tests, validation, quality checks | Sonnet |
| `devops` | Infrastructure, CI/CD, deployment | Sonnet |
| `tech-writer` | Documentation, retrospectives | Sonnet |

---

## Before Starting: Pre-Flight Check

Run these commands and verify the output:

```bash
# 1. Domain Memory exists?
ls .agent/loom/backlog.json .agent/loom/current.json
# Expected: Both files should exist

# 2. Hooks registered?
grep "stage-manager-enforcement" .claude/settings.json && echo "Enforcement: OK"
grep "loom-metrics" .claude/settings.json && echo "Metrics: OK"
# Expected: Both should print "OK"

# 3. Current metrics baseline
cat .agent/loom/metrics/daily-summary.json 2>/dev/null || echo "No metrics yet (this is fine for first run)"
```

If any check fails, the installation may be incomplete.

---

## During Execution: What to Watch For

### Expected Behavior

1. **Story Creation** (`/loom:ideate`)
   - Creates story in `.agent/loom/features/{CODE}/stories/{ID}/`
   - Story has `story.json` and `story.md`
   - Backlog updated with new story

2. **Planning** (`/loom:plan`)
   - Tasks created with dependencies
   - Each task assigned to an actor type
   - Acceptance criteria linked to tasks

3. **Execution** (`/loom:start`)
   - Stage Manager reads Domain Memory
   - Stage Manager spawns Actors via Task tool
   - Actors do the actual implementation
   - Results merged back to story

4. **Finalization** (`/loom:finalize`)
   - All ACs verified
   - Retrospective generated
   - Metrics updated

### Warning Signs

If you see these, something is wrong:

- **Direct implementation edits**: You're editing `src/` files without spawning an actor
- **No Task tool calls**: Implementation happening without delegation
- **Stale Domain Memory**: `current.json` not reflecting actual progress
- **Missing actor results**: Actors not reporting back properly

### The Enforcement Hook

When you try to edit implementation files directly, you'll see a warning like:

```
[Stage Manager Violation]
You are attempting to edit an implementation file: src/components/Button.tsx
Stage Manager Rule: The orchestrating agent should COORDINATE, not IMPLEMENT.
Delegate to **frontend-dev** actor for UI/frontend work.
```

**This is intentional.** Spawn the appropriate actor instead.

---

## After Completion: Validation Checklist

### 1. Check Delegation Metrics

```bash
cat .agent/loom/metrics/daily-summary.json | head -20
```

Look for:
- `delegationRate` - Should be >80% (ideally 100%)
- `actorSpawns` - Should be >0
- `directEdits` - Should be 0

### 2. Check for Violations

```bash
wc -l .agent/loom/metrics/stage-manager-violations.jsonl 2>/dev/null || echo "0 violations"
```

Target: 0 violations

### 3. Verify Story Completion

```bash
# List all stories and their status
find .agent/loom/features -name "story.json" -exec sh -c 'echo "=== {} ===" && cat {} | grep -E "\"(id|status)\"" | head -4' \;
```

### 4. Check Task Completion

```bash
# For the active story, check task statuses
cat .agent/loom/features/*/stories/*/story.json 2>/dev/null | grep -A2 '"tasks"' | head -20
```

---

## Success Criteria

Fill this out after each iteration:

| Metric | Target | Actual | Pass? |
|--------|--------|--------|-------|
| Delegation Rate | >80% | ___% | [ ] |
| Direct Edits | 0 | ___ | [ ] |
| Violations | 0 | ___ | [ ] |
| Tasks Completed | 100% | ___% | [ ] |
| ACs Passing | 100% | ___% | [ ] |
| Story Status | completed | ___ | [ ] |

---

## Troubleshooting

### "Hook not found" errors
```bash
# Ensure claude-hooks-sdk is installed
bun add claude-hooks-sdk
```

### Actors not spawning
- Check that actor templates exist in `.claude/agents/`
- Verify Task tool is available
- Check task has correct `assignedTo` field

### Domain Memory validation errors
- Schemas are strictly enforced
- Check `.agent/loom/schemas/` for expected format
- Run validation: `bun .agent/loom/src/schemas/validate.ts`

### Metrics not updating
- Hooks must be registered in `.claude/settings.json`
- Check `PostToolUse` and `SessionEnd` sections

---

## Reporting Back

After your iteration, report:

1. **What worked well**
   - Which parts of the workflow felt natural?
   - Did delegation happen smoothly?

2. **What broke or felt wrong**
   - Any errors or unexpected behaviors?
   - Where did the process feel awkward?

3. **Suggestions**
   - What would make this easier?
   - What's missing?

4. **Metrics Summary**
   - Paste the delegation rate and violation count
   - Note any anomalies

---

## Quick Reference

### Workflow Commands
- `/loom:ideate` - Create story from idea
- `/loom:plan {id}` - Break into tasks
- `/loom:start {id}` - Execute with actors
- `/loom:finalize {id}` - Complete and capture learnings
- `/loom:run` - Full cycle (ideate → plan → execute → finalize)

### Key Files
- `.agent/loom/backlog.json` - Story index
- `.agent/loom/current.json` - Active session state
- `.agent/loom/features/{CODE}/stories/{ID}/story.json` - Story details
- `.agent/loom/metrics/daily-summary.json` - Delegation metrics

### The Prime Directive
```
Stage Manager coordinates. Actors implement.
Never edit implementation files directly.
Always delegate via Task tool.
```
