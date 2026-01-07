---
name: creating-hooks
description: Guide for implementing Claude Code hooks. Use when creating event-driven automation, auto-linting, validation, or context injection. Covers all hook events, matchers, exit codes, and environment variables.
allowed-tools: ["Read", "Write", "Edit", "Bash"]
---

# Creating Hooks

Build event-driven automation for Claude Code using hooks - scripts that execute at specific workflow points.

## Quick Reference

| Hook Event | When It Fires | Uses Matcher | Common Use Cases |
|------------|---------------|--------------|------------------|
| `PreToolUse` | Before tool executes | Yes | Validation, auto-approval, input modification |
| `PostToolUse` | After tool completes | Yes | Auto-formatting, linting, logging |
| `PermissionRequest` | User shown permission dialog | Yes | Auto-allow/deny, policy enforcement |
| `Notification` | Claude sends notification | Yes | Custom alerts, logging |
| `UserPromptSubmit` | User submits prompt | No | Prompt validation, context injection |
| `Stop` | Main agent finishes | No | Task completion checks, force continue |
| `SubagentStop` | Subagent (Task) finishes | No | Subagent task validation |
| `PreCompact` | Before context compaction | Yes | Custom compaction handling |
| `SessionStart` | Session begins/resumes | Yes | Context loading, env setup |
| `SessionEnd` | Session ends | No | Cleanup, logging |

## Configuration Locations

Hooks are configured in settings files (in order of precedence):

| Location | Scope | Committed |
|----------|-------|-----------|
| `~/.claude/settings.json` | User (all projects) | No |
| `.claude/settings.json` | Project | Yes |
| `.claude/settings.local.json` | Local project | No |
| Enterprise managed policy | Organization | Yes |

## Hook Structure

```json
{
  "hooks": {
    "EventName": [
      {
        "matcher": "ToolPattern",
        "hooks": [
          {
            "type": "command",
            "command": "your-command-here",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### Matcher Syntax

| Pattern | Matches | Example |
|---------|---------|---------|
| `Write` | Exact tool name | Only Write tool |
| `Edit\|Write` | Regex OR | Edit or Write |
| `Notebook.*` | Regex wildcard | NotebookEdit, NotebookRead |
| `mcp__memory__.*` | MCP server tools | All memory server tools |
| `*` or `""` | All tools | Any tool |

**Note:** Matchers are case-sensitive and only apply to `PreToolUse`, `PostToolUse`, and `PermissionRequest`.

### Hook Types

| Type | Description | Key Field |
|------|-------------|-----------|
| `command` | Execute bash script | `command`: bash command to run |
| `prompt` | LLM-based evaluation | `prompt`: prompt text for Haiku |

## Exit Codes

| Exit Code | Meaning | Behavior |
|-----------|---------|----------|
| `0` | Success | Continue normally. stdout parsed for JSON control |
| `2` | Blocking error | Block action. stderr shown to Claude |
| Other | Non-blocking error | Log warning. Continue normally |

### Exit Code 2 Behavior by Event

| Event | Exit Code 2 Effect |
|-------|-------------------|
| `PreToolUse` | Blocks tool call, stderr to Claude |
| `PermissionRequest` | Denies permission, stderr to Claude |
| `PostToolUse` | stderr to Claude (tool already ran) |
| `UserPromptSubmit` | Blocks prompt, erases it, stderr to user |
| `Stop` / `SubagentStop` | Blocks stoppage, stderr to Claude |
| `Notification` / `SessionStart` / `SessionEnd` / `PreCompact` | stderr to user only |

## Environment Variables

| Variable | Description | Available In |
|----------|-------------|--------------|
| `CLAUDE_PROJECT_DIR` | Absolute path to project root | All hooks |
| `CLAUDE_PLUGIN_ROOT` | Absolute path to plugin directory | Plugin hooks only |
| `CLAUDE_ENV_FILE` | File path for persisting env vars | `SessionStart` only |
| `CLAUDE_CODE_REMOTE` | `"true"` if running in web environment | All hooks |

## Hook Input (stdin)

All hooks receive JSON via stdin with common fields:

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/directory",
  "permission_mode": "default",
  "hook_event_name": "EventName"
}
```

**Permission modes:** `default`, `plan`, `acceptEdits`, `dontAsk`, `bypassPermissions`

## Decision Guide: Which Hook Do I Need?

### Before Tool Execution
**Use `PreToolUse`** to:
- Validate tool inputs before execution
- Auto-approve safe operations (e.g., reading docs)
- Block dangerous commands
- Modify tool inputs

### After Tool Execution
**Use `PostToolUse`** to:
- Auto-format code after Write/Edit
- Run linters after file changes
- Log file modifications
- Provide feedback to Claude

### Permission Automation
**Use `PermissionRequest`** to:
- Auto-allow trusted operations
- Auto-deny blocked patterns
- Enforce security policies

### Prompt Processing
**Use `UserPromptSubmit`** to:
- Inject context (current time, git status)
- Validate prompts for secrets
- Block sensitive requests

### Session Lifecycle
**Use `SessionStart`** to:
- Load development context
- Set environment variables
- Install dependencies

**Use `SessionEnd`** to:
- Clean up resources
- Log session statistics

### Agent Completion
**Use `Stop` / `SubagentStop`** to:
- Verify task completion
- Force Claude to continue working
- Add completion checks

### Context Management
**Use `PreCompact`** to:
- Customize compaction behavior
- Add pre-compaction context

### Alerts
**Use `Notification`** to:
- Custom notification routing
- Third-party integrations (Slack, Discord)

## Workflow: Creating a Hook

### Prerequisites
- [ ] Identify which event to hook into
- [ ] Decide: command (bash) or prompt (LLM) type
- [ ] Plan exit code behavior

### Steps

1. **Create hook script**
   - [ ] Write executable script (bash, python, etc.)
   - [ ] Read JSON from stdin
   - [ ] Output JSON to stdout (if needed)
   - [ ] Use appropriate exit code

2. **Configure in settings**
   - [ ] Add to appropriate settings file
   - [ ] Set matcher pattern (if applicable)
   - [ ] Set timeout if needed (default: 60s)

3. **Test**
   - [ ] Run `claude --debug` to see hook execution
   - [ ] Check `/hooks` menu for registration
   - [ ] Verify exit codes work as expected

### Validation
- [ ] Script is executable (`chmod +x`)
- [ ] JSON input/output is valid
- [ ] Exit codes are correct
- [ ] Matcher pattern works

## Common Patterns

### Auto-Format on File Write

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/format.sh"
          }
        ]
      }
    ]
  }
}
```

### Inject Context on Session Start

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo \"Git branch: $(git branch --show-current)\""
          }
        ]
      }
    ]
  }
}
```

### Auto-Approve Documentation Reads

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/approve-docs.py"
          }
        ]
      }
    ]
  }
}
```

## Debugging

| Issue | Solution |
|-------|----------|
| Hook not running | Check `/hooks` menu, verify JSON syntax |
| Wrong matcher | Tool names are case-sensitive |
| Command not found | Use absolute paths or `$CLAUDE_PROJECT_DIR` |
| Script not executing | Check permissions (`chmod +x`) |
| Exit code ignored | Only 0, 2, and other are recognized |

Run with debug mode:
```bash
claude --debug
```

## Security Considerations

- [ ] Validate and sanitize all inputs
- [ ] Quote shell variables (`"$VAR"` not `$VAR`)
- [ ] Check for path traversal (`..`)
- [ ] Use absolute paths for scripts
- [ ] Skip sensitive files (`.env`, keys)

## Reference Files

| File | Contents |
|------|----------|
| [EVENTS.md](./EVENTS.md) | Detailed event documentation with input/output schemas |
| [EXAMPLES.md](./EXAMPLES.md) | Complete working examples |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Common issues and solutions |
