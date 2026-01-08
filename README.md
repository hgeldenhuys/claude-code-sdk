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
/plugin install creating-mcp-servers@claude-code-sdk
/plugin install custom-slash-commands@claude-code-sdk
/plugin install creating-plugins@claude-code-sdk
/plugin install creating-subagents@claude-code-sdk
/plugin install headless-mode@claude-code-sdk
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
ln -s node_modules/claude-code-sdk/skills/creating-mcp-servers ~/.claude/skills/
ln -s node_modules/claude-code-sdk/skills/transcript-intelligence ~/.claude/skills/
```

### Skill Locations

| Location | Scope |
|----------|-------|
| `~/.claude/skills/` | Available in all your projects |
| `.claude/skills/` | Project-specific (version controlled) |

## Available Skills

### [claude-code-reference](skills/claude-code-reference/SKILL.md)
Reference guide for Claude Code extensions - skills, hooks, commands, MCP, and plugin marketplaces.

| File | Contents |
|------|----------|
| [SKILL.md](skills/claude-code-reference/SKILL.md) | Quick reference, decision flowchart, common patterns |
| [CONCEPTS.md](skills/claude-code-reference/CONCEPTS.md) | Core concepts and architecture |
| [HEADLESS.md](skills/claude-code-reference/HEADLESS.md) | Headless mode and SDK usage |
| [SUBAGENTS.md](skills/claude-code-reference/SUBAGENTS.md) | Sub-agent implementation |
| [WHATS-NEW.md](skills/claude-code-reference/WHATS-NEW.md) | Version history and new features (2.1.0) |

---

### [creating-hooks](skills/creating-hooks/SKILL.md)
Complete guide for implementing all 10 Claude Code hook events with examples and troubleshooting.

| File | Contents |
|------|----------|
| [SKILL.md](skills/creating-hooks/SKILL.md) | Quick reference tables, decision guide, common patterns |
| [EVENTS.md](skills/creating-hooks/EVENTS.md) | All 10 hook events with input/output schemas |
| [EXAMPLES.md](skills/creating-hooks/EXAMPLES.md) | 8 copy-paste ready examples |
| [TROUBLESHOOTING.md](skills/creating-hooks/TROUBLESHOOTING.md) | Debugging guide with symptom-cause-solution |

---

### [creating-mcp-servers](skills/creating-mcp-servers/SKILL.md)
Guide for creating and integrating MCP (Model Context Protocol) servers with Claude Code. Covers transports, OAuth, server development, and troubleshooting.

| File | Contents |
|------|----------|
| [SKILL.md](skills/creating-mcp-servers/SKILL.md) | Quick reference, adding servers, configuration scopes |
| [TRANSPORTS.md](skills/creating-mcp-servers/TRANSPORTS.md) | HTTP, SSE, stdio transport details |
| [EXAMPLES.md](skills/creating-mcp-servers/EXAMPLES.md) | 6 complete MCP server implementations |
| [TROUBLESHOOTING.md](skills/creating-mcp-servers/TROUBLESHOOTING.md) | Connection issues, OAuth, debugging |

---

### [transcript-intelligence](skills/transcript-intelligence/SKILL.md)
Deep memory search across Claude Code session transcripts to recall past decisions and solutions.

| File | Contents |
|------|----------|
| [SKILL.md](skills/transcript-intelligence/SKILL.md) | Search patterns, use cases, workflow |
| [TYPES.md](skills/transcript-intelligence/TYPES.md) | JSONL format documentation, all message types |
| [SEARCH.md](skills/transcript-intelligence/SEARCH.md) | Advanced search patterns and recipes |

---

### [writing-skills](skills/writing-skills/SKILL.md)
Best practices for creating effective Claude Code skills with progressive disclosure.

| File | Contents |
|------|----------|
| [SKILL.md](skills/writing-skills/SKILL.md) | Skill structure, naming, best practices |
| [TEMPLATES.md](skills/writing-skills/TEMPLATES.md) | Starter templates for different skill types |
| [EXAMPLES.md](skills/writing-skills/EXAMPLES.md) | Real-world skill examples |

---

### [custom-slash-commands](skills/custom-slash-commands/SKILL.md)
Guide for creating custom Claude Code slash commands - shortcuts for frequently-used prompts.

| File | Contents |
|------|----------|
| [SKILL.md](skills/custom-slash-commands/SKILL.md) | Frontmatter options, patterns, workflow |
| [EXAMPLES.md](skills/custom-slash-commands/EXAMPLES.md) | 12 copy-paste ready command examples |
| [TROUBLESHOOTING.md](skills/custom-slash-commands/TROUBLESHOOTING.md) | Common issues and solutions |

---

### [creating-plugins](skills/creating-plugins/SKILL.md)
Guide for creating full Claude Code plugins that bundle commands, agents, hooks, MCP, and LSP servers.

| File | Contents |
|------|----------|
| [SKILL.md](skills/creating-plugins/SKILL.md) | Plugin structure, manifest basics, distribution |
| [MANIFEST.md](skills/creating-plugins/MANIFEST.md) | Complete manifest.json schema |
| [COMPONENTS.md](skills/creating-plugins/COMPONENTS.md) | Commands, agents, hooks, MCP, LSP components |
| [DISTRIBUTION.md](skills/creating-plugins/DISTRIBUTION.md) | Marketplace publishing, team distribution |

---

### [creating-subagents](skills/creating-subagents/SKILL.md)
Guide for creating custom Claude Code subagents (Task tool agents) for specialized workflows.

| File | Contents |
|------|----------|
| [SKILL.md](skills/creating-subagents/SKILL.md) | Agent basics, frontmatter, when to use |
| [DEFINITION.md](skills/creating-subagents/DEFINITION.md) | Complete agent definition reference |
| [EXAMPLES.md](skills/creating-subagents/EXAMPLES.md) | 8 production-ready agent examples |
| [PATTERNS.md](skills/creating-subagents/PATTERNS.md) | Best practices, composition, anti-patterns |

---

### [headless-mode](skills/headless-mode/SKILL.md)
Guide for using Claude Code programmatically via CLI flags and SDKs for automation and CI/CD.

| File | Contents |
|------|----------|
| [SKILL.md](skills/headless-mode/SKILL.md) | Overview, essential flags, output formats |
| [CLI-FLAGS.md](skills/headless-mode/CLI-FLAGS.md) | Complete CLI flag reference |
| [SDK.md](skills/headless-mode/SDK.md) | TypeScript and Python SDK usage |
| [EXAMPLES.md](skills/headless-mode/EXAMPLES.md) | CI/CD, automation, batch processing examples |

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

skills/                # Distributable skills (9 total)
├── claude-code-reference/
├── creating-hooks/
├── creating-mcp-servers/
├── creating-plugins/
├── creating-subagents/
├── custom-slash-commands/
├── headless-mode/
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
