# What's New in Claude Code

This document tracks recent Claude Code features and changes. Updated when docs sync detects changes.

**Current Version:** 2.1.0
**Last Synced:** 2026-01-08

---

## Recent Highlights

### Version 2.1.0 (Latest) - Major Release

**Skills & Commands:**
- **Skill Hot-Reload** - Skills created or modified are immediately available without restart
- **Forked Skill Context** - `context: fork` in frontmatter runs skills in sub-agent context
- **Agent Field in Skills** - `agent` field to specify agent type for execution
- **`/plan` Command** - Quick shortcut to enable plan mode
- **Slash Command Anywhere** - Autocomplete works when `/` appears anywhere in input
- **Skills in Slash Menu** - Skills from `/skills/` directories visible in slash command menu by default

**Hooks:**
- **Hooks in Agent Frontmatter** - Define PreToolUse, PostToolUse, Stop hooks scoped to agent lifecycle
- **Hooks in Skill/Command Frontmatter** - Hooks can be defined directly in skills and commands
- **`once: true` Config** - Hooks that run only once
- **Plugin Prompt/Agent Hooks** - Prompt and agent hook types now supported from plugins

**Permissions & Tools:**
- **Wildcard Bash Permissions** - `Bash(npm *)`, `Bash(* install)`, `Bash(git * main)` patterns
- **Disable Specific Agents** - `Task(AgentName)` syntax in permissions or `--disallowedTools`
- **`--tools` Flag** - Restrict built-in tools in interactive mode

**Terminal & UI:**
- **Shift+Enter Works OOTB** - Works in iTerm2, WezTerm, Ghostty, Kitty without config
- **Unified Ctrl+B Backgrounding** - Backgrounds all running foreground tasks (bash + agents)
- **New Vim Motions** - `;`, `,`, `y`/`yy`/`Y`, `p`/`P`, text objects, `>>`, `<<`, `J`
- **Real-time Thinking Display** - Thinking blocks shown in Ctrl+O transcript mode

**MCP:**
- **MCP `list_changed`** - Servers can dynamically update tools/prompts/resources without reconnection

**Configuration:**
- **Language Setting** - `language: "japanese"` for response language
- **`IS_DEMO` Env Var** - Hide email/org from UI for streaming/recording
- **`CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`** - Override default file read token limit
- **YAML Lists in Frontmatter** - `allowed-tools` supports YAML-style lists

**Bug Fixes (Selected):**
- Fixed security issue where sensitive data could be exposed in debug logs
- Fixed files/skills not discovered when resuming sessions with `-c`/`--resume`
- Fixed pasted content lost when replaying prompts from history
- Fixed background tasks "git repository not found" for repos with dots in names
- Fixed Write tool using hardcoded permissions instead of system umask

### Version 2.0.75-2.0.76
- Minor bug fixes and stability improvements

### Version 2.0.74
- **LSP Tool** - Language Server Protocol support for code intelligence
- **Terminal Setup** - Support for Kitty, Alacritty, Zed, and Warp terminals
- **Theme Improvements** - Ctrl+T shortcut to toggle syntax highlighting

### Version 2.0.72-2.0.73
- **Claude in Chrome (Beta)** - Browser control via Chrome extension
- **Clickable Image Links** - `[Image #N]` links open attached images
- **Plugin Search** - Filter by name, description, or marketplace

### Version 2.0.60-2.0.64
- **Background Agents** - Run agents in the background while you work
- **Named Sessions** - Use `/rename` to name sessions, `/resume <name>` to resume them
- **Async Commands** - Agents and bash commands can run asynchronously
- **Rules Directory** - Support for `.claude/rules/` for organizing memory files

---

## Features by Category

### Skills & Commands

| Version | Feature | Description |
|---------|---------|-------------|
| 2.1.0 | Skill Hot-Reload | Skills immediately available without restart |
| 2.1.0 | Forked Skill Context | `context: fork` runs skills in sub-agent |
| 2.1.0 | Agent Field | `agent` field specifies agent type for execution |
| 2.1.0 | `/plan` Command | Quick shortcut to enable plan mode |
| 2.1.0 | Slash Anywhere | Autocomplete works when `/` appears anywhere |
| 2.1.0 | Skills in Menu | Skills visible in slash command menu by default |
| 2.1.0 | `--tools` Flag | Restrict built-in tools in interactive mode |
| 2.0.74 | LSP Tool | Code intelligence via Language Server Protocol |
| 2.0.70 | Wildcard MCP Permissions | `mcp__server__*` syntax for bulk tool permissions |
| 2.0.65 | Model Switching | Alt+P (Linux/Win) or Option+P (Mac) to switch models mid-prompt |
| 2.0.64 | Named Sessions | `/rename` and `/resume <name>` for session management |
| 2.0.43 | Skills Auto-load | Frontmatter field to declare skills for subagents |
| 2.0.20 | Claude Skills | Full skills system released |
| 1.0.81 | Output Styles | Built-in "Explanatory" and "Learning" styles |
| 1.0.60 | Custom Subagents | Create specialized agents with `/agents` |
| 1.0.57 | Model in Slash Commands | Specify model per slash command |

### Hooks

| Version | Feature | Description |
|---------|---------|-------------|
| 2.1.0 | Hooks in Agent Frontmatter | PreToolUse, PostToolUse, Stop hooks scoped to agent |
| 2.1.0 | Hooks in Skill/Command | Hooks defined directly in skills and commands |
| 2.1.0 | `once: true` Config | Hooks that run only once |
| 2.1.0 | Plugin Prompt/Agent Hooks | Prompt and agent hook types from plugins |
| 2.0.54 | PermissionRequest Hooks | Process 'always allow' suggestions and apply updates |
| 2.0.45 | PermissionRequest Hook | Auto-approve/deny tool permission requests |
| 2.0.43 | SubagentStart Hook | Hook event when subagents start |
| 2.0.42 | SubagentStop Fields | `agent_id` and `agent_transcript_path` in hooks |
| 2.0.41 | Hook Model Parameter | Custom model for prompt-based stop hooks |
| 2.0.30 | Prompt-based Stop Hooks | Stop hooks with prompt evaluation |
| 2.0.10 | PreToolUse Input Modification | Hooks can now modify tool inputs |
| 1.0.85 | SessionEnd Hook | Hook triggered at session end |
| 1.0.62 | SessionStart Hook | Hook for new session initialization |
| 1.0.54 | UserPromptSubmit Hook | Hook triggered on user prompt submission |
| 1.0.48 | PreCompact Hook | Hook before conversation compaction |
| 1.0.41 | Stop/SubagentStop Split | Separate hooks for main agent and subagent stops |
| 1.0.38 | Hooks Released | Initial hooks system release |

### MCP (Model Context Protocol)

| Version | Feature | Description |
|---------|---------|-------------|
| 2.1.0 | MCP `list_changed` | Servers dynamically update tools/prompts/resources |
| 2.0.71 | MCP Fix | Fixed servers from `.mcp.json` not loading with `--dangerously-skip-permissions` |
| 2.0.70 | Wildcard Permissions | `mcp__server__*` for allowing/denying all server tools |
| 2.0.31 | SSE on Native | Enabled SSE MCP servers on native build |
| 2.0.30 | MCP Tools for Subagents | Fixed MCP tools not available to sub-agents |
| 2.0.22 | Enterprise MCP | Managed MCP allowlist and denylist |
| 2.0.21 | structuredContent | Support for MCP `structuredContent` in tool responses |
| 2.0.10 | Enable/Disable by @mention | Toggle MCP servers via @-mention or `/mcp` |
| 1.0.52 | Server Instructions | Support for MCP server instructions |
| 1.0.27 | OAuth Support | Remote MCP servers (SSE/HTTP) now support OAuth |
| 1.0.27 | MCP Resources @-mention | MCP resources can be @-mentioned |

### Subagents

| Version | Feature | Description |
|---------|---------|-------------|
| 2.0.64 | TaskOutputTool | Unified tool replacing AgentOutputTool and BashOutputTool |
| 2.0.59 | Agent Setting | Configure main thread with agent's system prompt/tools/model |
| 2.0.43 | Skills Auto-load | Declare skills to auto-load for subagents |
| 2.0.43 | permissionMode | Custom permission modes for agents |
| 2.0.30 | disallowedTools | Explicit tool blocking for custom agents |
| 2.0.28 | Plan Subagent | New Plan subagent for plan mode |
| 2.0.28 | Dynamic Model Selection | Claude can choose subagent models dynamically |
| 2.0.28 | Resume Subagents | Claude can resume subagents |
| 2.0.0 | Dynamic Agents | Add subagents with `--agents` flag |
| 1.0.64 | Agent Model Customization | Specify which model an agent should use |

### Plugins & Marketplaces

| Version | Feature | Description |
|---------|---------|-------------|
| 2.0.72 | Plugin Search | Filter by name, description, or marketplace in discover screen |
| 2.0.70 | Plugin Marketplaces | Create and distribute plugin marketplaces via GitHub |
| 2.0.65 | Plugin Discovery | `/plugin` menu for browsing and installing plugins |
| 2.0.60 | Plugins Released | Full plugin system with commands, agents, hooks, MCP, LSP |

### Headless Mode

| Version | Feature | Description |
|---------|---------|-------------|
| 2.0.35 | Exit After Stop | `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY` for automated workflows |
| 2.0.28 | Max Budget | `--max-budget-usd` flag for SDK |
| 1.0.109 | Partial Message Streaming | `--include-partial-messages` CLI flag |
| 1.0.86 | UUID Support | UUID support for all SDK messages |
| 1.0.86 | Replay User Messages | `--replay-user-messages` to replay messages to stdout |
| 1.0.23 | TypeScript SDK | `@anthropic-ai/claude-code` package |
| 1.0.23 | Python SDK | `claude-code-sdk` pip package |

### IDE Integration

| Version | Feature | Description |
|---------|---------|-------------|
| 2.1.0 | Shift+Enter OOTB | Works in iTerm2, WezTerm, Ghostty, Kitty without config |
| 2.1.0 | Ctrl+B Backgrounding | Unified backgrounding for bash + agents |
| 2.1.0 | New Vim Motions | `;`, `,`, `y`, `p`, text objects, `>>`, `<<`, `J` |
| 2.1.0 | Thinking Display | Real-time thinking blocks in Ctrl+O transcript |
| 2.0.74 | Terminal Setup | Support for Kitty, Alacritty, Zed, Warp terminals |
| 2.0.73 | Tab Badges | VSCode badges for permissions (blue) and completions (orange) |
| 2.0.64 | Copy Button | VSCode copy-to-clipboard on code blocks |
| 2.0.60 | Background Support | Agents run in background while you work |
| 2.0.57 | Streaming Messages | VSCode real-time response display |
| 2.0.56 | Secondary Sidebar | VSCode support for right sidebar (v1.97+) |
| 2.0.34 | Initial Permission Mode | VSCode setting for new conversation permission mode |
| 2.0.31 | respectGitIgnore | Config to include .gitignored files in searches |
| 2.0.8 | Drag and Drop | IDE drag-and-drop for files and folders |
| 2.0.0 | Native VSCode Extension | New native VS Code extension |
| 1.0.110 | WezTerm Support | `/terminal-setup` now supports WezTerm |

### Configuration

| Version | Feature | Description |
|---------|---------|-------------|
| 2.1.0 | Language Setting | `language: "japanese"` for response language |
| 2.1.0 | `IS_DEMO` Env Var | Hide email/org from UI for streaming |
| 2.1.0 | File Read Token Limit | `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` env var |
| 2.1.0 | YAML Frontmatter Lists | `allowed-tools` supports YAML-style lists |
| 2.1.0 | Wildcard Bash Perms | `Bash(npm *)`, `Bash(* install)` patterns |
| 2.1.0 | Disable Agents | `Task(AgentName)` in permissions or `--disallowedTools` |
| 2.0.68 | Enterprise Managed Settings | Enterprise-managed settings support |
| 2.0.65 | fileSuggestion Setting | Custom `@` file search commands |
| 2.0.65 | CLAUDE_CODE_SHELL | Environment variable for shell override |
| 2.0.62 | Attribution Setting | Customize commit/PR bylines (replaces `includeCoAuthoredBy`) |
| 2.0.56 | Terminal Progress Bar | Setting to enable/disable OSC 9;4 |
| 2.0.37 | keep-coding-instructions | Output style frontmatter option |
| 2.0.35 | ignorePatterns Migration | Moved from project config to deny permissions |
| 2.0.30 | allowUnsandboxedCommands | Sandbox setting to disable escape hatch |
| 1.0.90 | Hot Reload Settings | Settings changes take effect immediately |
| 1.0.68 | disableAllHooks | Setting to disable all hooks |

### Models

| Version | Feature | Description |
|---------|---------|-------------|
| 2.0.67 | Thinking Default | Thinking mode enabled by default for Opus 4.5 |
| 2.0.58 | Opus 4.5 for Pro | Pro users get access to Opus 4.5 |
| 2.0.51 | Opus 4.5 Released | New Claude Opus 4.5 model |
| 2.0.21 | Haiku 4.5 | Haiku 4.5 as model option for Pro users |
| 2.0.17 | Haiku 4.5 in Selector | Haiku 4.5 with SonnetPlan default |
| 1.0.77 | Opus Plan Mode | Setting to run Opus only in plan mode |
| 1.0.69 | Opus 4.1 | Upgraded to Opus 4.1 |
| 1.0.0 | Sonnet 4 & Opus 4 | GA with new model family |

---

## Breaking Changes

### Version 2.0.25
- **Legacy SDK Removed** - Migrate to `@anthropic-ai/claude-agent-sdk`

### Version 2.0.8
- **Config Options Removed** - Removed deprecated `.claude.json` options: `allowedTools`, `ignorePatterns`, `env`, `todoFeatureEnabled`. Use `settings.json` instead.

### Version 1.0.7
- **Command Renamed** - `/allowed-tools` renamed to `/permissions`
- **Settings Migration** - `allowedTools` and `ignorePatterns` moved from `.claude.json` to `settings.json`

### Version 0.2.125
- **Bedrock ARN Format** - ARN should no longer contain escaped slash (use `/` instead of `%2F`)
- **Debug Flag** - `DEBUG=true` replaced with `ANTHROPIC_LOG=debug`

### Version 0.2.117
- **Print JSON Output** - `--print` JSON now returns nested message objects

---

## Deprecations

| Version | Deprecation | Alternative |
|---------|-------------|-------------|
| 2.0.70 | `#` shortcut for memory | Tell Claude to edit CLAUDE.md instead |
| 2.0.62 | `includeCoAuthoredBy` | Use `attribution` setting |
| 2.0.30 | Output Styles (partial) | Use `--system-prompt-file`, `--system-prompt`, `--append-system-prompt`, CLAUDE.md, or plugins |
| 2.0.32 | Output Styles (un-deprecated) | Based on community feedback |
| 1.0.7 | `claude config` commands | Edit `settings.json` directly |

---

## Installation Methods

### Native Installation (Recommended)

```bash
# macOS, Linux, WSL - Stable
curl -fsSL https://claude.ai/install.sh | bash

# macOS, Linux, WSL - Latest
curl -fsSL https://claude.ai/install.sh | bash -s latest

# Windows PowerShell - Stable
irm https://claude.ai/install.ps1 | iex

# Windows PowerShell - Latest
& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) latest
```

### npm Installation

```bash
npm install -g @anthropic-ai/claude-code
```

---

## Configuration File Locations

| File | Purpose |
|------|---------|
| `~/.claude/settings.json` | User settings (permissions, hooks, model overrides) |
| `.claude/settings.json` | Project settings (checked into source control) |
| `.claude/settings.local.json` | Local project settings (not committed) |
| `~/.claude.json` | Global state (theme, OAuth, MCP servers, allowed tools) |
| `.mcp.json` | Project MCP servers (checked into source control) |
| `managed-settings.json` | Enterprise managed settings |
| `managed-mcp.json` | Enterprise managed MCP servers |

### Enterprise Managed File Locations

- **macOS:** `/Library/Application Support/ClaudeCode/`
- **Linux/WSL:** `/etc/claude-code/`
- **Windows:** `C:\ProgramData\ClaudeCode\`

---

## Useful Commands

```bash
claude doctor          # Check installation health
claude update          # Update to latest version
/context               # View and debug context issues
/permissions           # Manage tool permissions
/mcp                   # Manage MCP servers
/config                # Configure settings
/usage                 # View plan limits
/stats                 # View usage statistics
/resume                # Resume previous conversations
/compact               # Reduce context size
/bug                   # Report issues to Anthropic
```

---

## Resources

- [Official Documentation](https://code.claude.com/docs)
- [GitHub Repository](https://github.com/anthropics/claude-code)
- [Changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- [Plugin Documentation](https://code.claude.com/docs/en/plugins)
- [Hooks Documentation](https://code.claude.com/docs/en/hooks)
- [Skills Documentation](https://code.claude.com/docs/en/skills)
- [Agent SDK](https://platform.claude.com/docs/en/agent-sdk)

---

*This file is maintained by the docs-sync skill and updated when documentation changes are detected.*
