#!/bin/bash
# Integration Test: Session Naming Survives Compaction
#
# This test verifies that our session naming hooks properly track sessions
# and that session names survive /compact operations.
#
# Output: Detailed log with all commands and their outputs

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="$SCRIPT_DIR/../results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$RESULTS_DIR/session-naming-survival_${TIMESTAMP}.log"
TEST_WORKSPACE="/tmp/session-naming-test-$$"

# Ensure results directory exists
mkdir -p "$RESULTS_DIR"

# ============================================================================
# Logging
# ============================================================================

log() {
    local msg="$1"
    echo "$msg" | tee -a "$LOG_FILE"
}

log_section() {
    local title="$1"
    log ""
    log "════════════════════════════════════════════════════════════════════"
    log "  $title"
    log "════════════════════════════════════════════════════════════════════"
    log ""
}

log_command() {
    local cmd="$1"
    log "┌─ COMMAND ─────────────────────────────────────────────────────────"
    log "│ $cmd"
    log "└───────────────────────────────────────────────────────────────────"
}

log_output() {
    local output="$1"
    log "┌─ OUTPUT ──────────────────────────────────────────────────────────"
    echo "$output" | while IFS= read -r line; do
        log "│ $line"
    done
    log "└───────────────────────────────────────────────────────────────────"
}

# ============================================================================
# VM Commands
# ============================================================================

vm_exec() {
    local cmd="$1"
    log_command "$cmd"
    local output
    output=$(limactl shell claude-sdk-test -- bash -c "$cmd" 2>&1) || true
    log_output "$output"
    echo "$output"
}

run_claude() {
    local prompt="$1"
    local workdir="${2:-$TEST_WORKSPACE}"

    log_command "claude --print \"$prompt\" (in $workdir)"

    local output
    output=$(limactl shell claude-sdk-test -- bash << VMEOF
cd "$workdir"
claude --print "$prompt" 2>&1
VMEOF
) || true

    log_output "$output"
    echo "$output"
}

run_sesh() {
    local args="$1"
    log_command "sesh $args"

    local output
    output=$(limactl shell claude-sdk-test -- bash << VMEOF
export PATH="/home/hgeldenhuys.linux/.bun/bin:\$PATH"
cd /home/hgeldenhuys.linux/claude-code-sdk
bun run bin/sesh.ts $args 2>&1
VMEOF
) || true

    log_output "$output"
    echo "$output"
}

# ============================================================================
# Test Setup
# ============================================================================

setup() {
    log_section "TEST SETUP"

    log "Creating test workspace: $TEST_WORKSPACE"
    vm_exec "mkdir -p '$TEST_WORKSPACE' && cd '$TEST_WORKSPACE' && git init -q && echo 'test' > README.md && git add . && git commit -q -m 'init'"

    log ""
    log "Verifying hook configuration:"
    vm_exec "cat ~/.claude/settings.json"

    log ""
    log "Clearing any existing session data for clean test:"
    vm_exec "rm -f ~/.claude/sessions.json 2>/dev/null || true"
}

teardown() {
    log_section "CLEANUP"
    vm_exec "rm -rf '$TEST_WORKSPACE'" 2>/dev/null || true
}

# ============================================================================
# Tests
# ============================================================================

test_hook_fires() {
    log_section "TEST 1: Session Hook Fires on Startup"

    log "Running Claude to trigger SessionStart hook..."
    local output=$(run_claude "Say 'hello' and nothing else." "$TEST_WORKSPACE")

    log ""
    log "Checking if session was tracked:"
    run_sesh "list --json"
}

test_session_naming() {
    log_section "TEST 2: Session Gets Named"

    log "Listing sessions to find the auto-generated name:"
    local sessions=$(run_sesh "list --names")

    if [[ -n "$sessions" ]] && [[ "$sessions" != "No sessions found" ]]; then
        SESSION_NAME=$(echo "$sessions" | head -1)
        log ""
        log "✓ Found session name: $SESSION_NAME"
    else
        log ""
        log "✗ No session name found"
        SESSION_NAME=""
    fi
}

test_get_session_id() {
    log_section "TEST 3: Can Get Session ID by Name"

    if [[ -z "$SESSION_NAME" ]]; then
        log "Skipping - no session name from previous test"
        return
    fi

    log "Getting session ID for: $SESSION_NAME"
    INITIAL_SESSION_ID=$(run_sesh "$SESSION_NAME")

    if [[ -n "$INITIAL_SESSION_ID" ]] && [[ "$INITIAL_SESSION_ID" != *"not found"* ]]; then
        log ""
        log "✓ Session ID: $INITIAL_SESSION_ID"
    else
        log ""
        log "✗ Could not get session ID"
        INITIAL_SESSION_ID=""
    fi
}

test_compact_survival() {
    log_section "TEST 4: Session Name Survives /compact"

    if [[ -z "$SESSION_NAME" ]] || [[ -z "$INITIAL_SESSION_ID" ]]; then
        log "Skipping - no session name or ID from previous tests"
        return
    fi

    log "Before /compact:"
    log "  Session Name: $SESSION_NAME"
    log "  Session ID: $INITIAL_SESSION_ID"

    log ""
    log "Running /compact..."
    run_claude "/compact" "$TEST_WORKSPACE"

    # Give it a moment
    sleep 2

    log ""
    log "After /compact - checking if name still resolves:"
    POST_SESSION_ID=$(run_sesh "$SESSION_NAME")

    log ""
    log "Results:"
    log "  Session Name: $SESSION_NAME"
    log "  Pre-compact ID: $INITIAL_SESSION_ID"
    log "  Post-compact ID: $POST_SESSION_ID"

    if [[ -n "$POST_SESSION_ID" ]] && [[ "$POST_SESSION_ID" != *"not found"* ]]; then
        log ""
        log "✓ Session name still resolves after /compact"

        if [[ "$INITIAL_SESSION_ID" != "$POST_SESSION_ID" ]]; then
            log "✓ Session ID changed (expected after compact)"
        else
            log "⚠ Session ID unchanged (may be expected if compact didn't create new session)"
        fi
    else
        log ""
        log "✗ Session name no longer resolves after /compact"
    fi
}

test_resume_by_name() {
    log_section "TEST 5: Can Resume Session by Name"

    if [[ -z "$SESSION_NAME" ]]; then
        log "Skipping - no session name from previous tests"
        return
    fi

    log "Getting session ID for resume:"
    local session_id=$(run_sesh "$SESSION_NAME")

    if [[ -z "$session_id" ]] || [[ "$session_id" == *"not found"* ]]; then
        log "✗ Cannot get session ID for resume"
        return
    fi

    log ""
    log "Resuming session: $session_id"
    local output=$(limactl shell claude-sdk-test -- bash << VMEOF
cd "$TEST_WORKSPACE"
claude --print --resume "$session_id" "What is 1+1? Just say the number."
VMEOF
)
    log_output "$output"

    if [[ "$output" == *"2"* ]]; then
        log ""
        log "✓ Successfully resumed and got response"
    else
        log ""
        log "⚠ Resume may not have worked as expected"
    fi
}

# ============================================================================
# Main
# ============================================================================

main() {
    # Initialize log
    echo "" > "$LOG_FILE"

    log "╔════════════════════════════════════════════════════════════════════╗"
    log "║                                                                    ║"
    log "║   Integration Test: Session Naming Survives Compaction            ║"
    log "║                                                                    ║"
    log "║   Testing our hooks SDK session tracking functionality            ║"
    log "║                                                                    ║"
    log "╚════════════════════════════════════════════════════════════════════╝"
    log ""
    log "Timestamp: $(date)"
    log "Log file: $LOG_FILE"

    # Run tests
    setup
    test_hook_fires
    test_session_naming
    test_get_session_id
    test_compact_survival
    test_resume_by_name
    teardown

    log_section "TEST COMPLETE"
    log "Full log saved to: $LOG_FILE"
    log ""

    echo ""
    echo "═══════════════════════════════════════════════════════════════════"
    echo "  Log file: $LOG_FILE"
    echo "═══════════════════════════════════════════════════════════════════"
}

# Handle cleanup on exit
trap teardown EXIT

# Run
main "$@"
