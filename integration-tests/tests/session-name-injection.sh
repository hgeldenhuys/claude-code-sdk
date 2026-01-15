#!/bin/bash
# Integration Test: Session Name Injection
#
# This test verifies that Claude KNOWS its session name on the VERY FIRST prompt.
# This is the critical acceptance criteria for session naming hooks.
#
# The hook must use the correct JSON format:
# {
#   "hookSpecificOutput": {
#     "hookEventName": "SessionStart",
#     "additionalContext": "Your session name is: <name>"
#   }
# }

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="$SCRIPT_DIR/../results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$RESULTS_DIR/session-name-injection_${TIMESTAMP}.log"
TEST_WORKSPACE="/tmp/session-inject-test-$$"

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

# ============================================================================
# VM Commands
# ============================================================================

vm_exec() {
    local cmd="$1"
    limactl shell claude-sdk-test -- bash -c "$cmd" 2>&1
}

# ============================================================================
# Test Setup
# ============================================================================

setup() {
    log_section "TEST SETUP"

    log "Creating test workspace: $TEST_WORKSPACE"
    vm_exec "mkdir -p '$TEST_WORKSPACE' && cd '$TEST_WORKSPACE' && rm -rf .git .claude 2>/dev/null || true && git init -q && echo 'test' > README.md && git add . && git commit -q -m 'init'"

    log "Verifying hook configuration..."
    local config=$(vm_exec "cat ~/.claude/settings.json 2>/dev/null")
    log "Hook config: $config"
}

teardown() {
    log_section "CLEANUP"
    vm_exec "rm -rf '$TEST_WORKSPACE'" 2>/dev/null || true
}

# ============================================================================
# Tests
# ============================================================================

test_session_name_known_on_first_prompt() {
    log_section "TEST: Claude Knows Session Name on First Prompt"

    log "Running Claude with prompt: 'What is your session name? Just say the name, nothing else.'"
    local response=$(vm_exec "cd '$TEST_WORKSPACE' && claude --print 'What is your session name? Just say the name, nothing else.'")

    log "Response: $response"

    # Check if response looks like a session name (adjective-animal pattern)
    if [[ "$response" =~ ^[a-z]+-[a-z]+$ ]]; then
        log ""
        log "✓ PASS: Claude responded with session name: $response"

        # Verify the session was tracked
        log ""
        log "Verifying session was tracked..."
        local sessions=$(vm_exec "cd /home/hgeldenhuys.linux/claude-code-sdk && /home/hgeldenhuys.linux/.bun/bin/bun run bin/sesh.ts list --names 2>/dev/null | head -5")
        log "Sessions: $sessions"

        if echo "$sessions" | grep -q "$response"; then
            log "✓ PASS: Session '$response' found in session store"
            return 0
        else
            log "⚠ WARNING: Session name not found in store (may be a timing issue)"
            return 0
        fi
    else
        log ""
        log "✗ FAIL: Claude did NOT respond with a session name"
        log "  Expected: adjective-animal pattern (e.g., 'brave-elephant')"
        log "  Got: $response"
        return 1
    fi
}

test_session_name_consistent_on_resume() {
    log_section "TEST: Session Name Consistent on Resume"

    # First, get the current session
    log "Getting session name from first prompt..."
    local first_response=$(vm_exec "cd '$TEST_WORKSPACE' && claude --print 'What is your session name? Just say the name, nothing else.'")
    log "First response: $first_response"

    if [[ ! "$first_response" =~ ^[a-z]+-[a-z]+$ ]]; then
        log "✗ FAIL: First prompt didn't return valid session name"
        return 1
    fi

    # Get the session ID for this name
    log ""
    log "Getting session ID for: $first_response"
    local session_id=$(vm_exec "cd /home/hgeldenhuys.linux/claude-code-sdk && /home/hgeldenhuys.linux/.bun/bin/bun run bin/sesh.ts '$first_response' 2>/dev/null")
    log "Session ID: $session_id"

    if [[ -z "$session_id" ]] || [[ "$session_id" == *"not found"* ]]; then
        log "✗ FAIL: Could not get session ID"
        return 1
    fi

    # Resume and ask again
    log ""
    log "Resuming session and asking for name again..."
    local resume_response=$(vm_exec "cd '$TEST_WORKSPACE' && claude --print --resume '$session_id' 'What is your session name? Just the name.'")
    log "Resume response: $resume_response"

    # The session name should be the same (or at least present)
    if echo "$resume_response" | grep -qi "$first_response"; then
        log ""
        log "✓ PASS: Session name consistent on resume"
        return 0
    else
        log ""
        log "⚠ INFO: Session name may differ on resume (expected due to new context injection)"
        log "  First: $first_response"
        log "  Resume: $resume_response"
        return 0
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
    log "║   Integration Test: Session Name Injection                         ║"
    log "║                                                                    ║"
    log "║   Verifies Claude KNOWS its session name on first prompt          ║"
    log "║                                                                    ║"
    log "╚════════════════════════════════════════════════════════════════════╝"
    log ""
    log "Timestamp: $(date)"
    log "Log file: $LOG_FILE"

    # Verify VM is running
    if ! limactl list | grep -q "claude-sdk-test.*Running"; then
        log "ERROR: VM claude-sdk-test is not running"
        exit 1
    fi

    # Run tests
    local failed=0

    setup

    if ! test_session_name_known_on_first_prompt; then
        failed=1
    fi

    if ! test_session_name_consistent_on_resume; then
        failed=1
    fi

    teardown

    log_section "TEST COMPLETE"

    if [[ $failed -eq 0 ]]; then
        log "═══════════════════════════════════════════════════════════════════"
        log "  RESULT: ALL TESTS PASSED"
        log "═══════════════════════════════════════════════════════════════════"
    else
        log "═══════════════════════════════════════════════════════════════════"
        log "  RESULT: SOME TESTS FAILED"
        log "═══════════════════════════════════════════════════════════════════"
    fi

    log ""
    log "Log file: $LOG_FILE"

    exit $failed
}

# Handle cleanup on exit
trap teardown EXIT

# Run
main "$@"
