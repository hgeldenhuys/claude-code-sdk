# Hook Framework Plugin

YAML-based hook framework with built-in handlers for session naming, turn tracking, and dangerous command guards.

## Installation

```bash
/plugin install hook-framework@claude-code-sdk
```

## Features

Once installed, the plugin automatically:

- **Routes all hook events** through the framework
- **Enables built-in handlers:**
  - `session-naming` - Human-friendly session names (e.g., "brave-elephant")
  - `turn-tracker` - Tracks turns between Stop events
  - `dangerous-command-guard` - Blocks dangerous Bash commands

## Customization

Create a `hooks.yaml` in your project root to customize:

```yaml
version: 1

settings:
  debug: false

builtins:
  session-naming:
    enabled: true
    options:
      format: adjective-animal

  turn-tracker:
    enabled: true

  dangerous-command-guard:
    enabled: true
    options:
      blocked_patterns:
        - "rm -rf /"
        - "git push --force origin main"

  tool-logger:
    enabled: true  # Enable for debugging
    options:
      log_level: info

handlers:
  # Add custom handlers
  my-custom-hook:
    events: [PostToolUse]
    matcher: "Write|Edit"
    command: ./scripts/format.sh
```

## Environment Variables

Custom command handlers receive these environment variables:

| Variable | Description |
|----------|-------------|
| `CLAUDE_SESSION_ID` | Current session ID |
| `CLAUDE_SESSION_NAME` | Human-friendly session name |
| `CLAUDE_TURN_ID` | Turn identifier (session:sequence) |
| `CLAUDE_TURN_SEQUENCE` | Current turn number |
| `CLAUDE_EVENT_TYPE` | Hook event type |
| `CLAUDE_CWD` | Current working directory |

## Configuration Search Order

1. `./hooks.yaml` (project root)
2. `./hooks.yml`
3. `./.claude/hooks.yaml`
4. `./.claude/hooks.yml`
5. Plugin's default config (fallback)

## For More Control

If you need more control, install the SDK directly:

```bash
bun add claude-code-sdk
bun run hooks init
```

This gives you access to:
- TypeScript framework API
- Custom handler implementations
- Full configuration control

## License

MIT
