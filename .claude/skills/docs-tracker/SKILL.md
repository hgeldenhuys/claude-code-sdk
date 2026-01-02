---
name: docs-tracker
description: Track, cache, and detect changes in Claude Code documentation. Use when needing to check for doc updates, search documentation content, verify Claude Code capabilities, or understand what changed in official docs since last check.
allowed-tools: Read, Bash, Grep, Glob
---

# Documentation Tracker Skill

Track and monitor Claude Code official documentation for changes, search cached docs, and stay updated on Claude Code capabilities.

## When to Use This Skill

- Checking if Claude Code documentation has been updated
- Searching for specific features or capabilities in the docs
- Understanding current Claude Code behavior from official sources
- Detecting breaking changes or new features in documentation
- Looking up hooks, skills, plugins, MCP, or other Claude Code features

## Quick Start

```bash
# Fetch/update all documentation (23 docs, ~330KB)
bun run docs:fetch

# Check for changes since last fetch
bun run docs:check

# Show cache status
bun run docs:status

# List all cached docs by category
bun run docs list

# Search documentation content
bun run docs search "PreToolUse"
bun run docs search "hooks"
bun run docs search "skills"
```

## Cached Documentation Categories

| Category | Topics Covered |
|----------|---------------|
| `development` | hooks, hooks-guide, skills, sub-agents, plugins, headless |
| `configuration` | settings, memory, model-config, terminal-config, output-styles, statusline |
| `reference` | cli-reference, slash-commands, interactive-mode, checkpointing, plugins-reference |
| `integration` | mcp, amazon-bedrock |
| `enterprise` | third-party-integrations, network-config, llm-gateway |
| `troubleshooting` | troubleshooting |

## Cache Location

Cached documentation is stored in: `.claude-code-sdk/docs-cache/`

- `content/` - Raw markdown files
- `metadata.json` - Document metadata with hashes for delta detection

## Key Capabilities

1. **Fetch & Cache** - Download all 23 Claude Code documentation pages
2. **Delta Detection** - SHA-256 hashing to detect content changes
3. **Search** - Full-text search across all cached documentation
4. **Categorization** - Docs organized by topic area
5. **Version Tracking** - Track when docs changed and version history

## Programmatic Usage

```typescript
import { DocsTracker } from 'claude-code-sdk';

const tracker = new DocsTracker();
await tracker.init();

// Fetch all docs
const result = await tracker.fetchAll();

// Check for changes
const deltas = await tracker.checkAllForChanges();
const changed = deltas.filter(d => d.hasChanges);

// Search content
const results = await tracker.searchContent('hooks');

// Get docs by category
const devDocs = tracker.getByCategory('development');
```

For detailed API reference, see [api-reference.md](api-reference.md).
For usage examples, see [examples.md](examples.md).
