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
- **BREAKING**: Updated hook types to match Claude Code 2.1.17 documentation
  - Added new hook events: `Setup`, `Notification`, `PostToolUseFailure`
  - Added `hook_event_name` field to all hook inputs
  - Updated `PreToolUseOutput` with new `hookSpecificOutput` structure (old fields deprecated)
  - Updated `PermissionRequestOutput` with new decision structure
  - Updated `SubagentStartInput`/`SubagentStopInput` field names (`agent_type` instead of `agent_name`)
  - Added `SubagentStopOutput` type for subagent stop decision control
  - Added prompt-based hooks support (`PromptHookConfig`, `PromptHookResponse`)

### Fixed
- `transcript-tui`: Markdown renderer compatibility with marked v17
- `transcript-tui`: Include cache tokens in usage calculations

### Tracked Claude Code Changes (2.1.13-2.1.17)
- **2.1.17**: Fixed crashes on processors without AVX instruction support
- **2.1.16**: New task management system with dependency tracking, VSCode plugin management, OAuth session browsing
- **2.1.15**: npm installation deprecation warning (use `claude install`), React Compiler UI improvements
- **2.1.14**: History-based autocomplete in bash mode (`!`), plugin search, git SHA pinning, context window blocking fix
- **2.1.12**: Message rendering bug fix

### Tracked Claude Code Changes (2.0.71-2.1.12)
- **2.1.12**: `/doctor` validates permission rule syntax with suggestions
- **2.0.74**: LSP tool for code intelligence, skill `allowed-tools` fix, terminal setup for Kitty/Alacritty/Zed/Warp
- **2.0.73**: Clickable image links, alt-y yank-pop, plugin discover search filtering
- **2.0.72**: Claude in Chrome (Beta), reduced terminal flickering, improved @ mention speed
- **2.0.71**: /config toggle for prompt suggestions, /settings alias

### Documentation Patterns Noted (2.1.17)
- **Hooks lifecycle diagram**: New visual documentation of hook execution flow
- **Setup hook**: New event triggered via `--init`, `--init-only`, or `--maintenance` flags
- **Notification hook**: New event for permission_prompt, idle_prompt, auth_success, elicitation_dialog
- **Prompt-based hooks**: New `type: "prompt"` hooks using LLM evaluation (Stop, SubagentStop, etc.)
- **Hook input schemas**: Detailed tool input schemas for Bash, Write, Edit, Read tools
- **PreToolUse additionalContext**: Add context to Claude before tool executes
- **PermissionRequest decision control**: New `behavior: allow/deny` with `updatedInput` support
- **AWS Guardrails**: Bedrock integration supports Amazon Bedrock Guardrails
- **Task list**: New `Ctrl+T` to toggle task list, `CLAUDE_CODE_TASK_LIST_ID` for shared lists
- **WSL2 sandbox setup**: Documentation for bubblewrap/socat installation

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
