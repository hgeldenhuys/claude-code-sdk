---
description: Quick progress report for all active stories (Loom: Standup View)
---

# /loom:standup - Quick Progress Report

**Purpose:** Give a fast, table-based overview of all active work using the Board CLI.

## Board CLI Integration (Required)

This command uses **Trak Board CLI exclusively** for querying stories, tasks, and ACs.

**Board CLI Commands:**
```bash
# List all stories (excludes archived by default)
board story list --json

# List all stories INCLUDING archived
board story list --include-archived --json

# Get story details
board story show ${STORY_ID} --json

# Get AC progress
board ac progress -s ${STORY_ID} --json

# List tasks for a story
board task list -s ${STORY_ID} --json

# List only flagged tasks (Trak v0.4.0)
board task list -s ${STORY_ID} --flagged true --json
```

## Usage

```bash
# Report on all active stories
/loom:standup

# Report on specific feature
/loom:standup NOTIFY

# Report on specific story
/loom:standup NOTIFY-002
```

## Execution Steps

### Step 1: Load Active Stories from Board CLI

```bash
# Get all stories (automatically excludes archived stories)
board story list --json
```

Filter for active stories (status: in_progress, planned, draft).

**Note:** Archived stories are automatically excluded by default. Use `--include-archived` only if explicitly requested.

### Step 2: Get Details for Each Story

For each active story:

```bash
# Get story details
board story show ${STORY_ID} --json

# Get AC progress
board ac progress -s ${STORY_ID} --json

# Get task list
board task list -s ${STORY_ID} --json
```

### Step 3: Generate Report

```
╔══════════════════════════════════════════════════════════════════╗
║                    LOOM STANDUP REPORT                            ║
║                    2025-12-11 00:15 UTC                           ║
╚══════════════════════════════════════════════════════════════════╝

┌────────────────────────────────────────────────────────────────┐
│ ACTIVE STORIES                                                  │
├──────────┬─────────────────────┬──────────┬──────────┬─────────┤
│ Story ID │ Title               │ Status   │ ACs      │ Tasks   │
├──────────┼─────────────────────┼──────────┼──────────┼─────────┤
│ NOTIFY-001│ Fix Discord Summary │ progress │ 0/3 ✓    │ 1/5 ✓   │
├──────────┼─────────────────────┼──────────┼──────────┼─────────┤
│ NOTIFY-002│ SQLite Transaction │ planned  │ 0/6 ✓    │ 0/9 ✓   │
└──────────┴─────────────────────┴──────────┴──────────┴─────────┘

┌────────────────────────────────────────────────────────────────┐
│ QUICK STATS                                                     │
├─────────────────────────────────────────────────────────────────┤
│ Total Active Stories: 2                                         │
│ Stories In Progress: 1                                          │
│ Stories Planned: 1                                              │
│ Total ACs (active): 9                                           │
│ Total Tasks (active): 14                                        │
│ Flagged Tasks: 2 🚩                                              │
└─────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│ 🚩 FLAGGED TASKS (Needs Attention)                              │
├─────────────────────────────────────────────────────────────────┤
│ T-003: Implement auth middleware (NOTIFY-001)                   │
│   → Blocked: Waiting on external API access                     │
│ T-007: Write integration tests (NOTIFY-002)                     │
│   → Blocked: Dependencies not yet complete                      │
└─────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│ RECOMMENDATIONS                                                 │
├─────────────────────────────────────────────────────────────────┤
│ NOTIFY-001:                                                     │
│   • Continue with remaining tasks                               │
│   • 4 tasks pending                                             │
│                                                                 │
│ NOTIFY-002:                                                     │
│   • Ready to start: /loom:start NOTIFY-002                      │
└─────────────────────────────────────────────────────────────────┘
```

### Step 4: Check for Flagged Tasks

Query for flagged tasks across all active stories:

```bash
# For each active story
board task list -s ${STORY_ID} --flagged true --json
```

Flagged tasks indicate blockers that need attention. Display them prominently in the report.

### Step 5: Detect Issues

Automatically flag common problems:

**Flagged tasks (🚩):**
- Tasks explicitly flagged as needing attention
- Use `board task update ${TASK_ID} --flagged false` when resolved

**Blocked stories:**
- AC failing
- Tasks blocked

**Stale work:**
- Story in-progress but no recent updates

## Output Format

- Use tables for structured data
- Use progress indicators for visual progress
- Highlight issues with warning sections
- Provide actionable recommendations

## Commands to View More Detail

```bash
# View specific story
board story show STORY-ID

# View tasks for story
board task list -s STORY-ID

# View AC progress
board ac progress -s STORY-ID

# Open TUI for interactive view
board-tui
```

## Success Criteria

User should be able to:
- ✅ See all active work at a glance
- ✅ Identify what's blocked or needs attention
- ✅ Know what to do next
- ✅ Understand progress without reading logs

**Time to insight: <10 seconds**
