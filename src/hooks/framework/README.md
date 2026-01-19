# Hook Framework

A flexible hook orchestration system for Claude Code that provides sequential/parallel execution, dependency chains, shared context, and cross-handler communication.

## Table of Contents

- [Overview](#overview)
- [Handler Pipeline](#handler-pipeline)
- [Handler Results & Cross-Handler Communication](#handler-results--cross-handler-communication)
- [Built-in Handlers](#built-in-handlers)
- [Environment Variables for External Hooks](#environment-variables-for-external-hooks)
- [Creating Custom Handlers](#creating-custom-handlers)

---

## Overview

The hook framework orchestrates multiple handlers for each Claude Code hook event. Handlers run in priority order, can depend on each other, and share context through a pipeline.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Hook Event Flow                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Claude Code Event (e.g., PreToolUse)                               │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Pipeline Context                          │    │
│  │  ┌─────────────────────────────────────────────────────┐    │    │
│  │  │ • event: HookEvent                                   │    │    │
│  │  │ • eventType: string                                  │    │    │
│  │  │ • state: shared mutable state                        │    │    │
│  │  │ • results: Map<string, HandlerResult>  ◄── KEY!      │    │    │
│  │  │ • sessionId: string                                  │    │    │
│  │  │ • cwd: string                                        │    │    │
│  │  └─────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              Handlers (sorted by priority)                   │    │
│  │                                                              │    │
│  │  Priority 5:  turn-tracker    ──► results['turn-tracker-*'] │    │
│  │  Priority 10: session-naming  ──► results['session-naming-*']│    │
│  │  Priority 50: event-logger    ──► results['event-logger-*'] │    │
│  │  Priority 100: your-handler   ──► can READ all above results │    │
│  │                                                              │    │
│  └─────────────────────────────────────────────────────────────┘    │
│           │                                                          │
│           ▼                                                          │
│  Hook Output (block/approve, context injection, etc.)               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Handler Pipeline

### Execution Order

Handlers execute in **priority order** (lower number = runs first):

| Priority | Handler | Purpose |
|----------|---------|---------|
| 5 | `turn-tracker` | Tracks turn sequences, provides turn IDs |
| 10 | `session-naming` | Generates/retrieves session names |
| 50 | `event-logger` | Logs events to JSONL files |
| 100 | (default) | Custom handlers |

### Handler ID Naming Convention

When handlers are registered for specific events, their IDs are **suffixed with the event type**:

```
{handler-id}-{EventType}
```

Examples:
- `turn-tracker-SessionStart`
- `turn-tracker-PreToolUse`
- `turn-tracker-Stop`
- `session-naming-SessionStart`
- `event-logger-PostToolUse`

This allows the same handler definition to be registered for multiple events while maintaining unique IDs in the results map.

---

## Handler Results & Cross-Handler Communication

### The `context.results` Map

After each handler completes, its result is stored in `context.results`:

```typescript
// context.results is a Map<string, HandlerResult>
// Key format: "{handler-id}-{EventType}"

interface HandlerResult {
  success: boolean;
  data?: unknown;        // ◄── Handler-specific output data
  error?: Error;
  durationMs: number;
  block?: boolean;
  blockReason?: string;
  contextToInject?: string;
}
```

### Accessing Results from Previous Handlers

Later handlers can read results from earlier handlers:

```typescript
// In a custom handler with priority > 5 (runs after turn-tracker)
const turnTrackerResult = ctx.results.get('turn-tracker-PreToolUse');
if (turnTrackerResult?.data) {
  const { turnId, sequence } = turnTrackerResult.data as {
    turnId: string;    // e.g., "abc-123-def:5"
    sequence: number;  // e.g., 5
  };
  console.log(`Current turn: ${turnId}`);
}
```

### The `findResultByPrefix()` Helper

Since handler IDs are event-suffixed, use prefix matching to find results:

```typescript
// From command-executor.ts
function findResultByPrefix(
  results: Map<string, HandlerResult>,
  prefix: string
): HandlerResult | undefined {
  for (const [key, value] of results) {
    if (key === prefix || key.startsWith(`${prefix}-`)) {
      return value;
    }
  }
  return undefined;
}

// Usage:
const turnResult = findResultByPrefix(ctx.results, 'turn-tracker');
// Matches: turn-tracker, turn-tracker-PreToolUse, turn-tracker-Stop, etc.
```

### Important: Sequential Execution Required

For handler results to be available to later handlers, **`parallelExecution` must be `false`** in hooks.yaml:

```yaml
# hooks.yaml
parallelExecution: false  # ◄── Required for cross-handler communication
```

With parallel execution, handlers run concurrently and may not see each other's results.

---

## Built-in Handlers

### turn-tracker

**Purpose:** Tracks turns within a session. A "turn" is the period between Stop events.

**Priority:** 5 (runs first)

**Events:** SessionStart, Stop, SubagentStop, UserPromptSubmit, PreToolUse, PostToolUse

**Turn ID Format:**
```
{session_id}:{sequence}
```

**Subagent Turn ID Format:**
```
{session_id}:{sequence}:s:{subagent_sequence}
```

**Result Data by Event:**

| Event | Result Data |
|-------|-------------|
| SessionStart | `{ turnId, sequence: 1 }` |
| Stop | `{ completedTurnId, nextTurnId, sequence }` |
| SubagentStop | `{ subagentTurnId, turnId, subagentSeq }` |
| PreToolUse, PostToolUse, etc. | `{ turnId, sequence }` (read-only) |

**State Storage:** `~/.claude/turns/{session_id}.json`

```json
{
  "sequence": 5,
  "subagentSeq": 0
}
```

**Example: Reading Turn ID in Custom Handler:**

```typescript
const handler: HandlerDefinition = {
  id: 'my-handler',
  priority: 100, // After turn-tracker (priority 5)
  handler: async (ctx) => {
    // Find turn-tracker result (matches any event suffix)
    const turnResult = findResultByPrefix(ctx.results, 'turn-tracker');

    if (turnResult?.data) {
      const data = turnResult.data as { turnId?: string; sequence?: number };
      console.log(`Turn: ${data.turnId}, Sequence: ${data.sequence}`);
    }

    return { success: true };
  }
};
```

### session-naming

**Purpose:** Generates human-friendly session names (adjective-animal pattern).

**Priority:** 10

**Events:** SessionStart

**Result Data:**
```typescript
{
  sessionName: string;  // e.g., "jolly-squid"
  isNew: boolean;
  source: 'generated' | 'existing' | 'user';
}
```

### event-logger

**Purpose:** Logs all hook events to JSONL files for later analysis.

**Priority:** 50

**Events:** All events

**Output Location:** `~/.claude/hooks/{project-path}/hooks.jsonl`

---

## Environment Variables for External Hooks

When executing external command hooks, the framework sets environment variables with data from built-in handlers:

| Variable | Source | Description |
|----------|--------|-------------|
| `CLAUDE_TURN_ID` | turn-tracker | Current turn ID (e.g., "abc-123:5") |
| `CLAUDE_TURN_SEQUENCE` | turn-tracker | Turn sequence number |
| `CLAUDE_SESSION_NAME` | session-naming | Human-friendly name (e.g., "jolly-squid") |
| `CLAUDE_SESSION_ID` | context | Full session UUID |
| `CLAUDE_EVENT_TYPE` | context | Hook event type |
| `CLAUDE_CWD` | context | Working directory |

**Example External Hook:**

```bash
#!/bin/bash
# my-hook.sh

echo "Turn: $CLAUDE_TURN_ID"
echo "Session: $CLAUDE_SESSION_NAME"
echo "Event: $CLAUDE_EVENT_TYPE"
```

---

## Creating Custom Handlers

### Basic Handler

```typescript
import type { HandlerDefinition, PipelineContext } from './types';

const myHandler: HandlerDefinition = {
  id: 'my-custom-handler',
  name: 'My Custom Handler',
  priority: 100,  // Runs after built-in handlers
  handler: async (ctx: PipelineContext) => {
    // Access event data
    const { event, eventType, sessionId } = ctx;

    // Access results from earlier handlers
    const turnResult = findResultByPrefix(ctx.results, 'turn-tracker');
    const sessionResult = findResultByPrefix(ctx.results, 'session-naming');

    // Do your work...

    return {
      success: true,
      data: { /* your output data */ }
    };
  }
};
```

### Handler with Dependencies

```typescript
const dependentHandler: HandlerDefinition = {
  id: 'dependent-handler',
  priority: 150,
  dependsOn: ['turn-tracker', 'session-naming'], // Wait for these
  handler: async (ctx) => {
    // Guaranteed to have turn-tracker and session-naming results
    const turnData = ctx.results.get('turn-tracker-' + ctx.eventType)?.data;
    return { success: true };
  }
};
```

### Handler with Conditions

```typescript
const conditionalHandler: HandlerDefinition = {
  id: 'bash-only-handler',
  condition: (ctx) => {
    // Only run for Bash tool events
    const event = ctx.event as { tool_name?: string };
    return event.tool_name === 'Bash';
  },
  handler: async (ctx) => {
    // Only executes for Bash tool uses
    return { success: true };
  }
};
```

---

## Pipeline Configuration

```yaml
# hooks.yaml
parallelExecution: false  # Required for handler result sharing

builtins:
  turn-tracker:
    enabled: true
    options:
      preserve_on_resume: true
      inject_context: false

  session-naming:
    enabled: true

  event-logger:
    enabled: true
    options:
      include_input: true
      include_output: true
```

---

## Debugging Handler Communication

To debug what's in `context.results`:

```typescript
const debugHandler: HandlerDefinition = {
  id: 'debug-results',
  priority: 999, // Run last
  handler: async (ctx) => {
    console.log('=== Handler Results ===');
    for (const [key, result] of ctx.results) {
      console.log(`${key}:`, JSON.stringify(result.data, null, 2));
    }
    return { success: true };
  }
};
```

Or check the logged hook events:

```bash
# View recent hook events with handler results
bun run hook-events . --last 5

# Search for specific handler data
bun run hook-events search "turn-tracker"
```
