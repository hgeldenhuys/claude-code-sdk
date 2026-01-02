---
description: Complete story with retrospective, Weave learnings, and git commit (Loom 2.0)
---

# /loom:finalize - Complete Story and Extract Learnings

**Purpose:** Finalize a completed story by verifying acceptance criteria, generating retrospectives, extracting Weave learnings, and creating a git commit.

## Board CLI Integration (Required)

This command uses **Trak Board CLI exclusively** for story/task/AC management. No file-based storage.

**Board CLI Commands:**
```bash
# Get story with full details
board story show ${STORY_ID} --json

# Get AC progress
board ac progress -s ${STORY_ID} --json

# Verify/fail ACs
board ac verify ${AC_ID} --evidence "..."
board ac fail ${AC_ID} --reason "..."

# Update story status
board story update ${STORY_ID} -s completed

# End session
board session end
```

## Input

**$ARGUMENTS** - Story ID to finalize (e.g., "NOTIFY-002")

## Execution Steps

### Step 1: Load and Validate Story

```bash
# Get story from board
board story show ${STORY_ID} --json
```

**Validate readiness:**

1. **Check story status** - Must be `in_progress` or `completed`
2. **Verify all ACs pass:**
```bash
board ac progress -s ${STORY_ID} --json
# All must be verified
```

3. **Verify all tasks complete:**
```bash
board task list -s ${STORY_ID} --json
# All must have status: "completed"
```

**If blocked:**
```
❌ Cannot finalize: Not all acceptance criteria verified
Progress: 4/6 verified, 1 failed, 1 pending
Return to /loom:start to complete remaining work
```

### Step 2: Spawn Tech-Writer for Retrospective

Use the Task tool to spawn tech-writer specialist:

```typescript
Task({
  subagent_type: "tech-writer",
  model: "opus",
  description: "Generate retrospective for ${STORY_ID}",
  prompt: `
You are the Tech-Writer generating a retrospective for story ${STORY_ID}.

## Your Task

1. **Read story from Board CLI:**
   \`\`\`bash
   board story show ${STORY_ID} --json
   \`\`\`

2. **Generate retrospective with:**
   - Summary (1 paragraph)
   - What went well
   - What could improve
   - Key decisions made
   - Metrics achieved

3. **Identify Weave learnings:**
   - Patterns discovered (E dimension)
   - Pain points/solutions (Q dimension)
   - Best practices (Π dimension)

## Output Format

Return JSON:
{
  "retrospective": {
    "summary": "...",
    "whatWentWell": ["...", "..."],
    "whatCouldImprove": ["...", "..."],
    "keyDecisions": [{"decision": "...", "rationale": "..."}],
    "metrics": {
      "totalTasks": N,
      "acceptanceCriteria": "N/N passed"
    }
  },
  "weaveLearnings": [
    {
      "dimension": "E|Q|Π|Μ",
      "summary": "...",
      "detail": "...",
      "confidence": 0.8
    }
  ]
}
`
})
```

### Step 3: Commit Weave Learnings

```typescript
import { Weave } from './.agent/weave/index.ts';

const weave = new Weave('.agent/weave', false);
await weave.load();

for (const learning of weaveLearnings) {
  await weave.addEntry(learning.dimension, {
    summary: learning.summary,
    detail: learning.detail,
    confidence: learning.confidence,
    provenance: {
      source: `story:${STORY_ID}`,
      timestamp: new Date().toISOString(),
    }
  });
}

await weave.save();
```

### Step 4: Save Retrospective

Save retrospective to `.agent/loom/retrospectives/${STORY_ID}.md`:

```markdown
# Retrospective: ${STORY_ID} - ${title}

## Summary
${retrospective.summary}

## What Went Well
- Item 1
- Item 2

## What Could Improve
- Item 1
- Item 2

## Key Decisions
- **Decision**: Rationale

## Metrics
- Tasks: N
- ACs: N/N passed

## Weave Learnings
- [E] Pattern discovered
- [Q] Pain point solved

---
Generated: ${timestamp}
```

### Step 5: Create Git Commit

```bash
git add .

git commit -m "$(cat <<'EOF'
feat(${FEATURE}): ${title}

${retrospective.summary}

Story: ${STORY_ID}
ACs: ${acCount}/${acCount} passed
Tasks: ${taskCount}
Weave Learnings: ${learningCount}

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

### Step 6: Update Story Status

```bash
# Mark story as completed
board story update ${STORY_ID} -s completed

# End session
board session end
```

### Step 7: Report Results

```markdown
✅ Story Finalized: ${STORY_ID}

**Title:** ${title}
**Status:** completed

**AC Verification:** ${acCount}/${acCount} verified
**Tasks:** ${taskCount} completed

**Retrospective:** .agent/loom/retrospectives/${STORY_ID}.md

**Weave Updated:** ${learningCount} learnings committed
- E (Patterns): 2
- Q (Pain points): 1
- Π (Best practices): 1

**Git Commit:** ${commitHash} - ${title}

**Commands:**
- **View story:** board story show ${STORY_ID}
- **View retrospective:** cat .agent/loom/retrospectives/${STORY_ID}.md
- **Query Weave:** bun .agent/weave/scripts/search.ts "${STORY_ID}"

**Next Steps:**
- /loom:ideate - Start new feature
- board-tui - View board
```

## Error Handling

**If ACs not passing:**
```
❌ Cannot finalize: Not all acceptance criteria verified
Failed ACs: AC-001, AC-003

Return to /loom:start to complete remaining work
```

**If tasks incomplete:**
```
❌ Cannot finalize: Not all tasks complete
Incomplete: task-123, task-456

Complete remaining tasks before finalization
```

**If git commit fails:**
```
⚠️ Git commit failed - use this message template:

feat(${FEATURE}): ${title}
[retrospective summary]
Story: ${STORY_ID}
```

## Success Criteria

Finalization is complete when:

- ✅ All ACs verified via `board ac progress`
- ✅ All tasks completed via `board task list`
- ✅ Retrospective generated and saved
- ✅ Weave learnings committed
- ✅ Git commit created
- ✅ Story status = "completed" via `board story update`
- ✅ Session ended via `board session end`

## Board CLI Quick Reference

```bash
# Story operations
board story show STORY-ID --json
board story update STORY-ID -s completed

# AC operations
board ac progress -s STORY-ID --json
board ac list -s STORY-ID --json
board ac verify AC-ID --evidence "..."
board ac fail AC-ID --reason "..."

# Task operations
board task list -s STORY-ID --json

# Session operations
board session end
```

## Next Steps After Finalization

1. **Review retrospective:**
   ```bash
   cat .agent/loom/retrospectives/${STORY_ID}.md
   ```

2. **Query Weave learnings:**
   ```bash
   bun .agent/weave/scripts/search.ts "${STORY_ID}"
   ```

3. **Start next story:**
   ```
   /loom:ideate
   ```
