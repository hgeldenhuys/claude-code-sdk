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
/plugin install chrome-integration@claude-code-sdk
/plugin install effective-prompting@claude-code-sdk
/plugin install memory-management@claude-code-sdk
/plugin install debugging-claude-code@claude-code-sdk
/plugin install project-setup@claude-code-sdk
/plugin install git-workflows@claude-code-sdk
/plugin install context-optimization@claude-code-sdk
/plugin install permission-patterns@claude-code-sdk

# Advanced workflow skills
/plugin install testing-patterns@claude-code-sdk
/plugin install code-review@claude-code-sdk
/plugin install refactoring-safely@claude-code-sdk
/plugin install multi-file-editing@claude-code-sdk
/plugin install cost-optimization@claude-code-sdk
/plugin install ide-integration@claude-code-sdk
/plugin install team-workflows@claude-code-sdk
/plugin install documentation-generation@claude-code-sdk
/plugin install database-workflows@claude-code-sdk
/plugin install error-recovery@claude-code-sdk
/plugin install migration-guides@claude-code-sdk
/plugin install security-practices@claude-code-sdk
/plugin install monorepo-patterns@claude-code-sdk
/plugin install ci-cd-integration@claude-code-sdk
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

| Skill | Description |
|-------|-------------|
| [claude-code-reference](skills/claude-code-reference/SKILL.md) | Reference guide for Claude Code extensions |
| [creating-hooks](skills/creating-hooks/SKILL.md) | All 10 hook events with examples |
| [creating-mcp-servers](skills/creating-mcp-servers/SKILL.md) | MCP server development and integration |
| [creating-plugins](skills/creating-plugins/SKILL.md) | Full plugin bundling and distribution |
| [creating-subagents](skills/creating-subagents/SKILL.md) | Custom Task tool agents |
| [custom-slash-commands](skills/custom-slash-commands/SKILL.md) | Create custom slash commands |
| [headless-mode](skills/headless-mode/SKILL.md) | CLI flags and SDKs for automation |
| [transcript-intelligence](skills/transcript-intelligence/SKILL.md) | Search session transcripts |
| [writing-skills](skills/writing-skills/SKILL.md) | Create effective skills |

### User-Focused Skills

Skills for everyday Claude Code usage:

| Skill | Description |
|-------|-------------|
| [chrome-integration](skills/chrome-integration/SKILL.md) | Browser automation, web app testing, live debugging |
| [effective-prompting](skills/effective-prompting/SKILL.md) | @ mentions, thinking modes, task framing |
| [memory-management](skills/memory-management/SKILL.md) | CLAUDE.md, rules, memory strategies |
| [debugging-claude-code](skills/debugging-claude-code/SKILL.md) | Diagnostics, common fixes, recovery |
| [project-setup](skills/project-setup/SKILL.md) | Configuration, permissions, checklists |
| [git-workflows](skills/git-workflows/SKILL.md) | Commits, PRs, branch strategies |
| [context-optimization](skills/context-optimization/SKILL.md) | /compact, /clear, context management |
| [permission-patterns](skills/permission-patterns/SKILL.md) | Default, plan, trusted modes |

### Advanced Workflow Skills

Skills for advanced development workflows:

| Skill | Description |
|-------|-------------|
| [testing-patterns](skills/testing-patterns/SKILL.md) | TDD workflows, test generation, coverage strategies |
| [code-review](skills/code-review/SKILL.md) | PR workflows, review prompts, checklists |
| [refactoring-safely](skills/refactoring-safely/SKILL.md) | Large-scale changes, validation, rollback |
| [multi-file-editing](skills/multi-file-editing/SKILL.md) | Coordinated changes across multiple files |
| [cost-optimization](skills/cost-optimization/SKILL.md) | Token strategies, model selection, monitoring |
| [ide-integration](skills/ide-integration/SKILL.md) | VS Code, JetBrains, terminal workflows |
| [team-workflows](skills/team-workflows/SKILL.md) | Shared configs, standards, onboarding |
| [documentation-generation](skills/documentation-generation/SKILL.md) | READMEs, API docs, inline comments |
| [database-workflows](skills/database-workflows/SKILL.md) | Schema design, migrations, query optimization |
| [error-recovery](skills/error-recovery/SKILL.md) | Error types, recovery patterns, prevention |
| [migration-guides](skills/migration-guides/SKILL.md) | From other AI tools, version upgrades |
| [security-practices](skills/security-practices/SKILL.md) | Vulnerability prevention, secrets, security review |
| [monorepo-patterns](skills/monorepo-patterns/SKILL.md) | Navigation, cross-package changes, tooling |
| [ci-cd-integration](skills/ci-cd-integration/SKILL.md) | GitHub Actions, automation, pipelines |

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

### Hook Framework

Build Claude Code hooks with YAML configuration and built-in handlers:

```yaml
# hooks.yaml
version: 1

settings:
  debug: false
  parallelExecution: true
  defaultTimeoutMs: 30000

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
      blockedPatterns:
        - "rm -rf /"

  tool-logger:
    enabled: true
    options:
      outputPath: ~/.claude/logs/tools.log

handlers:
  my-custom-hook:
    events: [PreToolUse]
    command: ./scripts/validate-tool.sh
```

**Built-in Handlers:**

| Handler | Description | Default Events |
|---------|-------------|----------------|
| `session-naming` | Assigns human-friendly names (adjective-animal) | SessionStart |
| `turn-tracker` | Tracks turns between Stop events | SessionStart, Stop, SubagentStop, PreToolUse, PostToolUse |
| `dangerous-command-guard` | Blocks dangerous Bash commands | PreToolUse |
| `context-injection` | Injects session context | SessionStart, PreCompact |
| `tool-logger` | Logs tool usage with turn/session context | PostToolUse |

**Environment Variables for Custom Handlers:**

Custom command handlers receive these environment variables:

| Variable | Description |
|----------|-------------|
| `CLAUDE_SESSION_ID` | Current session ID |
| `CLAUDE_SESSION_NAME` | Human-friendly session name |
| `CLAUDE_TURN_ID` | Turn identifier (session:sequence) |
| `CLAUDE_TURN_SEQUENCE` | Current turn number |
| `CLAUDE_EVENT_TYPE` | Hook event type |
| `CLAUDE_CWD` | Current working directory |

```typescript
import { createFramework, handler, blockResult } from 'claude-code-sdk/hooks/framework';

const framework = createFramework({ debug: true });

framework.onPreToolUse(
  handler()
    .id('my-validator')
    .forTools('Bash')
    .handle(ctx => {
      const input = ctx.event.tool_input as { command?: string };
      if (input.command?.includes('rm -rf')) {
        return blockResult('Dangerous command blocked');
      }
      return { success: true };
    })
);

await framework.run();
```

## CLI Tools

### Transcript Viewer CLI

View and filter Claude Code session transcripts:

```bash
# Basic viewing
bun run transcript <file|session> --human     # Human-readable format
bun run transcript <file|session> --json      # Raw JSON output
bun run transcript <file|session> --minimal   # Text content only

# Filtering
bun run transcript <file> --assistant         # Only assistant responses
bun run transcript <file> --user-prompts      # Only user messages
bun run transcript <file> --tools             # Only tool use/results
bun run transcript <file> --thinking          # Only thinking blocks
bun run transcript <file> --text-only         # AI text only (no tools/thinking)
bun run transcript <file> --last 50           # Last 50 entries
bun run transcript <file> --type user,assistant  # Specific types

# Session filtering
bun run transcript <file> --session abc123              # Filter by session ID
bun run transcript <file> --session abc123,def456       # Multiple sessions
bun run transcript <file> --session-name my-project     # Filter by sesh name

# Time filtering
bun run transcript <file> --from-time "1h ago"          # Last hour
bun run transcript <file> --from-time 2024-01-15T10:00:00Z  # ISO timestamp

# Live modes
bun run transcript <file> --tail              # Stream new entries (colored 1-liners)
bun run transcript <file> --watch             # Show last entry, auto-refresh

# Export
bun run transcript <file> --json --output results.json  # Export to file
```

### Transcript Viewer TUI

Interactive terminal UI for browsing transcripts:

```bash
bun run transcript-tui <file|session>         # Open TUI
bun run transcript-tui <file> --assistant     # Pre-filtered
bun run transcript-tui <file> --session abc123  # Filter by session
```

**Navigation:**
| Key | Action |
|-----|--------|
| `j/k` or `↑/↓` | Navigate lines |
| `h/l` | Scroll content |
| `g/G` | First/last line |
| `Tab` | Switch panes |
| `f` | Toggle fullscreen |
| `s` | Toggle scroll mode (fullscreen) |

**View Modes:**
| Key | Mode |
|-----|------|
| `1` | Raw JSON |
| `2` | Human-readable |
| `3` | Minimal |
| `4` | Context (thread) |
| `5` | Markdown |

**Features:**
| Key | Feature |
|-----|---------|
| `c` | Copy content to clipboard |
| `y` | Copy recall reference |
| `b` | Toggle bookmark |
| `[/]` | Jump between bookmarks |
| `u` | Usage graph overlay |
| `m` | Toggle mouse support |
| `?` | Help overlay |
| `/` | Search |

### Session Manager (sesh)

Manage session names for easy resumption:

```bash
bun run sesh list                    # List all named sessions
bun run sesh my-project              # Get session ID for name
bun run sesh rename old-name new     # Rename a session
bun run sesh info my-project         # Show session details

# Resume by name
claude --resume $(bun run sesh my-project)
```

### Development Commands

```bash
bun install          # Install dependencies
bun test             # Run tests
bun run dev          # Development with watch mode
bun run build        # Build for distribution
bun run lint         # Check code with Biome
bun run typecheck    # TypeScript type checking

# Documentation tracking
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

skills/                # Distributable skills (30 total)
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
├── permission-patterns/     # Permission modes
├── testing-patterns/        # TDD and test generation
├── code-review/             # PR review workflows
├── refactoring-safely/      # Safe refactoring
├── multi-file-editing/      # Coordinated changes
├── cost-optimization/       # API cost management
├── ide-integration/         # VS Code, JetBrains
├── team-workflows/          # Team collaboration
├── documentation-generation/ # Doc generation
├── database-workflows/      # Schema, migrations
├── error-recovery/          # Error handling
├── migration-guides/        # Tool migrations
├── security-practices/      # Security patterns
├── monorepo-patterns/       # Monorepo workflows
└── ci-cd-integration/       # CI/CD pipelines

bin/                   # CLI tools
├── sesh.ts            # Session name manager
├── transcript.ts      # Transcript viewer CLI
└── transcript-tui.ts  # Transcript viewer TUI

src/
├── index.ts           # Main SDK entry point
├── types/             # TypeScript interfaces
├── tracker/           # Change tracking module
├── marketplace/       # Plugin marketplace
├── plugins/           # Plugin management
├── docs/              # Documentation tracker
├── hooks/             # Hooks SDK
│   ├── framework/     # Hook framework (YAML config, pipelines)
│   │   ├── handlers/  # Built-in handlers (session-naming, turn-tracker, etc.)
│   │   └── config/    # YAML loader and validator
│   └── sessions/      # Session naming module
└── transcripts/       # Transcript parsing, viewing, search

examples/              # Example implementations
├── hooks.yaml         # Hook framework config example
└── hooks/             # Hook script examples

tests/                 # Test suites
```

## License

MIT
