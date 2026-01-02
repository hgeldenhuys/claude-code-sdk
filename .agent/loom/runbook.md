# Claude Code SDK - Project Runbook

## Project Overview

**Name:** claude-code-sdk
**Version:** 0.1.0
**Type:** TypeScript Library
**Runtime:** Bun

SDK for tracking Claude Code changes, extending components, and managing a plugin marketplace.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun |
| Package Manager | Bun |
| Language | TypeScript (strict mode) |
| Testing | bun:test |
| Linting | Biome |
| Formatting | Biome |

## Project Structure

```
claude-code-sdk/
├── src/                    # Source code with barrel exports
│   ├── index.ts           # Main SDK entry point
│   ├── types/             # TypeScript interfaces
│   ├── tracker/           # Change tracking module
│   ├── marketplace/       # Plugin marketplace module
│   ├── plugins/           # Plugin management module
│   └── utils/             # Shared utilities
├── tests/                 # Unit tests using bun:test
├── hooks/                 # Claude Code hook implementations
├── notify-service/        # Standalone notification service
└── dist/                  # Build output
```

## Commands

```bash
# Development
bun install          # Install dependencies
bun run dev          # Run with watch mode
bun run build        # Build for distribution

# Testing
bun test             # Run all tests
bun test --watch     # Run tests in watch mode
bun test <file>      # Run single test file

# Code Quality
bun run lint         # Check code with Biome
bun run lint:fix     # Auto-fix linting issues
bun run format       # Format code with Biome
bun run typecheck    # Run TypeScript type checking
```

## Code Conventions

### Style Rules

| Convention | Standard |
|------------|----------|
| Loop Style | `for-of` (prefer for-loops over forEach) |
| Async Style | `async-await` |
| Export Style | Named exports |
| Function Style | Mixed (arrow and declaration) |
| Quote Style | Single quotes |
| Semicolons | Always |
| Trailing Commas | ES5 |
| Indent | 2 spaces |
| Line Width | 100 characters |
| Module Type | ESM |

### Naming Conventions

| Element | Convention |
|---------|------------|
| Files | kebab-case |
| Classes | PascalCase |
| Functions | camelCase |
| Constants | camelCase |
| Interfaces | PascalCase |
| Types | PascalCase |

### Code Patterns

1. **Use Bun APIs over Node.js equivalents**
   - `Bun.file()` over `fs.readFile()`
   - `bun:test` over Jest/Vitest

2. **Barrel exports** - Each module has an `index.ts` that re-exports public API

3. **Strict TypeScript** - `noUncheckedIndexedAccess`, `strict` mode enabled

## Testing Standards

- Write unit tests for all public APIs
- Use descriptive test names with `describe`/`test` blocks
- Test file naming: `*.test.ts`
- Test files in `/tests` directory mirroring source structure

## Architecture Notes

### Core Classes

- **ClaudeCodeSDK**: Main entry point orchestrating all modules
- **ChangeTracker**: Monitors Claude Code releases, identifies breaking changes
- **Marketplace**: Searches, downloads, and installs plugins
- **PluginManager**: Loads, enables/disables, and manages installed plugins

### Plugin Types

- `skill` - Custom skills with triggers and instructions
- `tool` - Additional tools for Claude Code
- `hook` - Event handlers (pre/post tool calls, messages)
- `command` - Custom slash commands
- `mcp-server` - MCP server integrations

## Definition of Done

- [ ] Code compiles without errors (`bun run typecheck`)
- [ ] All tests pass (`bun test`)
- [ ] Linting passes (`bun run lint`)
- [ ] Public APIs have TypeScript types
- [ ] Breaking changes documented

## Dependencies

### Production
- `@inquirer/prompts` - Interactive CLI prompts
- `claude-hooks-sdk` - Hook SDK integration

### Development
- `@biomejs/biome` - Linting and formatting
- `@types/bun` - Bun type definitions
- `typescript` - TypeScript compiler

## Loom Workflow

1. **Ideate** (`/loom:ideate`) - Create stories with acceptance criteria
2. **Plan** (`/loom:plan`) - Break down stories into tasks
3. **Execute** (`/loom:start`) - Implement with specialized agents
4. **Finalize** (`/loom:finalize`) - Retrospective and commit
