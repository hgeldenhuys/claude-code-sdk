# Hook Framework - Getting Started

The Hook Framework provides a YAML-based configuration system for Claude Code hooks with built-in handlers and environment variable injection.

## Quick Start

### Option 1: CLI Installation (Recommended for SDK users)

```bash
# Install the SDK
bun add claude-code-sdk

# Initialize hook framework
bun run hooks init

# Verify setup
bun run hooks doctor
```

### Option 2: Plugin Installation (One command)

```bash
# In Claude Code
/plugin install hook-framework@claude-code-sdk
```

## What Gets Configured

Both methods configure:

1. **hooks.yaml** - Framework configuration file
2. **.claude/settings.json** - Routes all hook events through the framework

### Hook Events Configured

| Event | Description |
|-------|-------------|
| `SessionStart` | Session begins or resumes |
| `UserPromptSubmit` | User submits a prompt |
| `PreToolUse` | Before tool executes |
| `PostToolUse` | After tool completes |
| `Stop` | Main agent finishes |
| `SubagentStop` | Subagent finishes |
| `SessionEnd` | Session ends |
| `PreCompact` | Before context compaction |

## Built-in Handlers

The framework includes these handlers enabled by default:

### session-naming

Assigns human-friendly names to sessions (e.g., "brave-elephant").

```yaml
builtins:
  session-naming:
    enabled: true
    options:
      format: adjective-animal  # or: timestamp, uuid
```

**Features:**
- Names persist across `/compact` and `/clear`
- Injects session name into Claude's context
- Available via `CLAUDE_SESSION_NAME` env var

### turn-tracker

Tracks turns within a session based on Stop events.

```yaml
builtins:
  turn-tracker:
    enabled: true
    options:
      preserve_on_resume: true
```

**Turn ID Format:** `{session_id}:{sequence}`

**Features:**
- Turn 1 is implicit at session start
- Increments on each Stop event
- Available via `CLAUDE_TURN_ID` and `CLAUDE_TURN_SEQUENCE` env vars

### dangerous-command-guard

Blocks potentially dangerous Bash commands.

```yaml
builtins:
  dangerous-command-guard:
    enabled: true
    options:
      strict: false
      blocked_patterns:
        - "rm -rf /"
        - "rm -rf ~"
        - "git push --force origin main"
```

**Default Blocked Patterns:**
- `rm -rf /`
- `rm -rf ~`
- `:(){ :|:& };:` (fork bomb)
- `> /dev/sda`

### context-injection

Injects session context into Claude's context.

```yaml
builtins:
  context-injection:
    enabled: false  # Disabled by default
    options:
      on_session_start: true
      on_pre_compact: true
      template: |
        <session-context>
        Session: {{sessionName}}
        Turn: {{turnId}}
        </session-context>
```

### tool-logger

Logs tool usage for debugging and auditing.

```yaml
builtins:
  tool-logger:
    enabled: false  # Disabled by default
    options:
      log_level: info
      output_path: ~/.claude/logs/tools.log
      include_input: true
      include_output: false
      format: text  # or: json
```

## Custom Handlers

Add your own handlers in `hooks.yaml`:

```yaml
handlers:
  # External script handler
  my-formatter:
    enabled: true
    priority: 50
    events: [PostToolUse]
    matcher: "Write|Edit"
    command: ./scripts/format.sh
    timeoutMs: 5000

  # Another handler
  my-validator:
    enabled: true
    events: [PreToolUse]
    matcher: "Bash"
    command: bun ./scripts/validate-command.ts
```

### Environment Variables

Custom handlers receive these environment variables:

| Variable | Description |
|----------|-------------|
| `CLAUDE_SESSION_ID` | Current session ID |
| `CLAUDE_SESSION_NAME` | Human-friendly session name |
| `CLAUDE_TURN_ID` | Turn identifier (session:sequence) |
| `CLAUDE_TURN_SEQUENCE` | Current turn number |
| `CLAUDE_EVENT_TYPE` | Hook event type |
| `CLAUDE_CWD` | Current working directory |
| `CLAUDE_PROJECT_DIR` | Project root path |

### Handler Input/Output

Handlers receive JSON via stdin:

```json
{
  "session_id": "abc123",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "ls -la" },
  "cwd": "/path/to/project"
}
```

Handlers can output JSON to stdout:

```json
{
  "decision": "block",
  "reason": "Command not allowed"
}
```

**Decision values:**
- `"allow"` - Continue normally
- `"block"` - Block the action
- `"modify"` - Modify the input (include `modifiedInput`)

## CLI Commands

```bash
# Initialize framework
bun run hooks init
bun run hooks init --force  # Overwrite existing

# Diagnose issues
bun run hooks doctor
bun run hooks doctor --fix  # Auto-fix issues

# Validate config
bun run hooks --validate

# List built-in handlers
bun run hooks --list-handlers

# Run with debug
bun run hooks --debug
```

## Troubleshooting

### Doctor Command

Run the doctor to diagnose issues:

```bash
bun run hooks doctor
```

Example output:
```
Hook Framework Doctor

Checking configuration...

Results:

  ✓ hooks.yaml: Found: hooks.yaml
  ✓ Config version: Version 1
  ✓ Built-in handlers: Enabled: session-naming, turn-tracker
  ✓ settings.json hooks: 8 events configured
  ✓ Framework integration: Hooks route through framework
  ⚠ CLAUDE_PROJECT_DIR: Not set (only available during hook execution)

All checks passed! Hook framework is properly configured.
```

### Common Issues

| Issue | Solution |
|-------|----------|
| Hooks not firing | Run `bun run hooks doctor` to verify setup |
| Invalid YAML | Check syntax with `bun run hooks --validate` |
| Handler not found | Verify command path exists and is executable |
| Env vars not set | Env vars only available during hook execution |

### Debug Mode

Run Claude Code with debug to see hook output:

```bash
claude --debug
```

Or enable debug in hooks.yaml:

```yaml
settings:
  debug: true
```

## TypeScript API

For programmatic use:

```typescript
import { createFramework, handler, blockResult } from 'claude-code-sdk/hooks/framework';

const framework = createFramework({ debug: true });

// Add custom handler
framework.onPreToolUse(
  handler()
    .id('my-guard')
    .forTools('Bash')
    .handle(ctx => {
      const input = ctx.event.tool_input as { command?: string };
      if (input.command?.includes('rm -rf')) {
        return blockResult('Dangerous command blocked');
      }
      return { success: true };
    })
);

// Access results from other handlers
framework.onPostToolUse(
  handler()
    .id('my-logger')
    .handle(ctx => {
      const turnId = ctx.results.get('turn-tracker')?.data?.turnId;
      const sessionName = ctx.results.get('session-naming')?.data?.sessionName;
      console.error(`[${sessionName}] Turn ${turnId}: ${ctx.event.tool_name}`);
      return { success: true };
    })
);

await framework.run();
```

## Configuration Reference

Full `hooks.yaml` example:

```yaml
version: 1

settings:
  debug: false
  parallel_execution: true
  default_timeout_ms: 30000
  default_error_strategy: continue  # continue, stop, retry

builtins:
  session-naming:
    enabled: true
    priority: 10
    options:
      format: adjective-animal

  turn-tracker:
    enabled: true
    priority: 5
    options:
      preserve_on_resume: true
      inject_context: false

  dangerous-command-guard:
    enabled: true
    priority: 20
    options:
      strict: false
      blocked_patterns:
        - "rm -rf /"
      allowed_patterns: []

  context-injection:
    enabled: false
    options:
      on_session_start: true
      on_pre_compact: true

  tool-logger:
    enabled: false
    options:
      log_level: info
      include_input: true
      format: text

handlers:
  my-handler:
    enabled: true
    priority: 50
    events: [PreToolUse, PostToolUse]
    matcher: ".*"
    command: ./scripts/my-handler.sh
    timeoutMs: 5000
```

## See Also

- [creating-hooks skill](../skills/creating-hooks/SKILL.md) - Full hook development guide
- [creating-plugins skill](../skills/creating-plugins/SKILL.md) - Plugin development
- [README.md](../README.md) - SDK overview
