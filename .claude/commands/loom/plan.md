---
description: Plan story into tasks (Loom: Planning Phase)
---

# /loom:plan - Break Story into Tasks

**Purpose:** Decompose user story into actionable tasks with dependencies.

**Strategy:** Simple stories can be planned inline. Complex stories delegate to Architect.

## Board CLI Integration (Required)

This command uses **Trak Board CLI exclusively** for task storage. No file-based storage.

**Board CLI Commands:**
```bash
# Get story details
board story show ${STORY_ID} --json

# Create task
board task create -s ${STORY_ID} -t "Title" -d "Description" -a backend-dev -p P1 -c medium

# List tasks for story
board task list -s ${STORY_ID} --json

# Update task status
board task status ${TASK_ID} in_progress
```

## Input

`$ARGUMENTS` - Story ID to plan (e.g., "PROD-001", "NOTIFY-002")

## Execution Steps

### Step 1: Load Story from Board CLI

```bash
# Get story with full details
board story show ${STORY_ID} --json
```

**Verify:**
- Story exists
- Status is `planned` or `draft`
- Has acceptance criteria defined

**If invalid:**
- No story → "Run /loom:ideate first"
- No ACs → "Story needs acceptance criteria"

### Step 2: Assess Complexity

**Simple Story Criteria (can plan inline):**
- ✅ ≤3 acceptance criteria
- ✅ Follows known pattern (CRUD, API endpoint, CLI command)
- ✅ Clear scope

**Complex Story Criteria (delegate to Architect):**
- ❌ >3 acceptance criteria
- ❌ Cross-cutting concerns
- ❌ Novel feature requiring design decisions
- ❌ Multiple subsystems (backend + frontend + CLI)

### Step 3a: Simple Bypass (Plan Inline)

For simple stories, create tasks directly via Board CLI:

**Pattern: Add API Endpoint**
```bash
# Task 1: Database schema
board task create -s ${STORY_ID} \
  -t "Create database schema and migration" \
  -d "Create schema. Generate migration. AC Coverage: AC-001." \
  -a backend-dev -p P1 -c low

# Task 2: API endpoint
board task create -s ${STORY_ID} \
  -t "Implement API endpoint and service layer" \
  -d "Create endpoint. Wire to service layer. AC Coverage: AC-001." \
  -a backend-dev -p P1 -c medium

# Task 3: Tests
board task create -s ${STORY_ID} \
  -t "Write integration tests" \
  -d "Create tests. Validate AC-001." \
  -a qa-engineer -p P1 -c low
```

**Pattern: Add CLI Command**
```bash
board task create -s ${STORY_ID} \
  -t "Implement CLI command handler" \
  -d "Create command. Add to CLI registry. AC Coverage: AC-001." \
  -a cli-dev -p P1 -c medium

board task create -s ${STORY_ID} \
  -t "Write CLI tests" \
  -d "Create tests. Validate command behavior. AC Coverage: AC-001." \
  -a cli-qa -p P1 -c low
```

### Step 3b: Architect Delegation (Complex Stories)

For complex stories, delegate to Architect:

```typescript
Task({
  subagent_type: "architect",
  model: "opus",
  description: `Create task breakdown for ${STORY_ID}`,
  prompt: `
You are the Solutions Architect for Loom SDLC.

**Story to Plan:** ${STORY_ID}

## Your Task

First, read the story from the Board CLI:

\`\`\`bash
board story show ${STORY_ID} --json
\`\`\`

Then create tasks using the Board CLI:

## Requirements

1. **Analyze acceptance criteria** - What needs to be built?
2. **Break into atomic tasks** - Each task should:
   - Be assignable to a single actor
   - Have clear description
   - Cover one or more ACs
   - Be completable in one agent session
3. **Assign complexity** - low, medium, or high
4. **Map to ACs** - Ensure every AC is covered

## Create Tasks via Board CLI

For each task, use:

\`\`\`bash
board task create -s ${STORY_ID} \\
  -t "Task title" \\
  -d "Task description. AC Coverage: AC-001, AC-002." \\
  -a ${ACTOR} \\
  -p P1 \\
  -c ${COMPLEXITY}
\`\`\`

## Available Actors

- \`architect\` - Design, schema, API contracts
- \`backend-dev\` - Backend implementation, APIs, services
- \`frontend-dev\` - UI components, client logic
- \`qa-engineer\` - Testing, validation, E2E
- \`cli-dev\` - CLI commands, scripts
- \`devops\` - Deployment, infrastructure

## Output

After creating all tasks, report:

✅ Planning Complete: ${STORY_ID}

**Tasks Created:** X
1. Task title (actor)
2. Task title (actor)
...

**Next Step:** /loom:start ${STORY_ID}
`
})
```

### Step 4: Verify Tasks Created

```bash
# List all tasks for the story
board task list -s ${STORY_ID} --json
```

Validate:
- At least one task exists
- All ACs have task coverage
- Tasks have valid actors assigned

### Step 5: Report to User

```markdown
✅ Planning Complete: ${STORY_ID}

## Task Breakdown (${taskCount} tasks)

| # | Task | Actor | Priority | Complexity |
|---|------|-------|----------|------------|
| 1 | Task title | backend-dev | P1 | medium |
| 2 | Task title | qa-engineer | P1 | low |

## Coverage Analysis
- ✅ All ${acCount} acceptance criteria covered

## Commands
- **View tasks:** board task list -s ${STORY_ID}
- **View in TUI:** board-tui

## Next Steps

**Start execution:**
\`/loom:start ${STORY_ID}\`
```

## Success Criteria

Planning is complete when:
- ✅ Tasks created in Board CLI
- ✅ Each task has actor, priority, complexity
- ✅ All acceptance criteria covered by tasks
- ✅ Tasks viewable via `board task list` and `board-tui`

## Error Handling

**Story not found:**
- Suggest `/loom:ideate` to create story first

**Story already has tasks:**
- Ask user if they want to add more tasks or re-plan
- Show current task breakdown

## Board CLI Quick Reference

```bash
# Create task
board task create -s STORY-ID -t "Task title" -a backend-dev -p P1 -c medium

# List tasks for a story
board task list -s STORY-ID

# Update task status
board task status TASK-ID in_progress

# Get task details
board task show TASK-ID
```
