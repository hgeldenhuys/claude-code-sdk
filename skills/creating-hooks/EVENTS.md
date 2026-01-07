# Claude Code Hook Events Reference

This document provides comprehensive documentation for all 10 Claude Code hook events, including when they fire, input schemas, output handling, matcher support, and practical use cases.

---

## Table of Contents

1. [PreToolUse](#1-pretooluse)
2. [PostToolUse](#2-posttooluse)
3. [UserPromptSubmit](#3-userpromptsubmit)
4. [SessionStart](#4-sessionstart)
5. [SessionEnd](#5-sessionend)
6. [Stop](#6-stop)
7. [SubagentStop](#7-subagentstop)
8. [PermissionRequest](#8-permissionrequest)
9. [PreCompact](#9-precompact)
10. [Notification](#10-notification)

---

## Common Input Fields

All hook events receive JSON input via stdin containing these common fields:

```typescript
{
  session_id: string;           // Unique session identifier
  transcript_path: string;      // Path to conversation JSON file
  cwd: string;                  // Current working directory
  permission_mode: string;      // "default" | "plan" | "acceptEdits" | "dontAsk" | "bypassPermissions"
  hook_event_name: string;      // Name of the event that triggered the hook
}
```

---

## 1. PreToolUse

**Purpose**: Intercept tool calls before execution. Allows blocking, modifying, or auto-approving tool usage.

### When It Fires

- After Claude creates tool parameters
- Before the tool call is processed
- Before any permission checks

### Matcher Support

**Yes** - Matches against tool names (case-sensitive)

**Common Matchers**:
| Matcher | Description |
|---------|-------------|
| `Bash` | Shell command execution |
| `Write` | File creation/overwriting |
| `Edit` | File editing/patching |
| `Read` | File reading |
| `Glob` | File pattern matching |
| `Grep` | Content search |
| `Task` | Subagent task execution |
| `WebFetch` | URL fetching |
| `WebSearch` | Web search operations |
| `mcp__*` | MCP server tools |

### Input Schema

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../session.jsonl",
  "cwd": "/Users/project",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/path/to/file.txt",
    "content": "file content"
  },
  "tool_use_id": "toolu_01ABC123..."
}
```

### Output Handling

**Exit Code Behavior**:
| Exit Code | Behavior |
|-----------|----------|
| `0` | Success - stdout parsed for JSON control |
| `2` | Block tool call - stderr shown to Claude |
| Other | Non-blocking error - stderr shown in verbose mode |

**JSON Output Schema**:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow" | "deny" | "ask",
    "permissionDecisionReason": "Reason for decision",
    "updatedInput": {
      "field_to_modify": "new value"
    }
  },
  "continue": true,
  "stopReason": "Optional stop message",
  "suppressOutput": false,
  "systemMessage": "Optional warning to user"
}
```

**Decision Options**:
| Decision | Effect |
|----------|--------|
| `"allow"` | Bypass permission system, auto-approve |
| `"deny"` | Block tool call, reason shown to Claude |
| `"ask"` | Show permission dialog to user |

### Example Use Cases

1. **Auto-approve safe operations** (read-only files, documentation)
2. **Block dangerous commands** (rm -rf, sudo operations)
3. **Modify tool inputs** (sanitize paths, add defaults)
4. **Enforce coding standards** (prevent deprecated patterns)
5. **Audit tool usage** (log all operations)

### Configuration Example

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/validate-bash.py",
            "timeout": 10
          }
        ]
      },
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/check-write-permissions.sh"
          }
        ]
      }
    ]
  }
}
```

---

## 2. PostToolUse

**Purpose**: React after a tool completes successfully. Allows formatting, linting, logging, or providing feedback to Claude.

### When It Fires

- Immediately after a tool completes successfully
- Only for successful tool executions
- Before Claude processes the result

### Matcher Support

**Yes** - Same matchers as PreToolUse

### Input Schema

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../session.jsonl",
  "cwd": "/Users/project",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/path/to/file.txt",
    "content": "file content"
  },
  "tool_response": {
    "filePath": "/path/to/file.txt",
    "success": true
  },
  "tool_use_id": "toolu_01ABC123..."
}
```

### Output Handling

**Exit Code Behavior**:
| Exit Code | Behavior |
|-----------|----------|
| `0` | Success - stdout parsed for JSON control |
| `2` | Show stderr to Claude (tool already ran) |
| Other | Non-blocking error - stderr shown in verbose mode |

**JSON Output Schema**:

```json
{
  "decision": "block" | undefined,
  "reason": "Explanation for decision",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Additional information for Claude"
  },
  "continue": true,
  "suppressOutput": false,
  "systemMessage": "Optional warning to user"
}
```

### Example Use Cases

1. **Auto-format files** (prettier, biome, eslint --fix)
2. **Run linters** (eslint, typescript checks)
3. **Update indexes** (regenerate imports, update manifests)
4. **Trigger builds** (incremental compilation)
5. **Log operations** (audit trail for file changes)
6. **Validate output** (check generated code compiles)

### Configuration Example

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "biome format --write \"$CLAUDE_PROJECT_DIR\"",
            "timeout": 30
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/log-bash-execution.sh"
          }
        ]
      }
    ]
  }
}
```

---

## 3. UserPromptSubmit

**Purpose**: Intercept user prompts before Claude processes them. Allows validation, context injection, or blocking.

### When It Fires

- When user submits a prompt
- Before Claude begins processing
- After user presses Enter or submits

### Matcher Support

**No** - Matcher field not applicable, omit it

### Input Schema

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../session.jsonl",
  "cwd": "/Users/project",
  "permission_mode": "default",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "Write a function to calculate the factorial of a number"
}
```

### Output Handling

**Exit Code Behavior**:
| Exit Code | Behavior |
|-----------|----------|
| `0` | Success - stdout added as context (plain text or JSON) |
| `2` | Block prompt - stderr shown to user, prompt erased |
| Other | Non-blocking error - stderr shown in verbose mode |

**Context Injection Methods**:

1. **Plain text stdout** (simple): Any non-JSON text is added as context
2. **JSON with additionalContext** (structured): More control over injection

**JSON Output Schema**:

```json
{
  "decision": "block" | undefined,
  "reason": "Shown to user when blocked",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Context to inject"
  },
  "continue": true,
  "suppressOutput": false,
  "systemMessage": "Optional warning to user"
}
```

### Example Use Cases

1. **Inject current context** (git status, time, environment)
2. **Validate prompts** (check for sensitive data, profanity)
3. **Block dangerous requests** (prevent specific operations)
4. **Add project context** (recent changes, open issues)
5. **Enrich prompts** (add relevant documentation)
6. **Rate limiting** (prevent prompt flooding)

### Configuration Example

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/inject-context.sh"
          },
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/validate-prompt.py"
          }
        ]
      }
    ]
  }
}
```

---

## 4. SessionStart

**Purpose**: Initialize session context. Load environment, set variables, inject initial context.

### When It Fires

- When Claude Code starts a new session
- When resuming an existing session
- After `/clear` command
- After manual or auto compact

### Matcher Support

**Yes** - Matches against session start source

**Available Matchers**:
| Matcher | Trigger |
|---------|---------|
| `startup` | Normal session start |
| `resume` | `--resume`, `--continue`, or `/resume` |
| `clear` | `/clear` command |
| `compact` | Auto or manual compact operation |

### Input Schema

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../session.jsonl",
  "cwd": "/Users/project",
  "permission_mode": "default",
  "hook_event_name": "SessionStart",
  "source": "startup"
}
```

### Output Handling

**Exit Code Behavior**:
| Exit Code | Behavior |
|-----------|----------|
| `0` | Success - stdout added as context |
| `2` | N/A - stderr shown to user only |
| Other | Non-blocking error - stderr shown in verbose mode |

**JSON Output Schema**:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Context to inject at session start"
  },
  "continue": true,
  "suppressOutput": false,
  "systemMessage": "Optional message to user"
}
```

### Environment Variable Persistence

SessionStart hooks have access to `CLAUDE_ENV_FILE` for persisting environment variables:

```bash
#!/bin/bash
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo 'export NODE_ENV=development' >> "$CLAUDE_ENV_FILE"
  echo 'export API_KEY=your-key' >> "$CLAUDE_ENV_FILE"
fi
exit 0
```

**Note**: `CLAUDE_ENV_FILE` is ONLY available in SessionStart hooks.

### Example Use Cases

1. **Load project context** (README, CLAUDE.md summary)
2. **Set environment variables** (API keys, paths)
3. **Install dependencies** (npm install, bun install)
4. **Load recent changes** (git log, recent commits)
5. **Fetch open issues** (GitHub issues, JIRA tickets)
6. **Configure tool versions** (nvm use, pyenv activate)

### Configuration Example

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/load-context.sh"
          }
        ]
      },
      {
        "matcher": "resume",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/load-session-state.sh"
          }
        ]
      }
    ]
  }
}
```

---

## 5. SessionEnd

**Purpose**: Clean up when session ends. Log statistics, save state, perform cleanup.

### When It Fires

- When user exits Claude Code
- When `/clear` is executed (before clearing)
- When user logs out
- When user exits at prompt input

### Matcher Support

**No** - Matcher field not applicable

### Input Schema

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../session.jsonl",
  "cwd": "/Users/project",
  "permission_mode": "default",
  "hook_event_name": "SessionEnd",
  "reason": "exit"
}
```

**Reason Values**:
| Reason | Trigger |
|--------|---------|
| `clear` | `/clear` command |
| `logout` | User logged out |
| `prompt_input_exit` | User exited at prompt |
| `other` | Other exit reasons |

### Output Handling

**Exit Code Behavior**:
| Exit Code | Behavior |
|-----------|----------|
| `0` | Success - logged to debug only |
| `2` | N/A - stderr shown to user only |
| Other | Non-blocking error - stderr logged |

**Note**: SessionEnd hooks cannot block session termination.

### Example Use Cases

1. **Log session statistics** (duration, commands run)
2. **Save session state** (for later resume)
3. **Clean up temp files** (remove generated artifacts)
4. **Send notifications** (Slack, email summaries)
5. **Update project state** (commit session notes)
6. **Sync external systems** (update issue trackers)

### Configuration Example

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/log-session.sh"
          },
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/cleanup-temp.sh"
          }
        ]
      }
    ]
  }
}
```

---

## 6. Stop

**Purpose**: Control when Claude finishes responding. Check task completion, force continuation.

### When It Fires

- When the main Claude Code agent finishes responding
- Does NOT fire on user interrupts (Ctrl+C)
- After Claude's final response in a turn

### Matcher Support

**No** - Matcher field not applicable

### Input Schema

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../session.jsonl",
  "cwd": "/Users/project",
  "permission_mode": "default",
  "hook_event_name": "Stop",
  "stop_hook_active": false
}
```

**Important**: `stop_hook_active` is `true` when Claude is already continuing due to a previous Stop hook. Check this to prevent infinite loops!

### Output Handling

**Exit Code Behavior**:
| Exit Code | Behavior |
|-----------|----------|
| `0` | Success - stdout parsed for JSON control |
| `2` | Block stoppage - stderr shown to Claude |
| Other | Non-blocking error - stderr shown in verbose mode |

**JSON Output Schema**:

```json
{
  "decision": "block" | undefined,
  "reason": "Required when blocking - tells Claude what to do next",
  "continue": true,
  "stopReason": "Message shown when continue is false",
  "suppressOutput": false,
  "systemMessage": "Optional warning to user"
}
```

### Prompt-Based Stop Hooks

Stop hooks support `type: "prompt"` for LLM-based evaluation:

```json
{
  "type": "prompt",
  "prompt": "Evaluate if Claude should stop: $ARGUMENTS. Check if all tasks are complete.",
  "timeout": 30
}
```

### Example Use Cases

1. **Verify task completion** (check all TODOs done)
2. **Require test passage** (block until tests pass)
3. **Enforce quality checks** (lint must pass)
4. **Chain workflows** (trigger next step)
5. **Validate deliverables** (all files created)

### Configuration Example

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/check-completion.sh"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Analyze if all user-requested tasks are complete. Context: $ARGUMENTS\n\nRespond with: {\"decision\": \"approve\" or \"block\", \"reason\": \"explanation\"}",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

---

## 7. SubagentStop

**Purpose**: Control when subagents (Task tool) finish. Verify subagent task completion.

### When It Fires

- When a Claude Code subagent (Task tool call) finishes responding
- After the subagent's final response
- Before returning control to main agent

### Matcher Support

**No** - Matcher field not applicable

### Input Schema

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../session.jsonl",
  "cwd": "/Users/project",
  "permission_mode": "default",
  "hook_event_name": "SubagentStop",
  "stop_hook_active": false
}
```

**Important**: Same as Stop, `stop_hook_active` prevents infinite loops.

### Output Handling

**Exit Code Behavior**:
| Exit Code | Behavior |
|-----------|----------|
| `0` | Success - stdout parsed for JSON control |
| `2` | Block stoppage - stderr shown to Claude subagent |
| Other | Non-blocking error - stderr shown in verbose mode |

**JSON Output Schema**:

```json
{
  "decision": "block" | undefined,
  "reason": "Required when blocking - tells subagent what to do next",
  "continue": true,
  "stopReason": "Message shown when continue is false",
  "suppressOutput": false,
  "systemMessage": "Optional warning to user"
}
```

### Prompt-Based SubagentStop Hooks

```json
{
  "type": "prompt",
  "prompt": "Evaluate if this subagent should stop. Input: $ARGUMENTS\n\nCheck if:\n- The subagent completed its assigned task\n- Any errors occurred that need fixing\n\nReturn: {\"decision\": \"approve\" or \"block\", \"reason\": \"explanation\"}"
}
```

### Example Use Cases

1. **Verify subagent output** (check deliverables)
2. **Validate research quality** (sufficient sources)
3. **Ensure code compiles** (syntax checks)
4. **Check test results** (all tests pass)
5. **Verify documentation** (docs updated)

### Configuration Example

```json
{
  "hooks": {
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/verify-subagent-output.sh"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Check if subagent completed its task. Context: $ARGUMENTS",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

---

## 8. PermissionRequest

**Purpose**: Automatically handle permission dialogs. Auto-approve, deny, or modify requests.

### When It Fires

- When user would be shown a permission dialog
- After PreToolUse (if not already decided)
- Before tool execution

### Matcher Support

**Yes** - Same matchers as PreToolUse (tool names)

### Input Schema

Same as PreToolUse:

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../session.jsonl",
  "cwd": "/Users/project",
  "permission_mode": "default",
  "hook_event_name": "PermissionRequest",
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm install"
  },
  "tool_use_id": "toolu_01ABC123..."
}
```

### Output Handling

**Exit Code Behavior**:
| Exit Code | Behavior |
|-----------|----------|
| `0` | Success - stdout parsed for JSON control |
| `2` | Deny permission - stderr shown to Claude |
| Other | Non-blocking error - stderr shown in verbose mode |

**JSON Output Schema**:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow" | "deny",
      "updatedInput": {
        "command": "modified command"
      },
      "message": "Reason for denial (only for deny)",
      "interrupt": false
    }
  },
  "continue": true,
  "suppressOutput": false,
  "systemMessage": "Optional warning to user"
}
```

### Example Use Cases

1. **Auto-approve safe commands** (npm install, bun test)
2. **Block dangerous operations** (rm -rf, sudo)
3. **Modify commands** (add safety flags)
4. **Enterprise policy enforcement** (restrict certain tools)
5. **Workflow automation** (approve known patterns)

### Configuration Example

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/auto-approve-bash.py"
          }
        ]
      },
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/check-write-path.sh"
          }
        ]
      }
    ]
  }
}
```

---

## 9. PreCompact

**Purpose**: Intercept context compaction. Preserve important context before compaction.

### When It Fires

- Before Claude Code runs a compact operation
- Before context is summarized/compacted
- When context window is nearly full (auto) or user requests (`/compact`)

### Matcher Support

**Yes** - Matches against compact trigger

**Available Matchers**:
| Matcher | Trigger |
|---------|---------|
| `manual` | `/compact` command |
| `auto` | Auto-compact (context window full) |

### Input Schema

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../session.jsonl",
  "cwd": "/Users/project",
  "permission_mode": "default",
  "hook_event_name": "PreCompact",
  "trigger": "manual",
  "custom_instructions": "Focus on the API implementation"
}
```

**Note**: `custom_instructions` contains user-provided compact instructions (from `/compact <instructions>`). Empty for auto-compact.

### Output Handling

**Exit Code Behavior**:
| Exit Code | Behavior |
|-----------|----------|
| `0` | Success - stdout logged in verbose mode |
| `2` | N/A - stderr shown to user only |
| Other | Non-blocking error - stderr shown in verbose mode |

**Note**: PreCompact hooks cannot block compaction.

### Example Use Cases

1. **Save context snapshot** (backup before compact)
2. **Log compact events** (track when context is compacted)
3. **Extract key information** (save important decisions)
4. **Update external state** (sync learnings to knowledge base)
5. **Warn about important context** (alert if critical info will be lost)

### Configuration Example

```json
{
  "hooks": {
    "PreCompact": [
      {
        "matcher": "auto",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/save-context-snapshot.sh"
          }
        ]
      },
      {
        "matcher": "manual",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/extract-key-decisions.py"
          }
        ]
      }
    ]
  }
}
```

---

## 10. Notification

**Purpose**: Handle Claude Code notifications. Custom alerts, logging, or integrations.

### When It Fires

- When Claude Code sends any notification
- For permission prompts, idle states, auth events
- For MCP elicitation dialogs

### Matcher Support

**Yes** - Matches against notification type

**Available Matchers**:
| Matcher | Description |
|---------|-------------|
| `permission_prompt` | Permission request notifications |
| `idle_prompt` | Idle for 60+ seconds, waiting for input |
| `auth_success` | Authentication success |
| `elicitation_dialog` | MCP tool needs input |

### Input Schema

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../session.jsonl",
  "cwd": "/Users/project",
  "permission_mode": "default",
  "hook_event_name": "Notification",
  "message": "Claude needs your permission to use Bash",
  "notification_type": "permission_prompt"
}
```

### Output Handling

**Exit Code Behavior**:
| Exit Code | Behavior |
|-----------|----------|
| `0` | Success - logged to debug only |
| `2` | N/A - stderr shown to user only |
| Other | Non-blocking error - stderr logged |

### Example Use Cases

1. **Desktop notifications** (system alerts)
2. **Slack/Discord integration** (team notifications)
3. **Sound alerts** (audio cues)
4. **Mobile push notifications** (remote alerts)
5. **Custom logging** (notification audit trail)
6. **Smart home integration** (visual indicators)

### Configuration Example

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/notify-permission.sh"
          }
        ]
      },
      {
        "matcher": "idle_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/notify-idle.sh"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/log-all-notifications.sh"
          }
        ]
      }
    ]
  }
}
```

---

## Quick Reference Table

| Event | Fires When | Matcher | Can Block | Context Injection |
|-------|------------|---------|-----------|-------------------|
| **PreToolUse** | Before tool executes | Tool name | Yes | No |
| **PostToolUse** | After tool completes | Tool name | No (feedback only) | Yes |
| **UserPromptSubmit** | User submits prompt | No | Yes | Yes |
| **SessionStart** | Session begins | Source type | No | Yes |
| **SessionEnd** | Session ends | No | No | No |
| **Stop** | Claude finishes responding | No | Yes | Yes (via reason) |
| **SubagentStop** | Subagent finishes | No | Yes | Yes (via reason) |
| **PermissionRequest** | Permission dialog shown | Tool name | Yes | No |
| **PreCompact** | Before context compact | Trigger type | No | No |
| **Notification** | Notification sent | Notification type | No | No |

---

## Execution Details

- **Timeout**: 60 seconds default, configurable per hook
- **Parallelization**: All matching hooks run in parallel
- **Deduplication**: Identical commands are deduplicated
- **Environment Variables**:
  - `CLAUDE_PROJECT_DIR` - Absolute path to project root
  - `CLAUDE_CODE_REMOTE` - `"true"` if running in web environment
  - `CLAUDE_ENV_FILE` - (SessionStart only) Path to persist env vars
  - `CLAUDE_PLUGIN_ROOT` - (Plugin hooks) Path to plugin directory

---

## See Also

- [SKILL.md](./SKILL.md) - Main hook creation guide
- [TEMPLATES.md](./TEMPLATES.md) - Ready-to-use hook templates
- [EXAMPLES.md](./EXAMPLES.md) - Real-world hook examples
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues and solutions
