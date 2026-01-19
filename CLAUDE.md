# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code SDK is a TypeScript library for:
- **Tracking changes** to Claude Code releases and identifying breaking changes
- **Documentation tracking** - Cache and track changes to Claude Code official docs
- **Plugin marketplace** for discovering, installing, and managing Claude Code extensions
- **Plugin management** for skills, tools, hooks, commands, and MCP servers
- **Hooks SDK** - Utilities for building Claude Code hooks with session naming

## Commands

```bash
bun install          # Install dependencies
bun test             # Run all tests
bun test --watch     # Run tests in watch mode
bun test <file>      # Run a single test file (e.g., bun test tests/utils.test.ts)
bun run dev          # Run with watch mode for development
bun run build        # Build for distribution
bun run lint         # Check code with Biome
bun run lint:fix     # Auto-fix linting issues
bun run format       # Format code with Biome
bun run typecheck    # Run TypeScript type checking

# Documentation tracking
bun run docs         # Show docs CLI help
bun run docs:fetch   # Fetch and cache all Claude Code documentation
bun run docs:check   # Check for documentation changes (delta detection)
bun run docs:status  # Show cache status
bun run docs list    # List all cached documents by category
bun run docs search <query>  # Search documentation content

# Transcript and hook event viewing (Bun-only)
bun run transcript             # Transcript CLI
bun run transcript-tui         # Interactive transcript viewer
bun run hook-events            # Hook events CLI
bun run hook-events-tui        # Interactive hook events viewer

# Session management
bun run sesh                   # Session name manager

# Hooks framework
bun run hooks                  # Run hook handlers
```

## Architecture

```
src/
├── index.ts           # Main SDK entry point with ClaudeCodeSDK class
├── types/index.ts     # All TypeScript interfaces and types
├── tracker/index.ts   # ChangeTracker - monitors Claude Code releases
├── marketplace/index.ts # Marketplace - browse and install plugins
├── plugins/index.ts   # PluginManager - load and manage installed plugins
├── docs/              # Documentation tracker module
│   ├── index.ts       # Barrel export
│   ├── types.ts       # Doc tracking types (DocMetadata, DeltaResult, etc.)
│   └── tracker.ts     # DocsTracker - fetch, cache, delta detection
├── hooks/             # Hooks SDK for building Claude Code hooks
│   ├── index.ts       # Main hooks exports
│   ├── types.ts       # Hook event type definitions (10 events)
│   ├── helpers.ts     # Hook creators and I/O utilities
│   └── sessions/      # Session naming module
│       ├── store.ts   # SessionStore - name-centric session storage
│       ├── namer.ts   # NameGenerator - adjective-animal names
│       ├── cli.ts     # CLI command implementations
│       └── types.ts   # Session types
├── transcripts/       # Transcript indexing system
│   ├── db.ts          # SQLite database operations
│   ├── index.ts       # Transcript CLI entry point
│   └── adapters/      # Pluggable adapter architecture
│       ├── index.ts   # Barrel exports
│       ├── types.ts   # TranscriptAdapter interface
│       ├── base.ts    # BaseAdapter abstract class
│       ├── registry.ts # AdapterRegistry singleton
│       ├── discovery.ts # External adapter auto-discovery
│       ├── daemon.ts  # File watching daemon
│       └── cli.ts     # Adapter CLI commands
├── cli/
│   └── docs.ts        # CLI for documentation management
└── utils/index.ts     # Shared utilities (version comparison, file ops)

bin/                   # Standalone CLI utilities
├── sesh.ts            # Session name manager CLI
├── transcript.ts      # Transcript viewer CLI
├── transcript-tui.ts  # Transcript interactive TUI
├── hooks.ts           # Hooks framework CLI (run handlers)
├── hook-events.ts     # Hook events viewer CLI
└── hook-events-tui.ts # Hook events interactive TUI

skills/                # Distributable skills for Claude Code development
└── writing-skills/    # Guide for creating effective skills
    ├── SKILL.md       # Main skill file
    ├── TEMPLATES.md   # Starter templates
    └── EXAMPLES.md    # Real-world examples

examples/hooks/        # Example hook implementations
├── session-namer-hook.ts   # Auto-assign session names
├── tool-guard-hook.ts      # Block dangerous commands
└── session-manager-cli.ts  # CLI usage example
```

### Core Classes

- **ClaudeCodeSDK**: Main entry point that orchestrates all modules
- **ChangeTracker**: Fetches and filters Claude Code changes, identifies breaking changes
- **DocsTracker**: Fetches, caches, and tracks changes to Claude Code documentation
- **Marketplace**: Searches packages, handles installation from marketplace API
- **PluginManager**: Loads plugins from disk, validates manifests, manages hooks
- **SessionStore**: Name-centric session storage with history tracking
- **NameGenerator**: Human-friendly name generation (adjective-animal pattern)

### Hooks SDK

The `src/hooks/` module provides utilities for building Claude Code hooks:

```typescript
import {
  createSessionStartHook,
  trackSession,
  getSessionName,
  blockTool,
  injectContext,
} from 'claude-code-sdk/hooks';

// Auto session tracking hook
createSessionStartHook(({ sessionName }) => {
  return sessionStartContext(`Session: ${sessionName}`);
});
```

**Key features:**
- Type definitions for all 10 hook events
- Session naming that persists across compact/clear
- Hook creators with automatic session tracking
- Common patterns (blockTool, injectContext, etc.)

### CLI Utilities

**sesh** - Session name manager for easy session resumption:

```bash
# Resume by name
claude --resume $(sesh my-project)

# Convert between formats
sesh jolly-squid           # → session ID
sesh abc-123-...           # → name

# List and manage
sesh list
sesh rename old-name new-name
sesh info my-project
```

**transcript** - Transcript and hook event indexer with SQLite FTS:

```bash
# Build/rebuild unified index (transcripts + hook events)
bun run bin/transcript.ts index build
bun run bin/transcript.ts index rebuild

# Check index status
bun run bin/transcript.ts index status

# Delta update (only new content)
bun run bin/transcript.ts index update

# Background daemon (watches for changes)
bun run bin/transcript.ts index daemon start
bun run bin/transcript.ts index daemon status
bun run bin/transcript.ts index daemon stop

# Search transcripts
bun run bin/transcript.ts search "keyword"

# Memory retrieval (grouped by session, with related skills)
bun run bin/transcript.ts recall "caching strategy"
bun run bin/transcript.ts recall "error handling" --max-sessions 3

# TUI viewer
bun run bin/transcript.ts tui
```

**hook-events** - Hook events viewer CLI and TUI (Bun-only, uses bun:sqlite):

```bash
# List sessions with hook events
bun run hook-events list

# View events for current project (. = current session)
bun run hook-events .
bun run hook-events . --last 10
bun run hook-events . --event PreToolUse,PostToolUse
bun run hook-events . --tool Bash,Read

# Search across all hook events
bun run hook-events search "error"

# Session info and statistics
bun run hook-events info .

# Watch mode (tail -f style)
bun run hook-events . --watch

# Interactive TUI
bun run hook-events-tui .
bun run hook-events-tui . --event PreToolUse --live
```

**hook-events-tui** features:
- **View modes**: Raw JSON (1), Human-readable (2), Minimal (3), Tool I/O (4), Timeline (5)
- **Bookmarks**: Space to toggle, `[`/`]` to jump (filter-aware, persisted to `~/.claude-code-sdk/hook-event-bookmarks.json`)
- **Context usage**: Shows `[XX%]` at end of each line (based on 200K context window)
- **Live mode**: Press `L` to watch for new events in real-time
- **Navigation**: j/k or arrows, g/G for first/last, Tab to switch panes

### Hook Events Architecture

The hook-events CLI/TUI provides real-time monitoring of Claude Code hook execution. Here's how it works:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Hook Events Data Flow                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Claude Code Session                                                         │
│  ┌──────────────┐                                                           │
│  │ User Prompt  │──┐                                                        │
│  └──────────────┘  │                                                        │
│                    ▼                                                        │
│  ┌──────────────────────────────────────┐                                   │
│  │         Hooks Framework              │                                   │
│  │  ┌────────────────────────────────┐  │                                   │
│  │  │ Event Types:                   │  │                                   │
│  │  │ • UserPromptSubmit             │  │                                   │
│  │  │ • PreToolUse / PostToolUse     │  │                                   │
│  │  │ • SessionStart / SessionEnd    │  │                                   │
│  │  │ • Stop / SubagentStop          │  │                                   │
│  │  └────────────────────────────────┘  │                                   │
│  └──────────────────┬───────────────────┘                                   │
│                     │                                                        │
│                     ▼                                                        │
│  ┌──────────────────────────────────────┐                                   │
│  │    event-logger Hook Handler         │                                   │
│  │    (logs to ~/.claude/hooks/)        │                                   │
│  └──────────────────┬───────────────────┘                                   │
│                     │                                                        │
│                     ▼                                                        │
│  ~/.claude/hooks/<project-path>/                                            │
│  └── hooks.jsonl   ◄─── JSONL format, one event per line                    │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Indexing (transcript CLI)                                                   │
│  ┌──────────────────────────────────────┐                                   │
│  │  transcript index build/daemon       │                                   │
│  │  • Watches hooks.jsonl files         │                                   │
│  │  • Parses JSONL events               │                                   │
│  │  • Indexes into SQLite FTS           │                                   │
│  └──────────────────┬───────────────────┘                                   │
│                     │                                                        │
│                     ▼                                                        │
│  ~/.claude-code-sdk/transcripts.db                                          │
│  ├── lines table (transcript content + turn_id, session_name)               │
│  ├── hook_events table (indexed events + turn_id, session_name)             │
│  └── *_fts tables (full-text search)                                        │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Viewing (hook-events CLI/TUI)                                               │
│  ┌──────────────────────────────────────┐                                   │
│  │  hook-events / hook-events-tui       │                                   │
│  │  • Queries SQLite for events         │                                   │
│  │  • Filters by event/tool/time        │                                   │
│  │  • Calculates context usage %        │                                   │
│  │  • Manages bookmarks (persisted)     │                                   │
│  │  • Live mode polls for new events    │                                   │
│  └──────────────────────────────────────┘                                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key files:**
- `src/transcripts/db.ts` - SQLite database with hook event queries (`getHookEvents`, `getHookSessions`, etc.)
- `bin/hook-events.ts` - CLI for viewing/searching hook events
- `bin/hook-events-tui.ts` - Interactive TUI with blessed library

**Turn tracking (v5 schema):**
- Both `lines` and `hook_events` tables have `turn_id`, `turn_sequence`, `session_name` columns
- `correlateLinesToTurns(db)` - Updates transcript lines with turn info from hook events
- `getSessionTurns(db, sessionId)` - Get turn summary for a session
- `getTurnLines(db, turnId)` - Get all lines for a specific turn
- Turn data comes from `turn-tracker` handler results in hook events
- Correlation uses Stop events for turn boundaries, or falls back to tool events (PreToolUse/PostToolUse) timestamps

**Real-time turn correlation:**
- Daemon automatically runs `correlateLinesToTurns` when new hook events are indexed
- `update` command always runs correlation (catches previously uncorrelated lines)
- TUI live mode refreshes turn data every ~1 second for lines missing it
- Turn-session column format: `{turn}-{session-name}` (e.g., `19-misty-mongoose`)

**Handler results in hook events:**
- Events include `handlerResults` with data from all handlers that ran
- Turn tracker data: `handlerResults['turn-tracker-{EventType}'].data.turnId/sequence`
- Session naming data: `handlerResults['session-naming-SessionStart'].data.sessionName`
- Requires `parallelExecution: false` in hooks.yaml for proper result accumulation

**Hook event JSONL format:**
```json
{"timestamp":"2024-01-18T14:00:00Z","sessionId":"abc-123","eventType":"PreToolUse","toolName":"Bash","toolUseId":"xyz","handlerResults":{"turn-tracker-PreToolUse":{"data":{"turnId":"abc:1","sequence":1}}},"input":{...},"context":{...}}
```

**Context usage calculation:**
- Extracts `usage.input_tokens` + `usage.output_tokens` from event input
- Calculates percentage against 200K context window
- Displayed as `[XX%]` at end of each line

### Transcript Adapters

The transcript daemon uses a pluggable adapter architecture to index different data sources into SQLite.

**Built-in adapters:**
- `transcript-lines` - Indexes `~/.claude/projects/**/transcript.jsonl`
- `hook-events` - Indexes `~/.claude/hooks/**/*.hooks.jsonl`

**Adapter commands:**
```bash
# List all registered adapters
transcript adapter list

# Show adapter status and metrics
transcript adapter status [adapter-name]

# Process files with a specific adapter
transcript adapter process <adapter-name> [--file <path>]

# Replay (re-index) all files for an adapter
transcript adapter replay <adapter-name>

# Run adapter daemon in foreground
transcript adapter daemon
```

**Architecture:**
```
src/transcripts/adapters/
├── index.ts           # Barrel exports and registration
├── types.ts           # TranscriptAdapter interface
├── base.ts            # BaseAdapter abstract class
├── registry.ts        # AdapterRegistry singleton
├── discovery.ts       # External adapter auto-discovery
├── daemon.ts          # AdapterDaemon for file watching
├── cli.ts             # CLI commands
├── transcript-lines.ts # Built-in transcript adapter
└── hook-events.ts     # Built-in hook events adapter
```

### External Adapter Auto-Discovery

External adapters are automatically discovered from `~/.claude-code-sdk/adapters/`:

**Supported patterns:**
- `~/.claude-code-sdk/adapters/*.ts` - Direct TypeScript files
- `~/.claude-code-sdk/adapters/*/index.ts` - Subdirectory with index.ts

**Creating an external adapter:**

1. Create adapter file extending `BaseAdapter`:
```typescript
// ~/.claude-code-sdk/adapters/my-adapter.ts
import { BaseAdapter } from 'claude-code-sdk/transcripts/adapters';
import type { Database } from 'bun:sqlite';

export class MyAdapter extends BaseAdapter {
  readonly name = 'my-adapter';
  readonly description = 'Indexes my custom data';
  readonly watchPath = '.agent/my-data/*.jsonl';
  readonly fileExtensions = ['.jsonl'];

  override initSchema(db: Database): void {
    super.initSchema(db);
    db.exec(`CREATE TABLE IF NOT EXISTS my_entries (...)`);
  }

  processEntry(entry: Record<string, unknown>, db: Database, context: EntryContext) {
    // Process each JSONL entry
    return { success: true, entryType: entry.type as string };
  }
}

export default MyAdapter;
```

2. Symlink or copy to adapters directory:
```bash
mkdir -p ~/.claude-code-sdk/adapters
ln -s /path/to/my-adapter ~/.claude-code-sdk/adapters/my-adapter
```

3. Verify registration:
```bash
transcript adapter list
# Should show: my-adapter
```

**Example: Weave adapter setup:**
```bash
# Symlink weave adapter from claude-weave project
ln -s /path/to/claude-weave/weave/adapters ~/.claude-code-sdk/adapters/weave

# Verify
transcript adapter list
# Output: weave - Indexes Weave knowledge from JSONL to SQLite
```

**Key exports from discovery module:**
```typescript
import {
  ADAPTERS_DIR,           // ~/.claude-code-sdk/adapters
  discoverAdapterFiles,   // Find adapter files in directory
  loadAdapterFromFile,    // Load single adapter
  loadExternalAdapters,   // Load and register all external adapters
  ensureAdaptersDir,      // Create adapters directory
} from 'claude-code-sdk/transcripts/adapters';
```

### Documentation Tracking

The `DocsTracker` module provides:
- **Caching** - Stores docs locally with metadata (title, hash, timestamps, version)
- **Delta Detection** - Compares cached vs live content using SHA-256 hashing
- **Indexing** - Organizes docs by category (development, configuration, reference, etc.)
- **Search** - Full-text search across cached documentation

Categories: `development`, `configuration`, `reference`, `integration`, `enterprise`, `troubleshooting`

Cached docs location: `.claude-code-sdk/docs-cache/`

### Plugin Types

Plugins are defined with a `PluginType`: `'skill' | 'tool' | 'hook' | 'command' | 'mcp-server'`

Each plugin has a manifest with: id, name, version, description, author, type, entryPoint, and optional dependencies/config.

## Code Style

- Use Bun runtime and APIs (not Node.js equivalents)
- Prefer for-loops over forEach
- Use Biome for linting and formatting
- Single quotes, semicolons, ES5 trailing commas

## Skill Development

This SDK provides reusable skills in `skills/` for distribution. These skills help developers build Claude Code extensions.

### Skill Locations

| Location | Scope | Use Case |
|----------|-------|----------|
| `skills/` | SDK Distribution | Reusable skills for plugin development |
| `.claude/skills/` | Project | Internal project workflows |
| `~/.claude/skills/` | Personal | Individual workflows, experiments |

### Versioning Convention

- `v0.1.x` - Draft versions (pre-GitHub publish)
- `v1.0.0+` - Stable releases for marketplace

### Creating Skills

1. **Consult DocsTracker first**: Check official patterns before writing
   ```bash
   bun run docs:fetch              # Update cache
   bun run docs search "skills"    # Search for patterns
   ```

2. **Use writing-skills skill**: Invoke for guidance on structure and best practices

3. **Follow progressive disclosure**:
   - Keep SKILL.md under 500 lines
   - Use subfiles (TEMPLATES.md, EXAMPLES.md, TROUBLESHOOTING.md)

4. **Skills can be sharded**: Split complex skills into subskills

### SDK Skills

| Skill | Purpose |
|-------|---------|
| `claude-code-reference` | Reference guide for Claude Code extensions |
| `context-optimization` | Guide for managing and optimizing context window usage |
| `creating-hooks` | Guide for implementing Claude Code hooks |
| `creating-mcp-servers` | Guide for MCP server creation and integration |
| `debugging-claude-code` | Troubleshooting guide for diagnosing Claude Code issues |
| `permission-patterns` | Guide for configuring Claude Code permissions and security |
| `transcript-intelligence` | Search and analyze Claude Code transcripts |
| `writing-skills` | Guide for creating effective Claude Code skills |

Planned skills:
- `creating-slash-commands` - Guide for custom slash commands

### Documentation Sources

The DocsTracker monitors both code.claude.com (Claude Code CLI) and docs.claude.com (Agent Skills, SDK) documentation:

```bash
bun run docs list development    # List dev docs including skills
bun run docs:status              # Show cache status
```
