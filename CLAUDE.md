# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code SDK is a TypeScript library for:
- **Tracking changes** to Claude Code releases and identifying breaking changes
- **Documentation tracking** - Cache and track changes to Claude Code official docs
- **Plugin marketplace** for discovering, installing, and managing Claude Code extensions
- **Plugin management** for skills, tools, hooks, commands, and MCP servers

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
├── cli/
│   └── docs.ts        # CLI for documentation management
└── utils/index.ts     # Shared utilities (version comparison, file ops)
```

### Core Classes

- **ClaudeCodeSDK**: Main entry point that orchestrates all modules
- **ChangeTracker**: Fetches and filters Claude Code changes, identifies breaking changes
- **DocsTracker**: Fetches, caches, and tracks changes to Claude Code documentation
- **Marketplace**: Searches packages, handles installation from marketplace API
- **PluginManager**: Loads plugins from disk, validates manifests, manages hooks

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

This project follows a marketplace-first approach to skills. All skills are developed in `.claude/skills/` for distribution via Claude Code plugins.

### Skill Locations

| Location | Scope | Use Case |
|----------|-------|----------|
| `.claude/skills/` | Project | Marketplace distribution, team workflows |
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

### Project Skills

| Skill | Purpose |
|-------|---------|
| `writing-skills` | Guide for creating effective skills |
| `docs-tracker` | Track Claude Code documentation changes |
| `managing-agent-lifecycles` | Agent lifecycle management patterns |

### Documentation Sources

The DocsTracker monitors both code.claude.com (Claude Code CLI) and docs.claude.com (Agent Skills, SDK) documentation:

```bash
bun run docs list development    # List dev docs including skills
bun run docs:status              # Show cache status
```
