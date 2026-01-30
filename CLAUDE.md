# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code SDK is a TypeScript library for:
- **Tracking changes** to Claude Code releases and identifying breaking changes
- **Documentation tracking** - Cache and track changes to Claude Code official docs
- **Plugin marketplace** for discovering, installing, and managing Claude Code extensions
- **Plugin management** for skills, tools, hooks, commands, and MCP servers
- **Hooks SDK** - Utilities for building Claude Code hooks with session naming
- **COMMS** - Inter-agent communication via SignalDB (agent daemon, SSE, message routing, channels, memos)

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

# Transcript CLI (Rust - native binary)
cargo build --release --manifest-path transcript-tui-rs/Cargo.toml -p transcript-cli
transcript-tui-rs/target/release/transcript --help    # CLI help
transcript-tui-rs/target/release/transcript list      # List sessions
transcript-tui-rs/target/release/transcript search    # FTS search
transcript-tui-rs/target/release/transcript recall    # Session-grouped recall
transcript-tui-rs/target/release/transcript index build   # Build index
transcript-tui-rs/target/release/transcript index update  # Delta update

# Hook events viewing (Bun-only)
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

bin/                   # Standalone CLI utilities (TypeScript/Bun)
├── sesh.ts            # Session name manager CLI
├── hooks.ts           # Hooks framework CLI (run handlers)
├── hook-events.ts     # Hook events viewer CLI
├── hook-events-tui.ts # Hook events interactive TUI
├── agent-daemon.ts    # COMMS agent daemon entry point
├── comms.ts           # COMMS CLI bridge (send, listen, agents, etc.)
├── comms-audit.ts     # COMMS audit log viewer
├── comms-memo.ts      # COMMS memo management CLI
├── comms-paste.ts     # COMMS paste sharing CLI
├── comms-uat.ts       # COMMS UAT test suite runner
├── comms-demo.ts      # COMMS interactive demo
├── comms-dashboard.ts # COMMS terminal dashboard
└── comms-e2e-test.ts  # COMMS E2E test runner

transcript-tui-rs/     # Rust workspace for transcript CLI
├── crates/
│   ├── transcript-core/     # Shared types (LineType, TranscriptLine)
│   ├── transcript-db/       # Read-only SQLite queries
│   ├── transcript-indexer/  # Write ops (schema, indexing, correlation)
│   └── transcript-cli/      # Binary: transcript (list/view/search/recall/index)

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

**Hook Framework Documentation:** See `src/hooks/framework/README.md` for:
- Handler pipeline and priority system
- Cross-handler communication via `context.results`
- Turn ID calculation and access patterns
- Built-in handlers (turn-tracker, session-naming, event-logger)
- Environment variables for external hooks

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

**transcript** - Rust-native transcript CLI with SQLite FTS:

```bash
# Alias (after cargo build --release in transcript-tui-rs/)
alias transcript='transcript-tui-rs/target/release/transcript'

# Build/rebuild unified index (transcripts + hook events)
transcript index build
transcript index rebuild

# Check index status
transcript index status

# Delta update (only new content)
transcript index update

# Foreground file watcher (auto-indexes changes)
transcript index watch

# Search transcripts
transcript search "keyword"

# Memory retrieval (grouped by session)
transcript recall "caching strategy"
transcript recall "error handling" --max-sessions 3

# List and view sessions
transcript list
transcript list --days 7
transcript info <session>
transcript view <session>
transcript view <session> --last 20

# Diagnostic
transcript doctor
```

**transcript-tui** features:
- **View modes**: Raw (1), Human (2), Context (3), JSON (4), Markdown (5)
- **Multi-session**: Comma-separated sessions merged chronologically
- **Usage graph**: Press `u` for context usage visualization (detects clear/compact boundaries)
- **Markdown rendering**: Custom terminal renderer with code highlighting
- **Navigation**: j/k or arrows, g/G for first/last, 1-5 for view modes

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
bun run hook-events-tui "tender-spider,earnest-lion"  # Multi-session
```

**hook-events-tui** features:
- **View modes**: Raw JSON (1), Human-readable (2), Minimal (3), Tool I/O (4), Timeline (5)
- **Bookmarks**: Space to toggle, `[`/`]` to jump (filter-aware, persisted to `~/.claude-code-sdk/hook-event-bookmarks.json`)
- **Context usage**: Shows `[XX%]` colored by usage level (green ≤50%, yellow 51-70%, red 71%+)
- **Live mode**: Press `L` to watch for new events (200ms polling with turn data refresh)
- **Navigation**: j/k or arrows, g/G for first/last, Tab to switch panes, r/Ctrl+L to redraw
- **Multi-session**: Comma-separated sessions supported (e.g., `"tender-spider,earnest-lion"`)
- **Preview column**: Shows tool input/output preview (command, pattern, file path, response snippet)
- **Turn-session column**: Shows `{turn}-{session-name}` (e.g., `8-earnest-lion`)

**List format:** `*★ 08:31:02 Pre    Bash     npm install           [ 45%] 8-earnest-lion`

**Event abbreviations:** `Pre` `Post` `Prompt` `Start` `End` `Stop` `SubStp`

**Custom tool views** (in Human view mode):
- **Edit**: Delta-style unified diff with red/green highlighting
- **Bash**: Command with shell syntax highlighting + stdout/stderr
- **Read**: File content with line numbers and syntax highlighting
- **Grep**: Pattern + matches highlighted in yellow
- **Glob**: File tree visualization
- **Write**: Full file content with line numbers
- **TodoWrite**: Task list with progress bar and status icons

**Additional features:**
- **Markdown highlighting**: Backtick code in prompts highlighted in cyan
- **Syntax highlighting**: TypeScript, JavaScript, Shell, JSON in code views
- **Blessed patch**: Auto-patches blessed library to suppress terminfo warnings (via postinstall)

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

### COMMS (Agent Communication System)

The `src/comms/` module provides inter-agent communication via SignalDB (Tapestry):

```
src/comms/
├── index.ts               # CommsSDK barrel export
├── client/                # SignalDB HTTP client
│   ├── index.ts           # Barrel export
│   └── signaldb.ts        # SignalDBClient - REST + SSE, snake_case conversion
├── config/                # Multi-environment configuration
│   ├── index.ts           # Barrel export
│   └── environments.ts    # loadTapestryConfig(), dev/test/live profiles
├── daemon/                # Agent daemon (runs as background process)
│   ├── index.ts           # Barrel export
│   ├── agent-daemon.ts    # AgentDaemon - orchestrates lifecycle, heartbeat, SSE
│   ├── message-router.ts  # MessageRouter - delivers messages to local sessions
│   ├── session-discovery.ts # discoverSessions() - finds active Claude sessions
│   ├── sse-client.ts      # SSEClient - real-time message subscription
│   └── types.ts           # DaemonConfig, DaemonState, LocalSession
├── protocol/              # Communication protocol types
│   ├── address.ts         # Agent address parsing (agent://machine/session)
│   ├── presence.ts        # Presence status management
│   └── types.ts           # Message, Agent, Channel types
├── registry/              # Agent registration
│   └── agent-registry.ts  # AgentRegistry - register/deregister/heartbeat
├── schema/                # SignalDB collection schemas
│   └── index.ts           # Schema definitions
├── channels/              # Pub/sub channel messaging
│   ├── channel-client.ts  # ChannelClient - create/join/leave channels
│   ├── channel-manager.ts # ChannelManager - lifecycle management
│   ├── publisher.ts       # Publish messages to channels
│   ├── subscriber.ts      # Subscribe to channel messages
│   └── types.ts           # Channel types
├── memos/                 # Async knowledge sharing
│   ├── memo-client.ts     # MemoClient - create/read/claim memos
│   ├── inbox.ts           # Memo inbox management
│   ├── composer.ts        # Memo composition helpers
│   └── types.ts           # Memo types
├── pastes/                # Ephemeral content sharing
│   ├── paste-client.ts    # PasteClient - create/read/expire pastes
│   ├── paste-manager.ts   # PasteManager - lifecycle management
│   └── types.ts           # Paste types
├── security/              # 7 composable guardrail components
│   ├── middleware.ts      # Security middleware pipeline
│   ├── jwt-manager.ts     # JWT token management
│   ├── rate-limiter.ts    # Request rate limiting
│   ├── audit-logger.ts    # Audit trail logging
│   └── types.ts           # Security types
├── bridges/               # External system bridges
│   ├── cli/               # Terminal CLI bridge (comms command)
│   │   ├── index.ts       # CLI entry point
│   │   └── commands/      # send, listen, agents, channels, memo, paste, status
│   └── discord/           # Discord bot bridge
│       ├── discord-bot.ts # Bot lifecycle
│       ├── gateway.ts     # Discord Gateway WebSocket
│       └── message-bridge.ts # Bidirectional message mapping
└── remote/                # Remote administration
    ├── command-executor.ts # Execute commands on remote agents
    ├── receipt-tracker.ts  # Track execution receipts
    └── templates/          # Predefined command templates (deploy, restart, status)
```

**COMMS Commands:**

```bash
# Agent daemon (background process)
bun run agent-daemon              # Start agent daemon

# CLI bridge
bun run comms send <target> <msg> # Send message to agent
bun run comms agents              # List registered agents
bun run comms channels            # List channels
bun run comms listen              # Listen for incoming messages
bun run comms status              # Show connection status

# Testing & monitoring
bun run comms-uat                 # Run UAT test suite
bun run comms-e2e-test            # Run E2E communication tests
bun run comms-dashboard           # Terminal-based agent dashboard
bun run comms-demo                # Interactive demo walkthrough

# Tapestry Observer (web UI)
cd apps/tapestry-observer && bun dev  # Real-time web dashboard
```

**COMMS Data Flow:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Agent Communication Flow                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Local Machine                          SignalDB Cloud              │
│  ┌────────────────┐                     ┌─────────────────┐        │
│  │ Claude Session  │                     │ Tapestry API    │        │
│  │ (project dir)   │◄──message-router──┐ │ (signaldb.co)   │        │
│  └────────────────┘                    │ └───────┬─────────┘        │
│                                        │         │                  │
│  ┌────────────────┐    ┌──────────┐    │         │ SSE stream       │
│  │ Session         │    │ Agent    │    │    ┌────▼──────┐           │
│  │ Discovery       │───►│ Daemon   │────┼───►│ SSEClient │           │
│  │ (global-        │    │          │    │    └───────────┘           │
│  │  sessions.json) │    │ register │    │                           │
│  └────────────────┘    │ heartbeat│    │    Messages collection     │
│                        │ route    │    │    Agents collection       │
│                        └──────────┘    │    Channels collection     │
│                                        │                           │
└─────────────────────────────────────────────────────────────────────┘
```

**Key Discoveries (Pitfalls):**

- **SignalDB SSE format**: SSE events use `event: insert` (not default `message`). Data is nested as `{id, data: {...}, ts}`, not flat objects. The SSEClient must parse `event:` lines and unwrap `.data`.
- **snake_case conversion**: SignalDB returns `snake_case` fields (e.g., `machine_id`, `created_at`). The `SignalDBClient` auto-converts to `camelCase` and applies field aliases (`createdAt` → `registeredAt`).
- **Session discovery**: `decodeProjectPath()` fails for hyphenated directory names. Use `cwd` from `~/.claude/global-sessions.json` instead.
- **`claude --resume` requires cwd**: The `claude --resume <session-id>` command must run from the session's original project directory, otherwise it fails silently.
- **Heartbeat masks SSE death**: Heartbeat runs independently. A healthy heartbeat doesn't mean the SSE stream is alive. The daemon now checks `isConnected` every 5s.
- **Auto-compaction drops headless turns**: When resuming a large session (200K+ context) headlessly, auto-compaction can silently drop recent small headless turns, causing memory loss between routed messages. Solution: fork a lightweight branch session.
- **`--fork-session` creates branch sessions**: `claude --resume <id> --fork-session` creates a new session inheriting the parent's context but with its own transcript. Combined with `--output-format json`, the forked session ID is returned in the `session_id` field.
- **`--output-format json` structured output**: Returns `{result, session_id, is_error, duration_ms, usage}` instead of raw text. Essential for programmatic CLI usage.
- **`onDiscordReady` must register before `connect()`**: The Gateway READY event fires during connection. Callbacks registered after `connect()` resolves will miss it. Bot user ID (needed for permission overwrites) comes from READY data.

**System Prompt Injection:**

When routing messages to Claude sessions, the daemon injects COMMS context via `--append-system-prompt`. This tells Claude the message came from COMMS, who sent it, and that the response will be auto-routed back. See `message-router.ts:buildSystemPrompt()`.

**Session Branching (Conversation Memory):**

The `MessageRouter` uses session branching to maintain memory across message turns
in a conversation thread (e.g., Discord threads). Without branching, each `claude --resume`
call against the agent's main session (200K+ context) causes auto-compaction that silently
drops recent headless turns.

```
Thread starts:  Discord msg → --resume <original> --fork-session → branch session created
Follow-up:      Discord msg → --resume <branch>                  → memory preserved
Follow-up:      Discord msg → --resume <branch>                  → memory preserved
```

Branch tracking is persisted to `~/.claude/daemon/session-branches.json` so mappings
survive daemon restarts. Loaded on construction, saved on every new branch.
The `--output-format json` flag captures the `session_id` from each invocation to track
whether a fork occurred. JSON parse failures fall back to raw text (SyntaxError guard).

**Structured Logging:**

All daemon components use structured logging via `createLogger()` from `src/comms/daemon/logger.ts`:

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `COMMS_LOG_LEVEL` | `info` | Minimum level: `debug`, `info`, `warn`, `error` |
| `COMMS_LOG_FILE` | (none) | Path to append logs to (in addition to stdout) |

Components: `daemon` (lifecycle), `sse-client` (connection/keepalive), `router` (delivery).

**SSE Health Monitoring:**

SSEClient exposes `getHealthStatus()` returning `{ connected, lastConnectedAt, lastEventAt, reconnectCount }`. The daemon checks `isConnected` every discovery poll cycle and force-reconnects if the stream died.

**Access Control (Discord Agent Channels):**

Agent channels are private by default when `DISCORD_OWNER_IDS` is configured.
Uses Discord permission overwrites to deny `@everyone` VIEW_CHANNEL and allow
only the bot + owner users. Runtime access management via `/access` slash command:

```
/access grant user:@JohnDoe agent:witty-bison   # Grant access to one channel
/access grant user:@JohnDoe agent:*              # Grant access to all channels
/access revoke user:@JohnDoe agent:witty-bison   # Revoke access
/access list                                      # List all grants
/access list agent:witty-bison                    # List grants for one channel
```

New channels auto-inherit global grants (`*`) via `AccessController.applyGlobalGrants()`.
Owner-only guard: only users in `config.ownerUserIds` can execute `/access`.

**Full Architecture Reference:** See `src/comms/README.md` for lifecycle diagrams, troubleshooting, and configuration.

**Environment Configuration:**

The COMMS system uses `.env.tapestry` files with per-environment prefixes:

```bash
# .env.tapestry
TAPESTRY_ENV=live                          # Active environment
TAPESTRY_MACHINE_ID=m4.local               # Machine identifier
TAPESTRY_LIVE_API_URL=https://signaldb.co  # SignalDB API
TAPESTRY_LIVE_PROJECT_KEY=sk_live_...      # Project API key
DISCORD_OWNER_IDS=123456789,987654321      # Comma-separated Discord user IDs (bot owners)
```

Environments: `dev` (local, throwaway), `test` (UAT/CI), `live` (production).

Load with: `loadTapestryConfig()` from `src/comms/config/environments.ts`.

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
