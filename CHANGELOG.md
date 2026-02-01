# Changelog

All notable changes to the Claude Code SDK will be documented in this file.

## [Unreleased]

### Added
- Agent-based hook type (`AgentHookConfig`) with `type: "agent"` for multi-turn verification hooks
- `permission_suggestions` field on `PermissionRequestInput` for "always allow" options
- `async` field on `CommandHookConfig` for background hook execution
- `statusMessage` and `once` fields on all hook config types (command, prompt, agent)
- `model` field on `PromptHookConfig` for model selection
- `bypass_permissions_disabled` reason variant on `SessionEndInput`
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

### Tracked Claude Code Changes (2.1.18-2.1.29)
- **2.1.29**: Fixed startup performance for sessions with `saved_hook_context`
- **2.1.27**: `--from-pr` flag for PR-linked sessions, auto-PR linking via `gh pr create`, VSCode OAuth fix
- **2.1.25**: Fixed beta header validation for gateway users on Bedrock/Vertex
- **2.1.23**: Customizable spinner verbs (`spinnerVerbs` setting), mTLS/proxy fixes, async hook cancellation on headless end
- **2.1.22**: Fixed structured outputs for non-interactive (`-p`) mode
- **2.1.21**: Auto-compact timing fix for large output models, Python venv auto-activation in VSCode
- **2.1.20**: PR review status indicator, `--add-dir` CLAUDE.md loading, task deletion via `TaskUpdate`
- **2.1.19**: Shorthand `$0`/`$1` for command arguments, skills without extra permissions auto-allowed, `$ARGUMENTS[0]` bracket syntax
- **2.1.18**: Customizable keyboard shortcuts (`/keybindings`)

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

### Documentation Patterns Noted (2.1.29)
- **Hooks reference overhaul**: Complete rewrite with annotated resolution flow, tool input schemas for all tools
- **Agent-based hooks**: New `type: "agent"` hooks that spawn subagents with tool access for verification
- **Hooks guide rewrite**: Separate guide page with step-by-step setup, examples, and troubleshooting
- **Headless → Agent SDK rename**: CLI `-p` mode now branded as "Agent SDK", docs reference platform.claude.com SDK
- **Stream responses**: New `--output-format stream-json --verbose --include-partial-messages` for token streaming
- **Memory: additional directories**: `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` with `--add-dir` loads memory from extra dirs
- **Settings: new fields**: `spinnerVerbs`, `autoUpdatesChannel`, `spinnerTipsEnabled`, `terminalProgressBarEnabled`, `showTurnDuration`, `plansDirectory`, `language`
- **Settings: attribution**: New `attribution` setting replaces deprecated `includeCoAuthoredBy`
- **Settings: file suggestion**: `fileSuggestion` for custom `@` autocomplete via command
- **Interactive mode: PR review status**: Colored dot + clickable link showing PR state in prompt footer
- **Slash commands removal**: `slash-commands.md` returns 404, merged into skills system
- **Skills: subagent execution**: `run-in: subagent` frontmatter option
- **SubagentStop matcher**: Now documented as supporting same values as `SubagentStart`

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
