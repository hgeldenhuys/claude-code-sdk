#!/usr/bin/env bash
#
# Claude Code Hooks Installer
# ===========================
# Install the hook framework with sensible defaults for any project.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/hgeldenhuys/claude-code-sdk/main/scripts/install-hooks.sh | bash
#
# What gets installed:
#   - .claude/settings.json     - Hook registrations for Claude Code
#   - hooks.yaml                - Handler configuration
#   - package.json dependency   - claude-code-sdk (if package.json exists)
#
# Enabled handlers:
#   - session-naming    : Human-friendly session names (brave-elephant)
#   - turn-tracker      : Track turns within sessions
#   - context-injection : Inject session context (memory)
#   - event-logger      : Log events for transcript indexing
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging
info() { echo -e "${BLUE}[info]${NC} $1"; }
success() { echo -e "${GREEN}[ok]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }
error() { echo -e "${RED}[error]${NC} $1"; exit 1; }

# Detect package manager
detect_pm() {
  if command -v bun &> /dev/null; then
    echo "bun"
  elif command -v pnpm &> /dev/null; then
    echo "pnpm"
  elif command -v yarn &> /dev/null; then
    echo "yarn"
  elif command -v npm &> /dev/null; then
    echo "npm"
  else
    echo ""
  fi
}

# Main
main() {
  echo ""
  echo -e "${BLUE}Claude Code Hooks Installer${NC}"
  echo "============================"
  echo ""

  # Check we're in a project directory
  if [ ! -f "package.json" ] && [ ! -f ".git/config" ]; then
    warn "No package.json or .git found. Creating minimal setup."
  fi

  # Create .claude directory
  info "Creating .claude directory..."
  mkdir -p .claude
  success "Created .claude/"

  # Create hooks.yaml
  info "Creating hooks.yaml..."
  cat > hooks.yaml << 'HOOKS_YAML'
# Claude Code Hook Framework Configuration
# ========================================
# Manages session naming, turn tracking, and context injection.
#
# Edit this file to customize handler behavior.
# Docs: https://github.com/hgeldenhuys/claude-code-sdk

version: 1

settings:
  debug: false
  parallel_execution: true
  default_timeout_ms: 30000
  default_error_strategy: continue

builtins:
  # Human-friendly session names (e.g., "brave-elephant")
  session-naming:
    enabled: true
    options:
      format: adjective-animal

  # Track turns between Stop events
  turn-tracker:
    enabled: true
    options:
      preserve_on_resume: true

  # Inject context at session start and before compaction
  context-injection:
    enabled: true
    options:
      include_session_info: true
      include_turn_id: true

  # Block dangerous Bash commands
  dangerous-command-guard:
    enabled: true
    options:
      strict: false
      blocked_patterns:
        - "rm -rf /"
        - "rm -rf ~"

  # Log events for transcript indexing
  event-logger:
    enabled: true
    options:
      includeInput: true
      includeContext: true
      includeHandlerResults: true

  # Performance metrics (optional)
  metrics:
    enabled: false

  # Tool logging (optional)
  tool-logger:
    enabled: false

  # Debug logging (optional - very verbose)
  debug-logger:
    enabled: false

# Custom handlers - add your own here
handlers: {}
HOOKS_YAML
  success "Created hooks.yaml"

  # Create .claude/settings.json
  info "Creating .claude/settings.json..."
  cat > .claude/settings.json << 'SETTINGS_JSON'
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bunx claude-code-sdk hooks --config \"$CLAUDE_PROJECT_DIR\"/hooks.yaml"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bunx claude-code-sdk hooks --config \"$CLAUDE_PROJECT_DIR\"/hooks.yaml"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bunx claude-code-sdk hooks --config \"$CLAUDE_PROJECT_DIR\"/hooks.yaml"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bunx claude-code-sdk hooks --config \"$CLAUDE_PROJECT_DIR\"/hooks.yaml"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bunx claude-code-sdk hooks --config \"$CLAUDE_PROJECT_DIR\"/hooks.yaml"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bunx claude-code-sdk hooks --config \"$CLAUDE_PROJECT_DIR\"/hooks.yaml"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bunx claude-code-sdk hooks --config \"$CLAUDE_PROJECT_DIR\"/hooks.yaml"
          }
        ]
      }
    ]
  }
}
SETTINGS_JSON
  success "Created .claude/settings.json"

  # Install claude-code-sdk if package.json exists
  PM=$(detect_pm)
  if [ -f "package.json" ] && [ -n "$PM" ]; then
    info "Installing claude-code-sdk as dev dependency..."
    case $PM in
      bun)
        bun add -d claude-code-sdk 2>/dev/null || warn "Could not install - package may not be published yet"
        ;;
      pnpm)
        pnpm add -D claude-code-sdk 2>/dev/null || warn "Could not install - package may not be published yet"
        ;;
      yarn)
        yarn add -D claude-code-sdk 2>/dev/null || warn "Could not install - package may not be published yet"
        ;;
      npm)
        npm install -D claude-code-sdk 2>/dev/null || warn "Could not install - package may not be published yet"
        ;;
    esac

    # Update settings.json to use local install instead of bunx
    if [ -d "node_modules/claude-code-sdk" ]; then
      info "Updating settings.json to use local install..."
      if command -v sed &> /dev/null; then
        sed -i.bak 's/bunx claude-code-sdk hooks/bun node_modules\/claude-code-sdk\/bin\/hooks.ts/g' .claude/settings.json
        rm -f .claude/settings.json.bak
        success "Updated to use local claude-code-sdk"
      fi
    fi
  else
    info "No package.json found - hooks will use bunx (slower first run)"
  fi

  # Add to .gitignore if needed
  if [ -f ".gitignore" ]; then
    if ! grep -q "\.claude/settings\.local\.json" .gitignore 2>/dev/null; then
      echo "" >> .gitignore
      echo "# Claude Code local settings" >> .gitignore
      echo ".claude/settings.local.json" >> .gitignore
      success "Updated .gitignore"
    fi
  fi

  echo ""
  echo -e "${GREEN}Installation complete!${NC}"
  echo ""
  echo "Files created:"
  echo "  - hooks.yaml              - Handler configuration"
  echo "  - .claude/settings.json   - Hook registrations"
  echo ""
  echo "Enabled handlers:"
  echo "  - session-naming     : Human-friendly session names"
  echo "  - turn-tracker       : Track turns within sessions"
  echo "  - context-injection  : Inject session context"
  echo "  - event-logger       : Log events for indexing"
  echo ""
  echo "Next steps:"
  echo "  1. Start Claude Code in this directory"
  echo "  2. Your session will be named automatically"
  echo "  3. Edit hooks.yaml to customize handlers"
  echo ""
}

main "$@"
