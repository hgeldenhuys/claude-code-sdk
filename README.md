# Claude Code SDK

A TypeScript toolkit for extending Claude Code with documentation tracking, transcript search, and reusable skills.

## Features

- **Documentation Tracking** - Cache and detect changes in Claude Code official docs
- **Transcript Intelligence** - Search across session history to recall past decisions
- **Skills Library** - Reusable guides for building Claude Code extensions
- **Change Tracker** - Monitor Claude Code releases and breaking changes
- **Plugin Manager** - Load and manage skills, hooks, commands, and MCP servers

## Installing Skills

This repo is a **Claude Code plugin marketplace**. Install skills directly in Claude Code:

### Method 1: Plugin Marketplace (Recommended)

```bash
# In Claude Code, add this repo as a marketplace
/plugin marketplace add hgeldenhuys/claude-code-sdk

# Then install any skill
/plugin install claude-code-reference@claude-code-sdk
/plugin install creating-hooks@claude-code-sdk
/plugin install transcript-intelligence@claude-code-sdk
/plugin install writing-skills@claude-code-sdk
```

### Method 2: Direct Copy

```bash
# Clone and copy skills you want
git clone https://github.com/hgeldenhuys/claude-code-sdk.git
cp -r claude-code-sdk/skills/creating-hooks ~/.claude/skills/

# Or copy all skills
cp -r claude-code-sdk/skills/* ~/.claude/skills/
```

### Method 3: npm Package + Symlink

```bash
# Install the package
bun add claude-code-sdk

# Symlink skills from node_modules
ln -s node_modules/claude-code-sdk/skills/creating-hooks ~/.claude/skills/
ln -s node_modules/claude-code-sdk/skills/transcript-intelligence ~/.claude/skills/
```

### Skill Locations

| Location | Scope |
|----------|-------|
| `~/.claude/skills/` | Available in all your projects |
| `.claude/skills/` | Project-specific (version controlled) |

## Available Skills

| Skill | Description |
|-------|-------------|
| `claude-code-reference` | Reference guide for Claude Code extensions - skills, hooks, commands, MCP, marketplaces |
| `creating-hooks` | Complete guide for all 10 hook events with examples and troubleshooting |
| `transcript-intelligence` | Deep memory search across session transcripts to recall past decisions |
| `writing-skills` | Best practices for creating effective Claude Code skills |

## SDK Installation

For programmatic access to documentation tracking and transcript search:

```bash
bun add claude-code-sdk
```

## Quick Start

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk';

const sdk = new ClaudeCodeSDK();
await sdk.init();

// Search past sessions for context
import { searchTranscripts, indexTranscripts } from 'claude-code-sdk/transcripts';
const index = await indexTranscripts();
const results = await searchTranscripts('authentication bug', { limit: 10 });

// Track documentation changes
const docs = sdk.docs;
await docs.fetchAll();
const changes = await docs.checkForChanges();
```

## Modules

### Transcript Intelligence

Search across all Claude Code session transcripts to recall past solutions, decisions, and discussions:

```typescript
import {
  searchTranscripts,
  indexTranscripts,
  parseTranscriptFile,
  getConversationThread
} from 'claude-code-sdk/transcripts';

// Index all sessions
const index = await indexTranscripts();
console.log(`Found ${index.stats.totalFiles} sessions`);

// Search with scoring
const results = await searchTranscripts('database migration', {
  limit: 20,
  messageTypes: ['user', 'assistant'],
  timeframe: 'week'
});

// Get conversation context around a match
const thread = getConversationThread(transcriptLines, matchUuid, 5);
```

### Documentation Tracker

Cache and monitor official Claude Code documentation:

```bash
bun run docs:fetch   # Fetch and cache all docs
bun run docs:check   # Detect changes since last fetch
bun run docs:status  # Show cache status
bun run docs search "hooks"  # Search documentation
```

```typescript
import { DocsTracker } from 'claude-code-sdk/docs';

const docs = new DocsTracker();
await docs.fetchAll();

// Check for updates
const delta = await docs.checkForChanges();
if (delta.changed.length > 0) {
  console.log('Docs updated:', delta.changed);
}

// Search cached docs
const results = docs.search('MCP servers');
```

### Change Tracker

Monitor Claude Code releases and identify breaking changes:

```typescript
import { ChangeTracker } from 'claude-code-sdk/tracker';

const tracker = new ChangeTracker();
const changes = await tracker.fetchChanges();
const breaking = tracker.getBreakingChanges('1.0.0', '2.0.0');
const guide = tracker.getMigrationGuide('1.0.0', '2.0.0');
```

### Plugin Manager

Load and manage Claude Code extensions:

```typescript
import { PluginManager } from 'claude-code-sdk/plugins';

const manager = new PluginManager();
await manager.loadAll();

const skills = manager.getByType('skill');
const hooks = manager.getByType('hook');
```

## CLI Commands

```bash
bun install          # Install dependencies
bun test             # Run tests (274 tests)
bun run dev          # Development with watch mode
bun run build        # Build for distribution
bun run lint         # Check code with Biome
bun run typecheck    # TypeScript type checking

# Documentation
bun run docs         # Show docs CLI help
bun run docs:fetch   # Fetch all documentation
bun run docs:check   # Check for changes
bun run docs:status  # Show cache status
bun run docs list    # List cached documents
bun run docs search <query>  # Search docs
```

## Project Structure

```
.claude-plugin/
└── marketplace.json   # Plugin marketplace manifest

skills/                # Distributable skills
├── claude-code-reference/
├── creating-hooks/
├── transcript-intelligence/
└── writing-skills/

src/
├── index.ts           # Main SDK entry point
├── types/             # TypeScript interfaces
├── tracker/           # Change tracking module
├── marketplace/       # Plugin marketplace
├── plugins/           # Plugin management
├── docs/              # Documentation tracker
└── transcripts/       # Transcript search module

tests/                 # Test suites (274 tests)
```

## License

MIT
