---
description: Execute planned story with main agent spawning specialists directly
---

# /loom:start - Execute Story

**Purpose:** Execute a planned story by spawning specialist agents directly from the main agent.

**Architecture:** Main agent reads story from Board CLI and spawns specialists in parallel batches.

## Critical Constraint

**Sub-agents cannot spawn other sub-agents.** Only the main agent has access to the Task tool.

## Board CLI Integration (Required)

This command uses **Trak Board CLI exclusively** for story/task management. No file-based storage.

**Board CLI Commands:**
```bash
# Get story with tasks
board story show ${STORY_ID} --json

# Update story status
board story update ${STORY_ID} -s in_progress

# Update task status
board task status ${TASK_ID} in_progress
board task status ${TASK_ID} completed

# Start a session
board session start -s ${STORY_ID}

# End session
board session end
```

## Model Policy

- **opus** - For complex implementation tasks (backend-dev, frontend-dev, architect)
- **haiku** - For simpler/faster tasks (validation, status updates)
- **Never use sonnet** - Stick to opus/haiku only

## Input

`$ARGUMENTS` - Story ID to execute (e.g., PROD-001, NOTIFY-002)

## Execution Flow

```
Main Agent
    │
    ├─► board story show ${STORY_ID} --json
    │
    ├─► board story update ${STORY_ID} -s in_progress
    │
    ├─► board session start -s ${STORY_ID}
    │
    ├─► Group tasks by actor
    │
    ├─► Spawn specialists in parallel
    │         ├── backend-dev (tasks 1, 2)
    │         └── frontend-dev (task 3)
    │
    ├─► Update task statuses via board CLI
    │
    ├─► Validate ACs
    │
    └─► board session end
```

## Step 1: Load Story from Board CLI

```bash
# Get story with full details including tasks
board story show ${STORY_ID} --json
```

**Validate:**
- Story exists
- Status is `planned`
- Has tasks with `status === "pending"`

**If invalid:**
- No story → "Run /loom:ideate first"
- No tasks → "Run /loom:plan ${STORY_ID} first"

## Step 2: Start Execution Session

```bash
# Mark story as in-progress
board story update ${STORY_ID} -s in_progress

# Start board session for tracking
board session start -s ${STORY_ID}
```

## Step 3: Group Tasks by Actor

Group tasks for efficient parallel execution:

```
backend-dev: [task1, task2, task5]
frontend-dev: [task3]
qa-engineer: [task4, task6]
```

## Step 4: Execute Tasks

For each actor group, spawn specialists **in parallel** (multiple Task calls in single message):

### Specialist Agents

| Actor | Description | Model |
|-------|-------------|-------|
| `backend-dev` | API, services, database, repositories | opus |
| `frontend-dev` | React components, hooks, state, styling | opus |
| `qa-engineer` | Tests, validation, acceptance criteria | opus |
| `architect` | System design, schemas, tech decisions | opus |
| `devops` | Infrastructure, CI/CD, deployment | opus |
| `tech-writer` | Documentation, READMEs, retrospectives | opus |
| `general-purpose` | Fallback if specialist not available | opus |

### Spawn Pattern

```typescript
// First, mark tasks as in_progress
for (const task of actorTasks) {
  await exec(`board task status ${task.id} in_progress`);
}

// Then spawn specialist
Task({
  subagent_type: actor,  // "backend-dev", "frontend-dev", etc.
  model: "opus",
  description: `Execute tasks for ${STORY_ID}`,
  prompt: `
    Story: ${story.title}

    Execute these tasks:

    ## Task 1: ${task.title}
    ${task.description}

    ## Task 2: ${task.title}
    ${task.description}

    For each task:
    1. Implement the changes
    2. Report files created/modified
    3. Note any decisions

    Return summary of completed work.
  `
})
```

### Parallel Execution

**Critical:** Spawn multiple agents in a **single message** to run them in parallel:

```
[Single response with multiple Task calls:]

Task({subagent_type: "backend-dev", model: "opus", ...})
Task({subagent_type: "frontend-dev", model: "opus", ...})
```

### Update Task Status After Completion

```bash
# After specialist completes
board task status ${TASK_ID} completed
```

## Step 5: Validate Acceptance Criteria

After all tasks complete, validate each AC:

```bash
# Get AC list
board ac list -s ${STORY_ID} --json

# Mark AC as verified
board ac verify ${AC_ID} --evidence "Test passes, endpoint returns 200"

# Or mark as failed
board ac fail ${AC_ID} --reason "Test fails with error X"
```

## Step 6: Complete Session

```bash
# Update story status
board story update ${STORY_ID} -s completed

# End the board session
board session end
```

## Step 7: Report Results

```markdown
✅ Execution Complete: ${STORY_ID}

**Tasks:** 10/10 completed
- Task 1: Create schema ✅ (backend-dev)
- Task 2: Create component ✅ (frontend-dev)
- Task 3: Add API endpoint ✅ (backend-dev)
- ...

**Acceptance Criteria:** 5/5 verified
- AC-001: Users can create items ✅
- AC-002: Items persist to database ✅
- ...

**Specialists:** backend-dev, frontend-dev, qa-engineer

**Commands:**
- **View story:** board story show ${STORY_ID}
- **View in TUI:** board-tui

**Next:** /loom:finalize ${STORY_ID}
```

## Error Handling

**Specialist not found:**
- Retry with `general-purpose` agent
- Log which specialist was unavailable

**Task fails:**
- Mark task as failed: `board task status ${TASK_ID} blocked`
- Continue with other tasks
- Report all failures at end

**AC validation fails:**
- Mark AC as failed: `board ac fail ${AC_ID} --reason "..."`
- Report which ACs failed with evidence
- Status remains "in-progress"

## Example Execution

```
Reading story NOTIFY-002 from board...
Found 9 tasks.

Starting session...
board story update NOTIFY-002 -s in_progress
board session start -s NOTIFY-002

Executing tasks (grouped by actor):

backend-dev (7 tasks):
├── board task status 64ca0837 in_progress
├── Spawning backend-dev agent...
└── [completed: db.ts, transaction-tracker.ts modified]

qa-engineer (2 tasks):
├── board task status 5f91e993 in_progress
├── Spawning qa-engineer agent...
└── [completed: tests created, all pass]

Updating task statuses...
board task status 64ca0837 completed
board task status 8fe4aaed completed
...

Validating ACs...
board ac verify AC-001 --evidence "Transaction persisted in <100ms"
board ac verify AC-002 --evidence "SQLite fallback works correctly"
...

✅ All tasks complete, all ACs verified

board story update NOTIFY-002 -s completed
board session end

Next: /loom:finalize NOTIFY-002
```

## Success Criteria

- ✅ Story loaded from Board CLI
- ✅ Tasks grouped by actor
- ✅ Specialists spawned in parallel
- ✅ Task statuses updated via board CLI
- ✅ All ACs validated with evidence
- ✅ Session tracked via board CLI
- ✅ `/loom:finalize` recommended

## Board CLI Quick Reference

```bash
# Story operations
board story show STORY-ID --json
board story update STORY-ID -s in_progress
board story update STORY-ID -s completed

# Task operations
board task list -s STORY-ID --json
board task status TASK-ID in_progress
board task status TASK-ID completed
board task status TASK-ID blocked

# AC operations
board ac list -s STORY-ID --json
board ac verify AC-ID --evidence "..."
board ac fail AC-ID --reason "..."

# Session operations
board session start -s STORY-ID
board session end
```
