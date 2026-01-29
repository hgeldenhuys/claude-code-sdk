#!/usr/bin/env bash
#
# Tapestry COMMS Agent Installer
#
# One-liner install (private repo, requires gh CLI):
#   gh api repos/hgeldenhuys/claude-code-sdk/contents/scripts/install-comms-agent.sh -H "Accept: application/vnd.github.raw" | bash
#
# Or with curl (public repo):
#   curl -sL https://raw.githubusercontent.com/hgeldenhuys/claude-code-sdk/main/scripts/install-comms-agent.sh | bash
#
# Options (pass as env vars):
#   TAPESTRY_MACHINE_ID=mac-studio     Machine identifier
#   TAPESTRY_ENV=live                  Environment (dev/test/live)
#   INSTALL_DIR=~/tapestry-comms       Install location
#
# Examples:
#   # Interactive (prompts for everything)
#   gh api repos/hgeldenhuys/claude-code-sdk/contents/scripts/install-comms-agent.sh -H "Accept: application/vnd.github.raw" | bash
#
#   # Non-interactive (pre-set machine ID)
#   TAPESTRY_MACHINE_ID=mac-studio gh api repos/hgeldenhuys/claude-code-sdk/contents/scripts/install-comms-agent.sh -H "Accept: application/vnd.github.raw" | bash
#
# Prerequisites:
#   - Bun installed (curl -fsSL https://bun.sh/install | bash)
#   - gh CLI authenticated (gh auth login)
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

# Banner
echo -e "${CYAN}"
cat << 'BANNER'
  _____                     _
 |_   _|_ _ _ __   ___  ___| |_ _ __ _   _
   | |/ _` | '_ \ / _ \/ __| __| '__| | | |
   | | (_| | |_) |  __/\__ \ |_| |  | |_| |
   |_|\__,_| .__/ \___||___/\__|_|   \__, |
            |_|    COMMS Agent        |___/
BANNER
echo -e "${NC}"

# ============================================================================
# Configuration
# ============================================================================

REPO_OWNER="${REPO_OWNER:-hgeldenhuys}"
REPO_NAME="${REPO_NAME:-claude-code-sdk}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/tapestry-comms}"
ENV_FILE="$INSTALL_DIR/.env.tapestry"

# Default API URL (same for all environments)
DEFAULT_API_URL="https://api.signaldb.live"

# Known project keys (hardcoded for convenience -- these are project-scoped, not secrets)
KNOWN_LIVE_KEY="sk_live_7aDMCEzvC7OXoq3WAg_S6pmPekj_9IZc"
KNOWN_TEST_KEY="sk_live_ENnkiL9GWvDbi92-5qz_R0kQGyv_D5km"
KNOWN_DEV_KEY="sk_live_TNdWcF8016x2yIk_-Km46r_UrjAHWlK7"

# ============================================================================
# Functions
# ============================================================================

log_info() { echo -e "${BLUE}--${NC} $1"; }
log_ok()   { echo -e "${GREEN}ok${NC} $1"; }
log_warn() { echo -e "${YELLOW}!!${NC} $1"; }
log_err()  { echo -e "${RED}xx${NC} $1"; }

prompt_var() {
    local var_name="$1"
    local prompt_text="$2"
    local default_val="$3"
    local current_val="${!var_name}"

    if [[ -n "$current_val" ]]; then
        echo -e "${GREEN}ok${NC} $var_name = $current_val"
        return
    fi

    if [[ -n "$default_val" ]]; then
        read -p "   $prompt_text [$default_val]: " input_val
        eval "$var_name=\"${input_val:-$default_val}\""
    else
        read -p "   $prompt_text: " input_val
        eval "$var_name=\"$input_val\""
    fi
}

check_cmd() { command -v "$1" &> /dev/null; }

# ============================================================================
# Step 1: Prerequisites
# ============================================================================

echo ""
log_info "Checking prerequisites..."

# Bun
if ! check_cmd bun; then
    log_warn "Bun not found. Installing..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    if ! check_cmd bun; then
        log_err "Failed to install Bun. Install manually: https://bun.sh"
        exit 1
    fi
fi
log_ok "bun $(bun --version)"

# gh CLI
if ! check_cmd gh; then
    log_err "GitHub CLI (gh) not found. Install: https://cli.github.com"
    exit 1
fi
log_ok "gh $(gh --version 2>&1 | head -1 | awk '{print $3}')"

# gh auth
if ! gh auth status &> /dev/null 2>&1; then
    log_warn "Not authenticated with GitHub."
    gh auth login
fi
log_ok "gh authenticated"

# ============================================================================
# Step 2: Configuration
# ============================================================================

echo ""
log_info "Configuration"

# Load existing config if upgrading
if [[ -f "$ENV_FILE" ]]; then
    log_info "Loading existing $ENV_FILE"
    set -a; source "$ENV_FILE" 2>/dev/null || true; set +a
fi

# Machine ID
prompt_var "TAPESTRY_MACHINE_ID" "Machine ID (unique name for this computer)" "$(hostname -s)"

# Environment selection
if [[ -z "$TAPESTRY_ENV" ]]; then
    echo ""
    echo "   Environments:"
    echo -e "     ${CYAN}1${NC}) live  ${DIM}-- production (recommended)${NC}"
    echo -e "     ${CYAN}2${NC}) test  ${DIM}-- UAT / CI${NC}"
    echo -e "     ${CYAN}3${NC}) dev   ${DIM}-- throwaway data${NC}"
    read -p "   Which environment? [1]: " env_choice
    case "${env_choice:-1}" in
        1|live)  TAPESTRY_ENV="live" ;;
        2|test)  TAPESTRY_ENV="test" ;;
        3|dev)   TAPESTRY_ENV="dev" ;;
        *)       TAPESTRY_ENV="live" ;;
    esac
fi
log_ok "Environment: $TAPESTRY_ENV"

# Set keys based on environment
ENV_UPPER=$(echo "$TAPESTRY_ENV" | tr '[:lower:]' '[:upper:]')
API_VAR="TAPESTRY_${ENV_UPPER}_API_URL"
KEY_VAR="TAPESTRY_${ENV_UPPER}_PROJECT_KEY"

# Default known keys
case "$TAPESTRY_ENV" in
    live) DEFAULT_KEY="$KNOWN_LIVE_KEY" ;;
    test) DEFAULT_KEY="$KNOWN_TEST_KEY" ;;
    dev)  DEFAULT_KEY="$KNOWN_DEV_KEY" ;;
esac

eval "${API_VAR}=\${${API_VAR}:-$DEFAULT_API_URL}"
eval "${KEY_VAR}=\${${KEY_VAR}:-$DEFAULT_KEY}"

RESOLVED_API="${!API_VAR}"
RESOLVED_KEY="${!KEY_VAR}"

log_ok "API: $RESOLVED_API"
log_ok "Key: ${RESOLVED_KEY:0:12}..."

# ============================================================================
# Step 3: Clone / Update
# ============================================================================

echo ""
log_info "Setting up repository..."

if [[ -d "$INSTALL_DIR/.git" ]]; then
    log_info "Existing install found, pulling latest..."
    cd "$INSTALL_DIR"
    git pull origin main 2>/dev/null || log_warn "Pull failed, using existing"
else
    if [[ -d "$INSTALL_DIR" ]]; then
        log_warn "$INSTALL_DIR exists but isn't a git repo. Removing and re-cloning."
        rm -rf "$INSTALL_DIR"
    fi
    gh repo clone "$REPO_OWNER/$REPO_NAME" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi
log_ok "Repo at $INSTALL_DIR"

# ============================================================================
# Step 4: Dependencies
# ============================================================================

echo ""
log_info "Installing dependencies..."
cd "$INSTALL_DIR"
bun install --silent 2>/dev/null || bun install
log_ok "Dependencies installed"

# ============================================================================
# Step 5: Write .env.tapestry
# ============================================================================

echo ""
log_info "Writing configuration..."

cat > "$ENV_FILE" << EOF
# Tapestry COMMS Configuration
# Generated by install-comms-agent.sh on $(date -Iseconds)

# Active environment
TAPESTRY_ENV=$TAPESTRY_ENV

# Machine identity
TAPESTRY_MACHINE_ID=$TAPESTRY_MACHINE_ID

# Dev
TAPESTRY_DEV_API_URL=$DEFAULT_API_URL
TAPESTRY_DEV_PROJECT_KEY=$KNOWN_DEV_KEY

# Test
TAPESTRY_TEST_API_URL=$DEFAULT_API_URL
TAPESTRY_TEST_PROJECT_KEY=$KNOWN_TEST_KEY

# Live
TAPESTRY_LIVE_API_URL=$DEFAULT_API_URL
TAPESTRY_LIVE_PROJECT_KEY=$KNOWN_LIVE_KEY

# Features
TAPESTRY_SSE_ENABLED=true
TAPESTRY_HEARTBEAT_INTERVAL_MS=10000
EOF

log_ok "Config saved to $ENV_FILE"

# ============================================================================
# Step 6: CLI setup
# ============================================================================

echo ""
log_info "Setting up CLI..."

# Ensure wrapper is executable
chmod +x "$INSTALL_DIR/.claude/bin/comms" 2>/dev/null || true

# Create logs directory
mkdir -p "$INSTALL_DIR/logs"

log_ok "CLI ready"

# ============================================================================
# Step 7: Test connection
# ============================================================================

echo ""
log_info "Testing SignalDB connection..."

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $RESOLVED_KEY" \
    "$RESOLVED_API/v1/agents?limit=1" 2>/dev/null || echo "000")

case "$HTTP_CODE" in
    200) log_ok "Connection successful" ;;
    401|403) log_err "Auth failed. Check your project key."; exit 1 ;;
    000) log_err "Cannot reach $RESOLVED_API"; exit 1 ;;
    *) log_warn "HTTP $HTTP_CODE (may be fine for empty project)" ;;
esac

# ============================================================================
# Step 8: Daemon setup
# ============================================================================

echo ""
log_info "Setting up daemon..."

if ! check_cmd pm2; then
    log_info "Installing pm2..."
    bun install -g pm2 2>/dev/null || npm install -g pm2 2>/dev/null || {
        log_warn "Could not install pm2. You can run the daemon manually:"
        echo "   cd $INSTALL_DIR && bun bin/agent-daemon.ts --env $TAPESTRY_ENV"
    }
fi

if check_cmd pm2; then
    # Stop existing if running
    pm2 stop comms-daemon 2>/dev/null || true
    pm2 delete comms-daemon 2>/dev/null || true

    cd "$INSTALL_DIR"
    pm2 start ecosystem.config.cjs
    pm2 save

    log_ok "Daemon running via pm2"

    echo ""
    read -p "   Enable pm2 auto-start on boot? [y/N]: " do_startup
    if [[ "$do_startup" =~ ^[Yy]$ ]]; then
        pm2 startup
        pm2 save
        log_ok "Auto-start configured"
    fi
fi

# ============================================================================
# Done
# ============================================================================

echo ""
echo -e "${GREEN}────────────────────────────────────────────────${NC}"
echo -e "${GREEN}  COMMS Agent installed${NC}"
echo -e "${GREEN}────────────────────────────────────────────────${NC}"
echo ""
echo "  Machine:   $TAPESTRY_MACHINE_ID"
echo "  Env:       $TAPESTRY_ENV"
echo "  Location:  $INSTALL_DIR"
echo ""
echo -e "  ${CYAN}Commands:${NC}"
echo ""
echo "    $INSTALL_DIR/.claude/bin/comms agents     # Who's online"
echo "    $INSTALL_DIR/.claude/bin/comms chat <name> \"msg\"  # Chat"
echo "    $INSTALL_DIR/.claude/bin/comms spawn . \"task\"     # Spawn"
echo ""
echo -e "  ${CYAN}Daemon:${NC}"
echo ""
echo "    pm2 logs comms-daemon       # View logs"
echo "    pm2 restart comms-daemon    # Restart"
echo "    pm2 stop comms-daemon       # Stop"
echo ""
echo -e "  ${DIM}Tip: Add to PATH for easy access:${NC}"
echo -e "  ${DIM}echo 'export PATH=\"$INSTALL_DIR/.claude/bin:\$PATH\"' >> ~/.zshrc${NC}"
echo ""
