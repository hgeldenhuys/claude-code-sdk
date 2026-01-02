---
description: Complete autonomous workflow - ideate, plan, and execute in one command (Loom: Full Cycle)
---

# /loom:run - Full Autonomous Workflow

**Purpose:** Take a feature idea from concept to implementation autonomously in one command.

## Board CLI Integration (Required)

This command uses **Trak Board CLI exclusively** for all story/task/AC management.

## Workflow Overview

```
User Idea → [Ideate] → Story → [Plan] → Tasks → [Execute] → Implementation
                ↓           ↓              ↓
          loom-ideator  Create via      Main Agent spawns
                        Board CLI       specialists directly
```

## Critical Constraint

**Sub-agents cannot spawn other sub-agents.** Only the main agent has the Task tool.

## Model Policy

- **opus** - For implementation tasks (specialists, ideator)
- **haiku** - For quick validation/status tasks
- **Never use sonnet** - Stick to opus/haiku only

## Input

The user provides either:
- **New idea**: A feature description to ideate from scratch
- **Existing story**: A story ID to resume (e.g., "NOTIFY-002")

## Execution

### Phase 1: Ideation

Use the `loom-ideator` agent to transform the idea into a story:

```typescript
Task({
  subagent_type: "loom-ideator",
  model: "opus",
  description: "Ideate feature: {brief}",
  prompt: "Transform this idea into a story: {user's idea}"
})
```

The ideator will create the story via Board CLI:
```bash
board feature create -c ${CODE} -n "Name" -d "Description"
board story create -f ${CODE} -t "Title" -w "Why" -d "Description" -s planned
board ac add -s ${STORY_ID} -d "AC description" -c AC-001
```

**Gate Check:** Verify story exists in board with ACs.

### Phase 2: Planning

Create tasks via Board CLI:

```bash
# For simple stories, create tasks directly
board task create -s ${STORY_ID} -t "Task title" -a backend-dev -p P1 -c medium

# For complex stories, delegate to architect agent
```

**Gate Check:** Verify tasks exist with actor assignments.

### Phase 3: Execution (Main Agent Direct)

Main agent executes directly:

1. **Load story from Board CLI:**
```bash
board story show ${STORY_ID} --json
```

2. **Mark story as in-progress:**
```bash
board story update ${STORY_ID} -s in_progress
board session start -s ${STORY_ID}
```

3. **Group tasks by actor** from `board task list -s ${STORY_ID} --json`

4. **Spawn specialists in parallel:**

```typescript
// Single message with multiple Task calls
Task({subagent_type: "backend-dev", model: "opus", ...})
Task({subagent_type: "frontend-dev", model: "opus", ...})
```

5. **Update task statuses:**
```bash
board task status ${TASK_ID} completed
```

6. **Validate ACs:**
```bash
board ac verify ${AC_ID} --evidence "..."
```

7. **Complete story:**
```bash
board story update ${STORY_ID} -s completed
board session end
```

### Specialist Agents

| Agent | Use For | Model |
|-------|---------|-------|
| `backend-dev` | API, services, database | opus |
| `frontend-dev` | React, components, styling | opus |
| `qa-engineer` | Tests, validation | opus |
| `architect` | Design, schemas | opus |
| `devops` | Infrastructure, CI/CD | opus |
| `tech-writer` | Documentation | opus |
| `general-purpose` | Fallback | opus |

## Output Format

After each phase, report concisely:

```markdown
✅ Phase 1: Ideation Complete
   Story: NOTIFY-003 - {title}
   ACs: {count} acceptance criteria defined
   View: board story show NOTIFY-003

✅ Phase 2: Planning Complete
   Tasks: {count} tasks created
   Actors: backend-dev, frontend-dev, qa-engineer
   View: board task list -s NOTIFY-003

✅ Phase 3: Execution Complete
   Tasks: {completed}/{total}
   ACs: {verified}/{total} verified
   Status: completed | needs_review

🎯 Next: /loom:finalize NOTIFY-003
```

## Usage Examples

**New feature:**
```
/loom:run Add a dark mode toggle to the settings page
```

**Resume from story:**
```
/loom:run NOTIFY-002
```

**With feature prefix:**
```
/loom:run SETTINGS: Add dark mode toggle with system preference detection
```

## Board CLI Quick Reference

```bash
# Story operations
board story create -f FEATURE -t "Title" -w "Why" -d "Description" -s planned
board story show STORY-ID --json
board story update STORY-ID -s in_progress
board story update STORY-ID -s completed

# Task operations
board task create -s STORY-ID -t "Title" -a backend-dev -p P1 -c medium
board task list -s STORY-ID --json
board task status TASK-ID completed

# AC operations
board ac add -s STORY-ID -d "Description" -c AC-001
board ac verify AC-ID --evidence "..."
board ac progress -s STORY-ID --json

# Session operations
board session start -s STORY-ID
board session end
```

## Important Notes

- This is a **long-running command** - may take 10-30 minutes
- **Main agent spawns specialists directly** in Phase 3
- All progress tracked via Board CLI
- If interrupted, resume with `/loom:run {story-id}`
- Always recommend `/loom:finalize` after completion
- View progress anytime with `board-tui` or `board story show`
