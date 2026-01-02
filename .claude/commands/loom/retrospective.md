---
description: Review completed story and analyze learnings (Loom: Retrospective)
---

# Loom: Story Retrospective

Generate or view retrospective for a completed story in Loom.

## Context Loading

1. **Load Story from Board CLI**:
   ```bash
   board story show {STORY-ID} --json
   ```

2. **Load Tasks and ACs**:
   ```bash
   board task list -s {STORY-ID} --json
   board ac list -s {STORY-ID} --json
   ```

## Two Modes

### Mode 1: View Existing Retrospective
If retrospective already exists at `.agent/loom/retrospectives/{STORY-ID}.md`:
- Read and display it to user
- Optionally offer to regenerate if user wants updated analysis

### Mode 2: Generate New Retrospective
If retrospective doesn't exist or user wants regeneration:

Use the tech-writer agent to generate the retrospective:
```
Spawn tech-writer agent with task:
"Generate retrospective for story {STORY-ID}.
Read story details from board CLI, analyze execution,
and write retrospective to .agent/loom/retrospectives/{STORY-ID}.md"
```

This will analyze:
- Story details from Board CLI
- All tasks and their completion status
- Acceptance criteria results
- Actor sections and handoffs
- Decisions made during execution

## Retrospective Format

The generated retrospective follows this structure:

```markdown
# Retrospective: {STORY-ID} - {Story Title}

**Generated**: {timestamp}
**Status**: {story.status}

---

## Summary

- **Duration**: {start date} to {end date}
- **Tasks**: {completed}/{total}
- **Acceptance Criteria**: {passed}/{total}
- **Actors Involved**: {list actors}

---

## Story Context

### Why (Motivation)
{story.why}

### What (Description)
{story.description}

### Acceptance Criteria
{for each AC}
- [{status}] {AC-CODE}: {description}
  - Verified: {yes/no}
  - Evidence: {notes}

---

## What Went Well

{Extracted from actor sections:}
- {Pattern that worked}
- {Successful approach}
- {Smooth execution}

---

## What Could Be Improved

{Extracted from pain points:}
- {Blocker encountered}
- {Time sink}
- {Confusion or ambiguity}

---

## Key Decisions

{For each decision made:}

### D-{id}: {question}
- **Options Considered**: {list}
- **Chosen**: {choice}
- **Rationale**: {why}

---

## Learnings for Weave

### Patterns Discovered (E)
- {Pattern name}: {description}

### Pain Points Encountered (Q)
- {Pain point}: {description}

### Best Practices Validated (Pi)
- {Practice}: {why it worked}

### Decisions Made (Mu)
- {Decision}: {rationale}

---

## Actor Contributions

### Architect
- {summary of work}

### Backend-Dev
- {summary of work}

### Frontend-Dev
- {summary of work}

### QA-Engineer
- {summary of work}

---

## Artifacts

- **Story**: `board story show {STORY-ID}`
- **Retrospective**: `.agent/loom/retrospectives/{STORY-ID}.md`

---

## Takeaways

{3-5 key takeaways for future stories:}
1. {Actionable insight}
2. {Process improvement}
3. {Technical learning}

---

**Next Action**: Use `/weave:reflect` to add these learnings to the institutional knowledge base.
```

## Board CLI Commands

```bash
# Get story details
board story show {STORY-ID} --json

# Get tasks
board task list -s {STORY-ID} --json

# Get acceptance criteria
board ac list -s {STORY-ID} --json
board ac progress -s {STORY-ID} --json
```

## When to Use
- After completing a story (automatic in `/loom:finalize`)
- When reviewing past work
- Before planning similar stories
- When extracting learnings for Weave

## Value
Retrospectives provide:
- **Accountability**: Complete record of what happened
- **Learning**: Extract patterns and pain points
- **Context**: Future reference for similar work
- **Knowledge**: Input for Weave reflection
- **Improvement**: Identify process enhancements

## Important Notes
- **Automatic in completion** - `/loom:finalize` generates retrospective automatically
- **Manual when needed** - Use this command to view or regenerate
- **Feeds Weave** - Retrospectives are input for institutional learning
- **Board CLI is source of truth** - All story data comes from `board` commands
