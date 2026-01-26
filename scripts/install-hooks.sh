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
  parallelExecution: false
  defaultTimeoutMs: 30000
  defaultErrorStrategy: continue

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

  # Clone or update claude-code-sdk in .claude/
  REPO_URL="https://github.com/hgeldenhuys/claude-code-sdk.git"
  SDK_DIR=".claude/claude-code-sdk"

  if [ -d "$SDK_DIR/.git" ]; then
    info "Updating claude-code-sdk..."
    # Use fetch+reset for reliable shallow clone updates
    if (cd "$SDK_DIR" && git fetch --depth 1 origin main 2>/dev/null && git reset --hard origin/main 2>/dev/null); then
      success "SDK updated"
    else
      warn "Update failed, re-cloning..."
      rm -rf "$SDK_DIR"
      git clone --depth 1 --quiet "$REPO_URL" "$SDK_DIR" || error "Failed to clone SDK"
      success "SDK re-cloned"
    fi
  else
    # Directory exists but not a git repo, or doesn't exist - clean slate
    if [ -d "$SDK_DIR" ]; then
      warn "SDK directory exists but is not a git repo, removing..."
      rm -rf "$SDK_DIR"
    fi
    info "Cloning claude-code-sdk..."
    git clone --depth 1 --quiet "$REPO_URL" "$SDK_DIR" || error "Failed to clone SDK"
    success "SDK cloned"
  fi

  # Install SDK dependencies
  info "Installing SDK dependencies..."
  (cd "$SDK_DIR" && bun install --silent 2>/dev/null) || warn "Could not install dependencies"

  # Build Rust CLIs (transcript + hook-events)
  if command -v cargo &> /dev/null; then
    info "Building Rust CLIs..."
    if (cd "$SDK_DIR/transcript-tui-rs" && cargo build --release -p transcript-cli -p hook-events-cli 2>/dev/null); then
      success "Rust CLIs built (transcript, hook-events)"
    else
      warn "Rust CLI build failed - some commands may be unavailable"
    fi
  else
    warn "Rust toolchain not found - Rust CLIs will not be available"
    warn "Install Rust: https://rustup.rs/"
  fi

  # Create .claude/settings.json with local SDK path
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
            "command": "bun \"$CLAUDE_PROJECT_DIR\"/.claude/claude-code-sdk/bin/hooks.ts --config \"$CLAUDE_PROJECT_DIR\"/hooks.yaml"
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
            "command": "bun \"$CLAUDE_PROJECT_DIR\"/.claude/claude-code-sdk/bin/hooks.ts --config \"$CLAUDE_PROJECT_DIR\"/hooks.yaml"
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
            "command": "bun \"$CLAUDE_PROJECT_DIR\"/.claude/claude-code-sdk/bin/hooks.ts --config \"$CLAUDE_PROJECT_DIR\"/hooks.yaml"
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
            "command": "bun \"$CLAUDE_PROJECT_DIR\"/.claude/claude-code-sdk/bin/hooks.ts --config \"$CLAUDE_PROJECT_DIR\"/hooks.yaml"
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
            "command": "bun \"$CLAUDE_PROJECT_DIR\"/.claude/claude-code-sdk/bin/hooks.ts --config \"$CLAUDE_PROJECT_DIR\"/hooks.yaml"
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
            "command": "bun \"$CLAUDE_PROJECT_DIR\"/.claude/claude-code-sdk/bin/hooks.ts --config \"$CLAUDE_PROJECT_DIR\"/hooks.yaml"
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
            "command": "bun \"$CLAUDE_PROJECT_DIR\"/.claude/claude-code-sdk/bin/hooks.ts --config \"$CLAUDE_PROJECT_DIR\"/hooks.yaml"
          }
        ]
      }
    ]
  }
}
SETTINGS_JSON
  success "Created .claude/settings.json"

  # Add to .gitignore if needed
  if [ -f ".gitignore" ]; then
    if ! grep -q "\.claude/claude-code-sdk" .gitignore 2>/dev/null; then
      echo "" >> .gitignore
      echo "# Claude Code hooks SDK and local settings" >> .gitignore
      echo ".claude/claude-code-sdk/" >> .gitignore
      echo ".claude/bin/" >> .gitignore
      echo ".claude/settings.local.json" >> .gitignore
      success "Updated .gitignore"
    fi
  fi

  # Create CLI wrapper scripts
  info "Creating CLI wrapper scripts..."
  mkdir -p .claude/bin

  # TypeScript CLIs (Bun-only)
  for cli in sesh hook-events-tui hooks; do
    cat > ".claude/bin/$cli" << EOF
#!/usr/bin/env bash
exec bun "\$(dirname "\$0")/../claude-code-sdk/bin/${cli}.ts" "\$@"
EOF
    chmod +x ".claude/bin/$cli"
  done

  # Rust CLIs (transcript + hook-events)
  local rust_created=0
  for cli_pair in "transcript:transcript" "hook-events:hook-events"; do
    local cli_name="${cli_pair%%:*}"
    local bin_name="${cli_pair##*:}"
    local bin_path="$SDK_DIR/transcript-tui-rs/target/release/$bin_name"
    if [ -f "$bin_path" ]; then
      cat > ".claude/bin/$cli_name" << EOF
#!/usr/bin/env bash
exec "\$(dirname "\$0")/../claude-code-sdk/transcript-tui-rs/target/release/$bin_name" "\$@"
EOF
      chmod +x ".claude/bin/$cli_name"
      ((rust_created++))
    fi
  done

  if [ "$rust_created" -gt 0 ]; then
    success "Created CLI wrappers in .claude/bin/ ($rust_created Rust, others=Bun)"
  else
    warn "Rust binaries not found - Rust wrappers not created"
    success "Created CLI wrappers in .claude/bin/ (Bun CLIs only)"
  fi

  # Symlink individual skills (preserves project-specific skills)
  info "Linking SDK skills..."
  mkdir -p .claude/skills
  local linked=0
  local skipped=0
  for skill_dir in .claude/claude-code-sdk/skills/*/; do
    skill_name=$(basename "$skill_dir")
    target=".claude/skills/$skill_name"
    if [ -e "$target" ] || [ -L "$target" ]; then
      ((skipped++))
    else
      ln -sf "../claude-code-sdk/skills/$skill_name" "$target"
      ((linked++))
    fi
  done
  success "Linked $linked SDK skills ($skipped already exist)"

  # Manage transcript index
  if [ -x ".claude/bin/transcript" ]; then
    info "Setting up transcript index..."
    local db_path="$HOME/.claude-code-sdk/transcripts.db"

    if [ -f "$db_path" ]; then
      # Database exists - do a delta update
      info "Updating transcript index..."
      .claude/bin/transcript index update 2>/dev/null || {
        warn "Index update failed, rebuilding..."
        .claude/bin/transcript index rebuild 2>/dev/null || {
          warn "Rebuild failed, doing fresh build..."
          rm -f "$db_path" "$db_path-shm" "$db_path-wal"
          .claude/bin/transcript index build
        }
      }
      success "Transcript index updated"
    else
      # First time - build index
      info "Building transcript index (first time)..."
      .claude/bin/transcript index build
      success "Transcript index ready"
    fi

    # Show index status
    .claude/bin/transcript --minimal index status 2>/dev/null || true
  else
    warn "Transcript CLI not available - skipping index setup"
  fi

  # Create external adapters directory
  info "Setting up external adapters directory..."
  local adapters_dir="$HOME/.claude-code-sdk/adapters"
  mkdir -p "$adapters_dir"
  success "Created $adapters_dir"

  echo ""
  echo -e "${GREEN}Installation complete!${NC}"
  echo ""
  echo "Files created:"
  echo "  - hooks.yaml                  - Handler configuration"
  echo "  - .claude/settings.json       - Hook registrations"
  echo "  - .claude/claude-code-sdk/    - SDK (cloned from GitHub)"
  echo "  - .claude/bin/                - CLI wrapper scripts"
  echo "  - .claude/skills/             - Skills (SDK skills symlinked)"
  echo "  - ~/.claude-code-sdk/         - Transcript index and daemon"
  echo "  - ~/.claude-code-sdk/adapters/ - External adapter plugins"
  echo ""
  echo "Enabled handlers:"
  echo "  - session-naming     : Human-friendly session names"
  echo "  - turn-tracker       : Track turns within sessions"
  echo "  - context-injection  : Inject session context"
  echo "  - event-logger       : Log events for indexing"
  echo ""
  echo "Available CLIs (run from project root):"
  echo "  .claude/bin/hooks           - Hook framework (doctor, init, inspect)"
  echo "  .claude/bin/sesh            - Session name manager"
  echo "  .claude/bin/transcript      - Transcript CLI (Rust - search/view/index/recall)"
  echo "  .claude/bin/hook-events     - Hook event logs"
  echo ""
  echo "Available skills (use /skill-name in Claude):"
  echo "  /recall                     - Search past sessions for context"
  echo "  /transcript-intelligence    - Deep transcript analysis"
  echo "  /creating-hooks             - Guide for building hooks"
  echo "  /writing-skills             - Guide for creating skills"
  echo "  (30+ more skills available)"
  echo ""
  echo "Or add to PATH:"
  echo "  export PATH=\"\$PWD/.claude/bin:\$PATH\""
  echo ""
  echo "Verify installation:"
  echo "  .claude/bin/hooks doctor"
  echo ""
  echo "Next steps:"
  echo "  1. Start Claude Code in this directory"
  echo "  2. Your session will be named automatically"
  echo "  3. Edit hooks.yaml to customize handlers"
  echo ""
  echo "To update the SDK later:"
  echo "  cd .claude/claude-code-sdk && git pull && bun install"
  echo "  cd transcript-tui-rs && cargo build --release -p transcript-cli"
  echo ""
}

main "$@"
