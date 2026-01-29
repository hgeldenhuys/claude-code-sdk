#!/usr/bin/env bash
#
# Tapestry COMMS Agent Installer
#
# One-liner install:
#   curl -sL https://raw.githubusercontent.com/YOUR_ORG/claude-code-sdk/main/scripts/install-comms-agent.sh | bash
#
# Or with gh CLI (private repo):
#   gh api repos/YOUR_ORG/claude-code-sdk/contents/scripts/install-comms-agent.sh -H "Accept: application/vnd.github.raw" | bash
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
NC='\033[0m' # No Color

# Banner
echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║   ████████╗ █████╗ ██████╗ ███████╗███████╗████████╗██████╗ ██╗   ██╗ ║"
echo "║   ╚══██╔══╝██╔══██╗██╔══██╗██╔════╝██╔════╝╚══██╔══╝██╔══██╗╚██╗ ██╔╝ ║"
echo "║      ██║   ███████║██████╔╝█████╗  ███████╗   ██║   ██████╔╝ ╚████╔╝  ║"
echo "║      ██║   ██╔══██║██╔═══╝ ██╔══╝  ╚════██║   ██║   ██╔══██╗  ╚██╔╝   ║"
echo "║      ██║   ██║  ██║██║     ███████╗███████║   ██║   ██║  ██║   ██║    ║"
echo "║      ╚═╝   ╚═╝  ╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝    ║"
echo "║                                                              ║"
echo "║              COMMS Agent Installer v1.0.0                    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ============================================================================
# Configuration
# ============================================================================

REPO_OWNER="${REPO_OWNER:-hgeldenhuys}"
REPO_NAME="${REPO_NAME:-claude-code-sdk}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/tapestry-comms}"
ENV_FILE="$INSTALL_DIR/.env.tapestry"

# ============================================================================
# Functions
# ============================================================================

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

prompt_var() {
    local var_name="$1"
    local prompt_text="$2"
    local default_val="$3"
    local current_val="${!var_name}"

    if [[ -n "$current_val" ]]; then
        echo -e "${GREEN}✓${NC} $var_name already set"
        return
    fi

    if [[ -n "$default_val" ]]; then
        read -p "  $prompt_text [$default_val]: " input_val
        eval "$var_name=\"${input_val:-$default_val}\""
    else
        read -p "  $prompt_text: " input_val
        eval "$var_name=\"$input_val\""
    fi
}

check_command() {
    if ! command -v "$1" &> /dev/null; then
        return 1
    fi
    return 0
}

# ============================================================================
# Prerequisites Check
# ============================================================================

echo ""
log_info "Checking prerequisites..."

# Check for bun
if ! check_command bun; then
    log_warn "Bun not found. Installing..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    if ! check_command bun; then
        log_error "Failed to install Bun. Please install manually: https://bun.sh"
        exit 1
    fi
fi
log_success "Bun $(bun --version)"

# Check for gh CLI
if ! check_command gh; then
    log_error "GitHub CLI (gh) not found. Please install: https://cli.github.com"
    exit 1
fi
log_success "GitHub CLI $(gh --version | head -1)"

# Check gh auth
if ! gh auth status &> /dev/null; then
    log_warn "Not authenticated with GitHub. Running 'gh auth login'..."
    gh auth login
fi
log_success "GitHub authenticated"

# ============================================================================
# Load existing env or prompt
# ============================================================================

echo ""
log_info "Configuring environment..."

# Load existing .env.tapestry if present
if [[ -f "$ENV_FILE" ]]; then
    log_info "Found existing $ENV_FILE, loading..."
    source "$ENV_FILE" 2>/dev/null || true
fi

# Also check current directory
if [[ -f ".env.tapestry" ]]; then
    log_info "Found .env.tapestry in current directory, loading..."
    source ".env.tapestry" 2>/dev/null || true
fi

# Prompt for missing variables
echo ""
echo -e "${CYAN}SignalDB Configuration${NC}"
echo "Get your keys from: https://signaldb.live"
echo ""

prompt_var "TAPESTRY_TEST_API_URL" "API URL" "https://api.signaldb.live"
prompt_var "TAPESTRY_TEST_PROJECT_KEY" "Project Key (sk_live_...)" ""
prompt_var "TAPESTRY_MACHINE_ID" "Machine ID" "$(hostname)"

# Validate project key format
if [[ ! "$TAPESTRY_TEST_PROJECT_KEY" =~ ^sk_(live|test)_ ]]; then
    log_error "Invalid project key format. Must start with sk_live_ or sk_test_"
    exit 1
fi

# ============================================================================
# Clone/Update Repository
# ============================================================================

echo ""
log_info "Setting up claude-code-sdk..."

if [[ -d "$INSTALL_DIR" ]]; then
    log_info "Directory exists, pulling latest..."
    cd "$INSTALL_DIR"
    git pull origin main 2>/dev/null || log_warn "Could not pull, using existing"
else
    log_info "Cloning repository via gh..."
    gh repo clone "$REPO_OWNER/$REPO_NAME" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

log_success "Repository ready at $INSTALL_DIR"

# ============================================================================
# Install Dependencies
# ============================================================================

echo ""
log_info "Installing dependencies..."
bun install --silent
log_success "Dependencies installed"

# ============================================================================
# Write Environment File
# ============================================================================

echo ""
log_info "Writing environment configuration..."

cat > "$ENV_FILE" << EOF
# =============================================================================
# Tapestry SignalDB Configuration
# =============================================================================
# Generated by install-comms-agent.sh on $(date)

# Test Environment (UAT/CI)
TAPESTRY_TEST_API_URL=$TAPESTRY_TEST_API_URL
TAPESTRY_TEST_PROJECT_KEY=$TAPESTRY_TEST_PROJECT_KEY

# Machine Identity
TAPESTRY_MACHINE_ID=$TAPESTRY_MACHINE_ID

# Feature Flags
TAPESTRY_SSE_ENABLED=true
TAPESTRY_HEARTBEAT_INTERVAL_MS=10000
EOF

log_success "Configuration saved to $ENV_FILE"

# ============================================================================
# Test Connection
# ============================================================================

echo ""
log_info "Testing SignalDB connection..."

# Simple health check - list agents
TEST_RESULT=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $TAPESTRY_TEST_PROJECT_KEY" \
    "$TAPESTRY_TEST_API_URL/v1/agents?limit=1" 2>/dev/null || echo "000")

if [[ "$TEST_RESULT" == "200" ]]; then
    log_success "SignalDB connection successful!"
elif [[ "$TEST_RESULT" == "401" ]] || [[ "$TEST_RESULT" == "403" ]]; then
    log_error "Authentication failed. Check your project key."
    exit 1
elif [[ "$TEST_RESULT" == "000" ]]; then
    log_error "Could not connect to $TAPESTRY_TEST_API_URL"
    exit 1
else
    log_warn "Unexpected response: HTTP $TEST_RESULT (may be OK for empty project)"
fi

# ============================================================================
# PM2 Setup
# ============================================================================

echo ""
log_info "Setting up pm2 process management..."

# Check for pm2
if ! check_command pm2; then
    log_warn "pm2 not found. Installing globally..."
    npm install -g pm2 2>/dev/null || sudo npm install -g pm2
    if ! check_command pm2; then
        log_error "Failed to install pm2. Install manually: npm install -g pm2"
        exit 1
    fi
fi
log_success "pm2 $(pm2 --version)"

# Stop existing daemon if running
pm2 stop comms-daemon 2>/dev/null || true
pm2 delete comms-daemon 2>/dev/null || true

# Start daemon with pm2 using ecosystem config
log_info "Starting COMMS daemon with pm2..."
cd "$INSTALL_DIR"
pm2 start ecosystem.config.cjs
pm2 save

log_success "COMMS daemon running via pm2"

# Offer pm2 startup
echo ""
echo -e "${YELLOW}Optional: Enable pm2 startup on boot?${NC}"
read -p "  Run 'pm2 startup'? [y/N]: " setup_startup
if [[ "$setup_startup" =~ ^[Yy]$ ]]; then
    pm2 startup
    pm2 save
    log_success "pm2 startup configured"
else
    log_info "Skipped pm2 startup. Run 'pm2 startup' later to enable."
fi

# ============================================================================
# Summary
# ============================================================================

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Installation Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Location:    $INSTALL_DIR"
echo "  Machine ID:  $TAPESTRY_MACHINE_ID"
echo "  API URL:     $TAPESTRY_TEST_API_URL"
echo ""
echo -e "  ${CYAN}Manage the daemon:${NC}"
echo ""
echo "    pm2 status comms-daemon      # Check status"
echo "    pm2 logs comms-daemon        # View logs"
echo "    pm2 restart comms-daemon     # Restart"
echo "    pm2 stop comms-daemon        # Stop"
echo ""
echo -e "  ${CYAN}Monitor:${NC}"
echo ""
echo "    cd $INSTALL_DIR && bun run comms-dashboard   # Terminal dashboard"
echo ""
echo -e "  ${CYAN}Health check:${NC}"
echo ""
echo "    $INSTALL_DIR/scripts/comms-doctor.sh          # Run diagnostics"
echo ""
echo -e "${CYAN}  The daemon will automatically discover active Claude Code sessions${NC}"
echo -e "${CYAN}  and register them with SignalDB for cross-machine communication.${NC}"
echo ""
