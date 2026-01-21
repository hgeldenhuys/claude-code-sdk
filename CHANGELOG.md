# Changelog

All notable changes to the Claude Code SDK will be documented in this file.

## [Unreleased]

### Added
- Documentation sync command (`/docs-sync`) for automated doc tracking workflow
- New documentation sources from docs.claude.com:
  - Agent Skills overview, best practices, and quickstart
  - Claude 4 best practices
  - Claude Code SDK overview
- `writing-skills` skill for creating effective Claude Code skills
- `transcript-tui`: Multi-session viewing with comma-separated names
- `transcript-tui`: Markdown view (mode 5) with terminal-friendly rendering
- `transcript-tui`: Context usage graph (press `u`) with clear/compact boundary detection
- `hook-events-tui`: Multi-session viewing with comma-separated names

### Changed
- Updated `DocsTracker` to monitor both code.claude.com and docs.claude.com sources
- Skills docs reflect Claude Code 2.0.74 patterns (model field, subagent skills integration)
- `transcript-tui`: Usage graph now shows actual context % (not cumulative) with color coding

### Fixed
- `transcript-tui`: Markdown renderer compatibility with marked v17
- `transcript-tui`: Include cache tokens in usage calculations

### Tracked Claude Code Changes (2.0.71-2.1.12)
- **2.1.12**: `/doctor` validates permission rule syntax with suggestions
- **2.0.74**: LSP tool for code intelligence, skill `allowed-tools` fix, terminal setup for Kitty/Alacritty/Zed/Warp
- **2.0.73**: Clickable image links, alt-y yank-pop, plugin discover search filtering
- **2.0.72**: Claude in Chrome (Beta), reduced terminal flickering, improved @ mention speed
- **2.0.71**: /config toggle for prompt suggestions, /settings alias

### Documentation Patterns Noted (2.1.12)
- **Skills rewrite**: Custom slash commands merged into skills system
- **Permission rule syntax**: Detailed docs on rule evaluation order (deny→ask→allow)
- **Permission wildcards**: `:*` (prefix with word boundary) vs `*` (glob anywhere)
- **Subagent skill preloading**: Load skills into subagents via frontmatter
- **MCP prompts as commands**: Use MCP prompts directly as slash commands
- **Interactive mode**: Built-in commands now documented separately from skills
- **Output styles vs skills**: New section explaining the difference
- Skills: `model` field in frontmatter for specifying execution model
- Skills: `skills` field in subagent AGENT.md for skill inheritance
- Settings: `strictKnownMarketplaces` for enterprise marketplace control
- Settings: `allowManagedHooksOnly` for enterprise hook restrictions
- MCP: `managed-mcp.json` for enterprise MCP policy deployment
- Plugins: LSP server configuration support added
