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
├── cli/
│   └── docs.ts        # CLI for documentation management
└── utils/index.ts     # Shared utilities (version comparison, file ops)

bin/                   # Standalone CLI utilities
└── sesh.ts            # Session name manager CLI

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

# TUI viewer
bun run bin/transcript.ts tui
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
