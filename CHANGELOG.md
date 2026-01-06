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

### Changed
- Updated `DocsTracker` to monitor both code.claude.com and docs.claude.com sources
- Skills docs reflect Claude Code 2.0.74 patterns (model field, subagent skills integration)

### Tracked Claude Code Changes (2.0.71-2.0.74)
- **2.0.74**: LSP tool for code intelligence, skill `allowed-tools` fix, terminal setup for Kitty/Alacritty/Zed/Warp
- **2.0.73**: Clickable image links, alt-y yank-pop, plugin discover search filtering
- **2.0.72**: Claude in Chrome (Beta), reduced terminal flickering, improved @ mention speed
- **2.0.71**: /config toggle for prompt suggestions, /settings alias

### Documentation Patterns Noted
- Skills: `model` field in frontmatter for specifying execution model
- Skills: `skills` field in subagent AGENT.md for skill inheritance
- Settings: `strictKnownMarketplaces` for enterprise marketplace control
- Settings: `allowManagedHooksOnly` for enterprise hook restrictions
- MCP: `managed-mcp.json` for enterprise MCP policy deployment
- Plugins: LSP server configuration support added
