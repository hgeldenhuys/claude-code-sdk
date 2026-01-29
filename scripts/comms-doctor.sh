#!/usr/bin/env bash
#
# COMMS Doctor - Post-install health check
#
# Validates that the COMMS daemon is properly configured and running.
#
# Usage:
#   scripts/comms-doctor.sh
#   scripts/comms-doctor.sh --fix   # Attempt to fix issues
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env.tapestry"
FIX_MODE=false
ISSUES=0
WARNINGS=0

if [[ "$1" == "--fix" ]]; then
    FIX_MODE=true
fi

echo ""
echo -e "${BLUE}COMMS Doctor - Health Check${NC}"
echo "═══════════════════════════════════════════"
echo ""

# ============================================================================
# Check: Bun installed
# ============================================================================

check_pass() {
    echo -e "  ${GREEN}PASS${NC}  $1"
}

check_fail() {
    echo -e "  ${RED}FAIL${NC}  $1"
    ISSUES=$((ISSUES + 1))
}

check_warn() {
    echo -e "  ${YELLOW}WARN${NC}  $1"
    WARNINGS=$((WARNINGS + 1))
}

echo -e "${BLUE}[1/7] Prerequisites${NC}"

if command -v bun &> /dev/null; then
    check_pass "Bun installed ($(bun --version))"
else
    check_fail "Bun not installed"
    if $FIX_MODE; then
        echo "       Attempting fix: curl -fsSL https://bun.sh/install | bash"
        curl -fsSL https://bun.sh/install | bash
        export PATH="$HOME/.bun/bin:$PATH"
    fi
fi

if command -v pm2 &> /dev/null; then
    check_pass "pm2 installed ($(pm2 --version))"
else
    check_fail "pm2 not installed"
    if $FIX_MODE; then
        echo "       Attempting fix: npm install -g pm2"
        npm install -g pm2
    fi
fi

if command -v claude &> /dev/null; then
    check_pass "Claude CLI installed"
else
    check_warn "Claude CLI not installed (message routing won't work)"
fi

# ============================================================================
# Check: Configuration
# ============================================================================

echo ""
echo -e "${BLUE}[2/7] Configuration${NC}"

if [[ -f "$ENV_FILE" ]]; then
    check_pass ".env.tapestry exists"
    source "$ENV_FILE" 2>/dev/null || true
else
    check_fail ".env.tapestry not found at $ENV_FILE"
fi

# Check for any configured environment
HAS_CONFIG=false
for env_prefix in TAPESTRY_DEV TAPESTRY_TEST TAPESTRY_LIVE; do
    api_url_var="${env_prefix}_API_URL"
    key_var="${env_prefix}_PROJECT_KEY"
    if [[ -n "${!api_url_var}" && -n "${!key_var}" ]]; then
        env_name=$(echo "$env_prefix" | sed 's/TAPESTRY_//' | tr '[:upper:]' '[:lower:]')
        check_pass "Environment '$env_name' configured (${!api_url_var})"
        HAS_CONFIG=true
        # Store for connectivity test
        TEST_API_URL="${!api_url_var}"
        TEST_PROJECT_KEY="${!key_var}"
    fi
done

if ! $HAS_CONFIG; then
    check_fail "No Tapestry environments configured"
fi

if [[ -n "$TAPESTRY_MACHINE_ID" ]]; then
    check_pass "Machine ID: $TAPESTRY_MACHINE_ID"
else
    check_warn "TAPESTRY_MACHINE_ID not set (will use hostname)"
fi

# ============================================================================
# Check: Project setup
# ============================================================================

echo ""
echo -e "${BLUE}[3/7] Project Setup${NC}"

if [[ -d "$PROJECT_DIR/node_modules" ]]; then
    check_pass "Dependencies installed"
else
    check_fail "Dependencies not installed"
    if $FIX_MODE; then
        echo "       Attempting fix: bun install"
        cd "$PROJECT_DIR" && bun install
    fi
fi

if [[ -f "$PROJECT_DIR/ecosystem.config.cjs" ]]; then
    check_pass "ecosystem.config.cjs exists"
else
    check_fail "ecosystem.config.cjs not found"
fi

if [[ -f "$PROJECT_DIR/bin/agent-daemon.ts" ]]; then
    check_pass "agent-daemon.ts exists"
else
    check_fail "agent-daemon.ts not found"
fi

# ============================================================================
# Check: Daemon running
# ============================================================================

echo ""
echo -e "${BLUE}[4/7] Daemon Status${NC}"

if command -v pm2 &> /dev/null; then
    DAEMON_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
for app in data:
    if app.get('name') == 'comms-daemon':
        print(app.get('pm2_env', {}).get('status', 'unknown'))
        sys.exit(0)
print('not_found')
" 2>/dev/null || echo "error")

    case "$DAEMON_STATUS" in
        online)
            check_pass "comms-daemon is online"
            ;;
        stopped)
            check_fail "comms-daemon is stopped"
            if $FIX_MODE; then
                echo "       Attempting fix: pm2 restart comms-daemon"
                pm2 restart comms-daemon
            fi
            ;;
        errored)
            check_fail "comms-daemon is in error state"
            echo "       Check logs: pm2 logs comms-daemon --lines 20"
            if $FIX_MODE; then
                echo "       Attempting fix: pm2 restart comms-daemon"
                pm2 restart comms-daemon
            fi
            ;;
        not_found)
            check_fail "comms-daemon not registered in pm2"
            if $FIX_MODE; then
                echo "       Attempting fix: pm2 start ecosystem.config.cjs"
                cd "$PROJECT_DIR" && pm2 start ecosystem.config.cjs
                pm2 save
            fi
            ;;
        *)
            check_warn "Could not determine daemon status: $DAEMON_STATUS"
            ;;
    esac
else
    check_fail "pm2 not available, cannot check daemon"
fi

# ============================================================================
# Check: SignalDB Connectivity
# ============================================================================

echo ""
echo -e "${BLUE}[5/7] SignalDB Connectivity${NC}"

if [[ -n "$TEST_API_URL" && -n "$TEST_PROJECT_KEY" ]]; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer $TEST_PROJECT_KEY" \
        "$TEST_API_URL/v1/agents?limit=1" 2>/dev/null || echo "000")

    case "$HTTP_CODE" in
        200)
            check_pass "API reachable ($TEST_API_URL) - HTTP 200"
            ;;
        401|403)
            check_fail "Authentication failed (HTTP $HTTP_CODE) - check project key"
            ;;
        000)
            check_fail "Cannot connect to $TEST_API_URL"
            ;;
        *)
            check_warn "Unexpected HTTP $HTTP_CODE from $TEST_API_URL"
            ;;
    esac
else
    check_warn "No API URL configured, skipping connectivity test"
fi

# ============================================================================
# Check: Registered Agents
# ============================================================================

echo ""
echo -e "${BLUE}[6/7] Registered Agents${NC}"

if [[ -n "$TEST_API_URL" && -n "$TEST_PROJECT_KEY" ]]; then
    AGENT_COUNT=$(curl -s \
        -H "Authorization: Bearer $TEST_PROJECT_KEY" \
        "$TEST_API_URL/v1/agents" 2>/dev/null | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    agents = data.get('data', [])
    print(len(agents))
except:
    print('error')
" 2>/dev/null || echo "error")

    if [[ "$AGENT_COUNT" == "error" ]]; then
        check_warn "Could not query agents"
    elif [[ "$AGENT_COUNT" == "0" ]]; then
        check_warn "No agents registered (daemon may need active Claude sessions)"
    else
        check_pass "$AGENT_COUNT agent(s) registered"

        # Show machine breakdown
        MACHINE_IDS=$(curl -s \
            -H "Authorization: Bearer $TEST_PROJECT_KEY" \
            "$TEST_API_URL/v1/agents" 2>/dev/null | python3 -c "
import json, sys
from collections import Counter
data = json.load(sys.stdin)
machines = Counter(a.get('machine_id', 'unknown') for a in data.get('data', []))
for m, c in machines.most_common():
    print(f'         {m}: {c} agent(s)')
" 2>/dev/null || true)
        echo "$MACHINE_IDS"
    fi
else
    check_warn "No API URL configured, skipping agent check"
fi

# ============================================================================
# Check: Logs
# ============================================================================

echo ""
echo -e "${BLUE}[7/7] Recent Logs${NC}"

if command -v pm2 &> /dev/null && [[ "$DAEMON_STATUS" != "not_found" ]]; then
    ERROR_COUNT=$(pm2 logs comms-daemon --lines 50 --nostream 2>&1 | grep -c "Error\|FAIL\|error" || true)
    if [[ "$ERROR_COUNT" -gt 0 ]]; then
        check_warn "$ERROR_COUNT error(s) in recent logs"
        echo "       Run: pm2 logs comms-daemon --lines 20"
    else
        check_pass "No errors in recent logs"
    fi
else
    check_warn "Cannot check logs (daemon not in pm2)"
fi

# ============================================================================
# Summary
# ============================================================================

echo ""
echo "═══════════════════════════════════════════"

if [[ $ISSUES -eq 0 && $WARNINGS -eq 0 ]]; then
    echo -e "${GREEN}All checks passed!${NC}"
elif [[ $ISSUES -eq 0 ]]; then
    echo -e "${YELLOW}$WARNINGS warning(s), no critical issues${NC}"
else
    echo -e "${RED}$ISSUES issue(s), $WARNINGS warning(s)${NC}"
    if ! $FIX_MODE; then
        echo ""
        echo "  Run with --fix to attempt automatic fixes:"
        echo "  $0 --fix"
    fi
fi
echo ""
