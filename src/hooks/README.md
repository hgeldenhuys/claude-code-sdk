# Hooks SDK

Utilities and helpers for building Claude Code hooks.

## Overview

The Hooks SDK provides:
- **Type definitions** for all 10 hook events
- **Session naming** - Human-friendly names that persist across compactions
- **Hook creators** - Type-safe handlers with automatic session tracking
- **I/O utilities** - Read stdin, write stdout, exit codes
- **Common patterns** - Block tools, inject context, etc.

## Installation

```typescript
import {
  // Session management
  trackSession,
  getSessionName,
  getSessionId,

  // Hook creators
  createSessionStartHook,
  createPreToolUseHook,

  // Patterns
  blockTool,
  injectContext,
  sessionStartContext,
} from 'claude-code-sdk/hooks';
```

## Quick Start

### Session Naming Hook

```typescript
#!/usr/bin/env bun
import { createSessionStartHook, sessionStartContext } from 'claude-code-sdk/hooks';

createSessionStartHook(({ sessionName, session }) => {
  let message = `Session: ${sessionName}`;

  if (session?.sessionIdChanged) {
    message += ` (ID changed from ${session.previousSessionId?.slice(0, 8)}...)`;
  }

  return sessionStartContext(message);
});
```

### Tool Guard Hook

```typescript
#!/usr/bin/env bun
import { createPreToolUseHook, blockTool } from 'claude-code-sdk/hooks';

createPreToolUseHook(({ input }) => {
  if (input.tool_name === 'Bash') {
    const cmd = input.tool_input.command as string;
    if (cmd.includes('rm -rf')) {
      return blockTool('Dangerous command blocked');
    }
  }
});
```

## Hook Events

| Event | When | Can Block | Can Inject |
|-------|------|-----------|------------|
| `SessionStart` | Session begins | No | Yes |
| `SessionEnd` | Session ends | No | No |
| `PreToolUse` | Before tool executes | Yes | No |
| `PostToolUse` | After tool executes | No | Yes |
| `Stop` | Claude stops responding | No | Yes |
| `SubagentStart` | Subagent spawned | No | No |
| `SubagentStop` | Subagent completes | No | No |
| `UserPromptSubmit` | User submits prompt | Yes | Yes |
| `PreCompact` | Before compaction | No | Yes |
| `PermissionRequest` | Permission needed | Yes | No |

## Session Naming

### Why?

Claude Code generates new UUIDs on every session start, resume, clear, and compact. This makes it impossible to resume work by a memorable name.

### How It Works

1. **Track on every hook event** - Call `trackSession()` on any hook
2. **Name-centric storage** - Names are primary, IDs are secondary
3. **History preserved** - All session IDs that used a name are recorded
4. **Last event wins** - Enables fork/snapshot patterns

### API

```typescript
import {
  trackSession,
  getSessionName,
  getSessionId,
  getSessionStore,
  listSessions,
  renameSession,
} from 'claude-code-sdk/hooks';

// Track a session (call on any hook event)
const result = trackSession(sessionId, {
  source: 'startup',        // 'startup' | 'resume' | 'clear' | 'compact'
  name: 'my-project',       // Optional: force a specific name
  cwd: '/path/to/project',
});

// result = {
//   name: 'my-project',
//   sessionId: 'abc-123-...',
//   isNew: false,
//   sessionIdChanged: true,
//   previousSessionId: 'old-456-...',
// }

// Lookups
getSessionName('abc-123-...');  // → 'my-project'
getSessionId('my-project');     // → 'abc-123-...'

// List and filter
const sessions = listSessions({
  namePattern: 'feature-*',
  limit: 10,
  sortBy: 'lastAccessed',
});

// Rename
renameSession('brave-elephant', 'auth-feature');
```

## Hook Creators

Type-safe hook handlers with automatic session tracking:

```typescript
createSessionStartHook((ctx) => {
  // ctx.input - Parsed hook input
  // ctx.session - Tracking result
  // ctx.sessionName - Current name
  return sessionStartContext('Hello!');
});

createPreToolUseHook((ctx) => {
  if (ctx.input.tool_name === 'Bash') {
    return blockTool('Not allowed');
  }
});

createPostToolUseHook((ctx) => {
  return injectContext('Tool completed');
});

createStopHook((ctx) => {
  console.error(`Session ${ctx.sessionName} stopped`);
});
```

### Disable Session Tracking

```typescript
createPreToolUseHook(handler, { trackSession: false });
```

## I/O Utilities

```typescript
import {
  readHookInput,
  readHookInputAsync,
  writeHookOutput,
  exitSuccess,
  exitError,
} from 'claude-code-sdk/hooks';

// Manual hook implementation
const input = readHookInput<PreToolUseInput>();
// ... process ...
writeHookOutput({ decision: 'approve' });
```

## Pattern Helpers

```typescript
import {
  blockTool,
  approveTool,
  modifyToolInput,
  injectContext,
  blockPrompt,
  sessionStartContext,
} from 'claude-code-sdk/hooks';

// PreToolUse patterns
blockTool('Reason for blocking');
approveTool();
modifyToolInput({ ...newInput });

// PostToolUse / Stop patterns
injectContext('Message for Claude');

// UserPromptSubmit patterns
blockPrompt('Prompt blocked');

// SessionStart patterns
sessionStartContext('Welcome!', { ENV_VAR: 'value' });
```

## Types

All hook event types are exported:

```typescript
import type {
  HookEventName,
  SessionSource,
  BaseHookInput,
  SessionStartInput,
  SessionStartOutput,
  PreToolUseInput,
  PreToolUseOutput,
  PostToolUseInput,
  PostToolUseOutput,
  StopInput,
  StopOutput,
  // ... etc
} from 'claude-code-sdk/hooks';
```

## CLI Tool

See [sesh CLI](../../bin/README.md) for the session management command-line tool.

```bash
# Resume by name
claude --resume $(sesh my-project)

# List sessions
sesh list

# Rename
sesh rename brave-elephant my-project
```

## Examples

See [examples/hooks/](../../examples/hooks/) for complete examples:
- `session-namer-hook.ts` - Auto-assign session names
- `tool-guard-hook.ts` - Block dangerous commands
- `session-manager-cli.ts` - CLI usage example
