# CLI Utilities

Standalone command-line tools that ship with claude-code-sdk.

## sesh - Session Name Manager

Human-friendly names for Claude Code sessions. Converts between session IDs and memorable names for easy session resumption.

### Installation

```bash
# After installing claude-code-sdk globally
bun add -g claude-code-sdk
# or
npm install -g claude-code-sdk

# The 'sesh' command will be available globally
sesh --version
```

For development/local use:
```bash
# Create symlink
ln -sf "$(pwd)/bin/sesh.ts" ~/.local/bin/sesh

# Or run directly
bun bin/sesh.ts <command>
```

### Quick Start

```bash
# Resume a session by name (primary use case)
claude --resume $(sesh my-project)

# Convert name → ID
sesh jolly-squid
# Output: be59ef1a-4085-4f98-84ce-e9cbcb9500cc

# Convert ID → name
sesh be59ef1a-4085-4f98-84ce-e9cbcb9500cc
# Output: jolly-squid
```

### Commands

| Command | Description |
|---------|-------------|
| `sesh <name-or-id>` | Auto-detect and convert (for shell substitution) |
| `sesh id <name>` | Get session ID for a name |
| `sesh name <id>` | Get name for a session ID |
| `sesh list [options]` | List all sessions |
| `sesh info <name-or-id>` | Show session details |
| `sesh rename <old> <new>` | Rename a session |
| `sesh describe <name> <text>` | Set session description |
| `sesh delete <name-or-id>` | Delete a session |
| `sesh history <name>` | Show session ID history |
| `sesh help` | Show help |
| `sesh version` | Show version |

### List Options

```bash
sesh list                      # List all sessions
sesh list --limit 10           # Limit results
sesh list --pattern "feat-*"   # Filter by name pattern
sesh list --json               # Output as JSON
sesh list --names              # Output names only (one per line)
sesh list --ids                # Output session IDs only
```

### Examples

```bash
# Resume by memorable name
claude --resume $(sesh auth-feature)

# List recent sessions
sesh list --limit 5

# Rename for easier recall
sesh rename brave-elephant my-cool-project

# Add description for context
sesh describe my-cool-project "Implementing OAuth2 flow"

# View session details
sesh info my-cool-project

# See all session IDs that used this name (after compacts)
sesh history my-cool-project

# Script: get all session names
for name in $(sesh list --names); do
  echo "Processing: $name"
done
```

### How It Works

Claude Code assigns a new UUID session ID on every:
- New session (`claude`)
- Resume (`claude --resume`)
- Clear (`/clear`)
- Compact (automatic or `/compact`)

This makes it hard to resume work by name. `sesh` solves this by:

1. **Tracking sessions**: A hook records every session ID with a human-friendly name
2. **Name persistence**: Names survive across compact/clear operations
3. **History**: All session IDs that used a name are recorded
4. **Bidirectional lookup**: Convert name→ID or ID→name instantly

### Storage

Sessions are stored in `.claude/sessions.json` (project) or `~/.claude/sessions.json` (global).

```json
{
  "version": "2.0",
  "names": {
    "jolly-squid": {
      "name": "jolly-squid",
      "currentSessionId": "be59ef1a-...",
      "history": [
        { "sessionId": "old-id-...", "source": "startup" },
        { "sessionId": "be59ef1a-...", "source": "compact" }
      ],
      "created": "2024-01-14T...",
      "lastAccessed": "2024-01-14T..."
    }
  },
  "sessionIndex": {
    "be59ef1a-...": "jolly-squid"
  }
}
```

### Integration with Hooks

For automatic session tracking, add this hook to `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{
      "command": "bun /path/to/claude-code-sdk/examples/hooks/session-namer-hook.ts"
    }]
  }
}
```

This injects the session name into Claude's context automatically.

### See Also

- [Hooks SDK Documentation](../src/hooks/README.md)
- [Session Naming Examples](../examples/hooks/)
