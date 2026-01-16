# CLI Utilities

Standalone command-line tools that ship with claude-code-sdk.

## sesh - Session Name Manager (v3.0)

Human-friendly names for Claude Code sessions. Converts between session IDs and memorable names for easy session resumption.

**v3.0 Features:**
- Centralized storage at `~/.claude/global-sessions.json`
- Machine namespacing for multi-machine support
- Transcript path tracking
- Migration from per-project sessions

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

# Get transcript file path
sesh transcript my-project
# Output: /Users/you/.claude/projects/.../abc123.jsonl

# View a session's transcript
cat $(sesh transcript my-project)
```

### Commands

| Command | Description |
|---------|-------------|
| `sesh <name-or-id>` | Auto-detect and convert (for shell substitution) |
| `sesh id <name>` | Get session ID for a name |
| `sesh name <id>` | Get name for a session ID |
| `sesh list [options]` | List all sessions |
| `sesh info <name-or-id>` | Show session details (incl. transcript path) |
| `sesh rename <old> <new>` | Rename a session |
| `sesh describe <name> <text>` | Set session description |
| `sesh delete <name-or-id>` | Delete a session |
| `sesh history <name>` | Show session ID history |
| `sesh transcript <name-or-id>` | Get transcript file path |
| `sesh machines` | List registered machines |
| `sesh machines alias <name>` | Set alias for current machine |
| `sesh migrate [path]` | Import from project's sessions.json |
| `sesh help` | Show help |
| `sesh version` | Show version |

### List Options

```bash
sesh list                      # List current machine's sessions
sesh list --all-machines       # List sessions from all machines
sesh list --project /path      # Filter by project directory
sesh list --machine <id>       # Filter by machine ID
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

# View session details (includes transcript path)
sesh info my-cool-project

# See all session IDs that used this name (after compacts)
sesh history my-cool-project

# Get the transcript file
sesh transcript my-cool-project

# Pipe transcript to another tool
cat $(sesh transcript my-cool-project) | jq '.type'

# Manage machines (for multi-machine sync)
sesh machines                       # List all machines
sesh machines alias my-laptop       # Set friendly name for this machine

# Migrate from old per-project storage
sesh migrate /path/to/project       # Import that project's sessions
sesh migrate                        # Import current project's sessions

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
3. **Transcript tracking**: Records transcript file path for each session
4. **Machine namespacing**: Sessions are tagged with machine ID for multi-machine support
5. **History**: All session IDs that used a name are recorded
6. **Bidirectional lookup**: Convert name→ID or ID→name instantly

### Storage (v3.0)

Sessions are stored centrally at `~/.claude/global-sessions.json`:

```json
{
  "version": "3.0",
  "machines": {
    "abc123-...": {
      "id": "abc123-...",
      "alias": "macbook-pro",
      "hostname": "myhost.local",
      "registeredAt": "2024-01-14T...",
      "lastSeen": "2024-01-14T..."
    }
  },
  "currentMachineId": "abc123-...",
  "names": {
    "jolly-squid": {
      "name": "jolly-squid",
      "currentSessionId": "be59ef1a-...",
      "machineId": "abc123-...",
      "cwd": "/path/to/project",
      "history": [
        {
          "sessionId": "old-id-...",
          "source": "startup",
          "transcriptPath": "/Users/you/.claude/projects/.../old-id.jsonl"
        },
        {
          "sessionId": "be59ef1a-...",
          "source": "compact",
          "transcriptPath": "/Users/you/.claude/projects/.../be59ef1a.jsonl"
        }
      ],
      "created": "2024-01-14T...",
      "lastAccessed": "2024-01-14T..."
    }
  },
  "sessionIndex": {
    "be59ef1a-...": "jolly-squid"
  },
  "directoryIndex": {
    "/path/to/project": ["jolly-squid"]
  }
}
```

Machine ID is stored at `~/.claude/machine-id`.

### Integration with Hooks

For automatic session tracking, the session-start hook should be configured. The hook passes transcript_path to the session store:

```typescript
// hooks/session-start.ts
result = store.track(data.session_id, {
  source: data.source,
  cwd: data.cwd,
  transcriptPath: data.transcript_path,  // Track transcript location
});
```

### Migration from v2.0

If you have sessions stored in per-project `.claude/sessions.json` files, migrate them:

```bash
# Migrate current project
sesh migrate

# Migrate specific project
sesh migrate /path/to/project

# Migrate multiple projects
for dir in ~/projects/*/; do
  sesh migrate "$dir"
done
```

### See Also

- [Hooks SDK Documentation](../src/hooks/README.md)
- [Session Naming Examples](../examples/hooks/)
