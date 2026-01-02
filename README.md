# Claude Code SDK

SDK for tracking Claude Code changes, extending components, and managing a plugin marketplace.

## Installation

```bash
bun add claude-code-sdk
```

## Usage

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk';

const sdk = new ClaudeCodeSDK();
await sdk.init();

// Track Claude Code changes
const changes = await sdk.tracker.fetchChanges();
const breaking = sdk.tracker.getBreakingChanges('1.0.0', '2.0.0');

// Browse marketplace
const packages = await sdk.marketplace.search({ query: 'git', type: 'tool' });

// Manage plugins
const installed = sdk.plugins.getAll();
const skills = sdk.plugins.getByType('skill');
```

## Modules

### Change Tracker

Monitor Claude Code releases and identify breaking changes:

```typescript
import { ChangeTracker } from 'claude-code-sdk/tracker';

const tracker = new ChangeTracker();
const hasBreaking = tracker.hasBreakingChangesSince('1.0.0');
const guide = tracker.getMigrationGuide('1.0.0', '2.0.0');
```

### Marketplace

Browse and install plugins:

```typescript
import { Marketplace } from 'claude-code-sdk/marketplace';

const marketplace = new Marketplace();
const featured = await marketplace.getFeatured();
const tools = await marketplace.getByType('tool');
```

### Plugin Manager

Load and manage installed plugins:

```typescript
import { PluginManager } from 'claude-code-sdk/plugins';

const manager = new PluginManager();
await manager.loadAll();
manager.enable('my-plugin');
```

## Plugin Types

- `skill` - Custom skills with triggers and instructions
- `tool` - Additional tools for Claude Code
- `hook` - Event handlers (pre/post tool calls, messages, etc.)
- `command` - Custom slash commands
- `mcp-server` - MCP server integrations

## Development

```bash
bun install        # Install dependencies
bun test           # Run tests
bun run dev        # Development with watch mode
bun run build      # Build for distribution
```

## License

MIT
