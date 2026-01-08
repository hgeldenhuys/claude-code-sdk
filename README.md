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

# User-focused skills
/plugin install effective-prompting@claude-code-sdk
/plugin install memory-management@claude-code-sdk
/plugin install debugging-claude-code@claude-code-sdk
/plugin install project-setup@claude-code-sdk
/plugin install git-workflows@claude-code-sdk
/plugin install context-optimization@claude-code-sdk
/plugin install permission-patterns@claude-code-sdk
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

### Extension Development Skills

Skills for building Claude Code extensions (hooks, MCP servers, plugins, etc.):

| Skill | Description | Files |
|-------|-------------|-------|
| [claude-code-reference](skills/claude-code-reference/SKILL.md) | Reference guide for Claude Code extensions | [SKILL](skills/claude-code-reference/SKILL.md) ยท [CONCEPTS](skills/claude-code-reference/CONCEPTS.md) ยท [HEADLESS](skills/claude-code-reference/HEADLESS.md) ยท [SUBAGENTS](skills/claude-code-reference/SUBAGENTS.md) ยท [WHATS-NEW](skills/claude-code-reference/WHATS-NEW.md) |
| [creating-hooks](skills/creating-hooks/SKILL.md) | All 10 hook events with examples | [SKILL](skills/creating-hooks/SKILL.md) ยท [EVENTS](skills/creating-hooks/EVENTS.md) ยท [EXAMPLES](skills/creating-hooks/EXAMPLES.md) ยท [TROUBLESHOOTING](skills/creating-hooks/TROUBLESHOOTING.md) |
| [creating-mcp-servers](skills/creating-mcp-servers/SKILL.md) | MCP server development and integration | [SKILL](skills/creating-mcp-servers/SKILL.md) ยท [TRANSPORTS](skills/creating-mcp-servers/TRANSPORTS.md) ยท [EXAMPLES](skills/creating-mcp-servers/EXAMPLES.md) ยท [TROUBLESHOOTING](skills/creating-mcp-servers/TROUBLESHOOTING.md) |
| [creating-plugins](skills/creating-plugins/SKILL.md) | Full plugin bundling and distribution | [SKILL](skills/creating-plugins/SKILL.md) ยท [MANIFEST](skills/creating-plugins/MANIFEST.md) ยท [COMPONENTS](skills/creating-plugins/COMPONENTS.md) ยท [DISTRIBUTION](skills/creating-plugins/DISTRIBUTION.md) |
| [creating-subagents](skills/creating-subagents/SKILL.md) | Custom Task tool agents | [SKILL](skills/creating-subagents/SKILL.md) ยท [DEFINITION](skills/creating-subagents/DEFINITION.md) ยท [EXAMPLES](skills/creating-subagents/EXAMPLES.md) ยท [PATTERNS](skills/creating-subagents/PATTERNS.md) |
| [custom-slash-commands](skills/custom-slash-commands/SKILL.md) | Create custom slash commands | [SKILL](skills/custom-slash-commands/SKILL.md) ยท [EXAMPLES](skills/custom-slash-commands/EXAMPLES.md) ยท [TROUBLESHOOTING](skills/custom-slash-commands/TROUBLESHOOTING.md) |
| [headless-mode](skills/headless-mode/SKILL.md) | CLI flags and SDKs for automation | [SKILL](skills/headless-mode/SKILL.md) ยท [CLI-FLAGS](skills/headless-mode/CLI-FLAGS.md) ยท [SDK](skills/headless-mode/SDK.md) ยท [EXAMPLES](skills/headless-mode/EXAMPLES.md) |
| [transcript-intelligence](skills/transcript-intelligence/SKILL.md) | Search session transcripts | [SKILL](skills/transcript-intelligence/SKILL.md) ยท [TYPES](skills/transcript-intelligence/TYPES.md) ยท [SEARCH](skills/transcript-intelligence/SEARCH.md) |
| [writing-skills](skills/writing-skills/SKILL.md) | Create effective skills | [SKILL](skills/writing-skills/SKILL.md) ยท [TEMPLATES](skills/writing-skills/TEMPLATES.md) ยท [EXAMPLES](skills/writing-skills/EXAMPLES.md) |

### User-Focused Skills

Skills for everyday Claude Code usage:

| Skill | Description | Files |
|-------|-------------|-------|
| [effective-prompting](skills/effective-prompting/SKILL.md) | @ mentions, thinking modes, task framing | [SKILL](skills/effective-prompting/SKILL.md) ยท [PATTERNS](skills/effective-prompting/PATTERNS.md) ยท [EXAMPLES](skills/effective-prompting/EXAMPLES.md) ยท [ANTI-PATTERNS](skills/effective-prompting/ANTI-PATTERNS.md) |
| [memory-management](skills/memory-management/SKILL.md) | CLAUDE.md, rules, memory strategies | [SKILL](skills/memory-management/SKILL.md) ยท [CLAUDE-MD](skills/memory-management/CLAUDE-MD.md) ยท [RULES](skills/memory-management/RULES.md) ยท [STRATEGIES](skills/memory-management/STRATEGIES.md) |
| [debugging-claude-code](skills/debugging-claude-code/SKILL.md) | Diagnostics, common fixes, recovery | [SKILL](skills/debugging-claude-code/SKILL.md) ยท [DIAGNOSTICS](skills/debugging-claude-code/DIAGNOSTICS.md) ยท [COMMON-ISSUES](skills/debugging-claude-code/COMMON-ISSUES.md) ยท [RECOVERY](skills/debugging-claude-code/RECOVERY.md) |
| [project-setup](skills/project-setup/SKILL.md) | Configuration, permissions, checklists | [SKILL](skills/project-setup/SKILL.md) ยท [CONFIGURATION](skills/project-setup/CONFIGURATION.md) ยท [PERMISSIONS](skills/project-setup/PERMISSIONS.md) ยท [CHECKLIST](skills/project-setup/CHECKLIST.md) |
| [git-workflows](skills/git-workflows/SKILL.md) | Commits, PRs, branch strategies | [SKILL](skills/git-workflows/SKILL.md) ยท [COMMITS](skills/git-workflows/COMMITS.md) ยท [PULL-REQUESTS](skills/git-workflows/PULL-REQUESTS.md) ยท [PATTERNS](skills/git-workflows/PATTERNS.md) |
| [context-optimization](skills/context-optimization/SKILL.md) | /compact, /clear, context management | [SKILL](skills/context-optimization/SKILL.md) ยท [STRATEGIES](skills/context-optimization/STRATEGIES.md) ยท [INDICATORS](skills/context-optimization/INDICATORS.md) ยท [WORKFLOWS](skills/context-optimization/WORKFLOWS.md) |
| [permission-patterns](skills/permission-patterns/SKILL.md) | Default, plan, trusted modes | [SKILL](skills/permission-patterns/SKILL.md) ยท [MODES](skills/permission-patterns/MODES.md) ยท [PATTERNS](skills/permission-patterns/PATTERNS.md) ยท [SECURITY](skills/permission-patterns/SECURITY.md) |

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

skills/                # Distributable skills (16 total)
├── claude-code-reference/   # Extension reference guide
├── creating-hooks/          # Hook implementation guide
├── creating-mcp-servers/    # MCP server development
├── creating-plugins/        # Full plugin creation
├── creating-subagents/      # Custom subagents
├── custom-slash-commands/   # Slash command creation
├── headless-mode/           # Programmatic usage
├── transcript-intelligence/ # Session search
├── writing-skills/          # Skill creation guide
├── effective-prompting/     # Prompting techniques
├── memory-management/       # CLAUDE.md and rules
├── debugging-claude-code/   # Troubleshooting
├── project-setup/           # Project configuration
├── git-workflows/           # Git best practices
├── context-optimization/    # Context management
└── permission-patterns/     # Permission modes

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
