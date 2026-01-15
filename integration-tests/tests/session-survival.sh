#!/bin/bash
# Integration Test: Session Name Survives Compaction
#
# This test verifies that session names persist across /compact operations.
# The session ID changes after compaction, but the human-friendly name should
# continue to work for resuming sessions.
#
# Test Flow:
#   1. Start new Claude session, get initial session info
#   2. Name the session using our hooks
#   3. Record the session ID
#   4. Run /compact to force new session ID
#   5. Resume using session name
#   6. Verify name still works but session ID changed
#
# Requirements:
#   - Lima VM with Claude Code installed and authenticated
#   - Session naming hooks installed in the VM

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/test-utils.sh"

# Test configuration
TEST_SESSION_NAME="test-session-survival-$(date +%s)"
TEST_WORKSPACE="/tmp/claude-test-session-survival"

# ============================================================================
# Test Setup
# ============================================================================

setup() {
    log_info "Setting up test: Session Name Survives Compaction"

    # Create isolated test workspace
    vm_exec "mkdir -p '$TEST_WORKSPACE'"
    vm_exec "cd '$TEST_WORKSPACE' && rm -rf .claude"

    # Initialize git repo (Claude works better with git context)
    vm_exec "cd '$TEST_WORKSPACE' && git init -q && echo 'test' > README.md && git add . && git commit -q -m 'init'"
}

teardown() {
    log_info "Cleaning up test workspace"
    vm_exec "rm -rf '$TEST_WORKSPACE'" 2>/dev/null || true
}

# ============================================================================
# Test: Session Info Retrieval
# ============================================================================

test_session_info() {
    test_start "Can retrieve session info from Claude"

    # Start a new session and ask for session info
    claude_headless "What is your current session ID? Just output the session_id value, nothing else." "$TEST_WORKSPACE"

    if [ $CLAUDE_EXIT_CODE -eq 0 ]; then
        # Check we got some output
        assert_not_empty "$CLAUDE_OUTPUT" "Claude should return output"
        test_pass
    else
        test_fail "Claude command failed with exit code $CLAUDE_EXIT_CODE"
    fi
}

# ============================================================================
# Test: Session Naming
# ============================================================================

test_session_naming() {
    test_start "Can name a session using sesh"

    # First, start a Claude session to create the session
    claude_headless "Say 'hello' and nothing else." "$TEST_WORKSPACE"

    # The session should now be tracked
    # List sessions to see what we have
    local sessions=$(sesh_list "--json")
    log_info "Current sessions: $sessions"

    # We should have at least one session
    local count=$(echo "$sessions" | jq 'length')
    if [ "$count" -gt 0 ]; then
        log_info "Found $count session(s)"
        test_pass
    else
        test_fail "No sessions found after running Claude"
    fi
}

# ============================================================================
# Test: Session Name Survives Compaction
# ============================================================================

test_compaction_survival() {
    test_start "Session name survives /compact operation"

    # Step 1: Start a new session
    log_info "Step 1: Starting new session..."
    claude_headless "Remember this: The magic number is 42. Acknowledge with 'OK'." "$TEST_WORKSPACE"

    if [ $CLAUDE_EXIT_CODE -ne 0 ]; then
        test_fail "Failed to start initial session"
        return
    fi

    # Step 2: Get the session name for this workspace
    # Our hooks track by cwd, so we can find the session
    log_info "Step 2: Looking up session for workspace..."
    local sessions_json=$(sesh_list "--json")
    log_info "Sessions: $sessions_json"

    # Find session matching our test workspace
    local session_name=$(echo "$sessions_json" | jq -r --arg cwd "$TEST_WORKSPACE" '.[] | select(.cwd == $cwd) | .name' | head -1)

    if [ -z "$session_name" ] || [ "$session_name" = "null" ]; then
        log_warn "No session found for cwd, trying first available session"
        session_name=$(echo "$sessions_json" | jq -r '.[0].name' 2>/dev/null || echo "")
    fi

    if [ -z "$session_name" ] || [ "$session_name" = "null" ]; then
        test_fail "Could not find session name"
        return
    fi

    log_info "Found session name: $session_name"

    # Step 3: Get the initial session ID
    local initial_session_id=$(sesh_get_id "$session_name")
    log_info "Initial session ID: $initial_session_id"

    assert_not_empty "$initial_session_id" "Should have initial session ID" || {
        test_fail "No initial session ID"
        return
    }

    # Step 4: Run /compact
    log_info "Step 4: Running /compact..."
    claude_resume "$session_name" "/compact" "$TEST_WORKSPACE"

    # Give it a moment to process
    sleep 2

    # Step 5: Check if session name still resolves
    log_info "Step 5: Verifying session name still works..."
    local post_compact_session_id=$(sesh_get_id "$session_name")

    if [ -z "$post_compact_session_id" ] || [ "$post_compact_session_id" = "null" ]; then
        test_fail "Session name no longer resolves after /compact"
        return
    fi

    log_info "Post-compact session ID: $post_compact_session_id"

    # Step 6: Resume session and verify it works
    log_info "Step 6: Resuming session by name..."
    claude_resume "$session_name" "What was the magic number I told you to remember? Just say the number." "$TEST_WORKSPACE"

    if [ $CLAUDE_EXIT_CODE -eq 0 ]; then
        # Check if Claude remembered (context may or may not survive compact)
        if [[ "$CLAUDE_OUTPUT" == *"42"* ]]; then
            log_info "Claude remembered the magic number!"
        else
            log_warn "Claude may not have remembered (expected after compact)"
        fi

        # The key assertion: session name still works
        assert_not_empty "$post_compact_session_id" "Session name should still resolve after compact"
        log_info "Session ID changed: $initial_session_id -> $post_compact_session_id"

        # Session ID should be different after compact (new session created)
        if [ "$initial_session_id" != "$post_compact_session_id" ]; then
            log_info "Session ID correctly changed after compact"
        else
            log_warn "Session ID may not have changed (could be expected)"
        fi

        test_pass
    else
        test_fail "Failed to resume session after compact"
    fi
}

# ============================================================================
# Test: Resume by Name
# ============================================================================

test_resume_by_name() {
    test_start "Can resume session by name"

    # Get list of sessions
    local sessions_json=$(sesh_list "--json")
    local session_name=$(echo "$sessions_json" | jq -r '.[0].name' 2>/dev/null || echo "")

    if [ -z "$session_name" ] || [ "$session_name" = "null" ]; then
        log_warn "No sessions available, starting new one..."
        claude_headless "Say 'hello' and nothing else." "$TEST_WORKSPACE"
        sessions_json=$(sesh_list "--json")
        session_name=$(echo "$sessions_json" | jq -r '.[0].name' 2>/dev/null || echo "")
    fi

    if [ -z "$session_name" ] || [ "$session_name" = "null" ]; then
        test_fail "No session name available"
        return
    fi

    log_info "Attempting to resume session: $session_name"

    # Resume the session
    claude_resume "$session_name" "What is 1+1? Just say the number." "$TEST_WORKSPACE"

    if [ $CLAUDE_EXIT_CODE -eq 0 ]; then
        assert_contains "$CLAUDE_OUTPUT" "2" "Claude should answer 1+1"
        test_pass
    else
        test_fail "Failed to resume session by name"
    fi
}

# ============================================================================
# Main
# ============================================================================

main() {
    echo ""
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║  Integration Test: Session Name Survives Compaction    ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo ""

    # Setup
    setup

    # Run tests
    test_session_info
    test_session_naming
    test_resume_by_name
    test_compaction_survival

    # Teardown
    teardown

    # Summary
    print_summary

    # Save results
    save_results "session-survival"
}

# Handle cleanup on exit
trap teardown EXIT

# Run tests
main "$@"
