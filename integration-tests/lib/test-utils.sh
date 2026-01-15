#!/bin/bash
# Test Utilities for Claude Code Integration Tests
#
# Provides helper functions for running Claude headless commands,
# parsing results, and asserting outcomes.

set -e

# Configuration
VM_NAME="${CLAUDE_TEST_VM:-claude-sdk-test}"
RESULTS_DIR="${RESULTS_DIR:-$(dirname "${BASH_SOURCE[0]}")/../results}"
TEST_WORKSPACE="${TEST_WORKSPACE:-/tmp/claude-test-workspace}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test state
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

# ============================================================================
# Logging
# ============================================================================

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# ============================================================================
# VM Execution
# ============================================================================

# Run a command in the Lima VM
# Usage: vm_exec "command"
vm_exec() {
    local cmd="$1"
    limactl shell "$VM_NAME" -- bash -c "$cmd"
}

# Run a command and capture both stdout and stderr
# Usage: vm_exec_capture "command" stdout_var stderr_var
vm_exec_capture() {
    local cmd="$1"
    local stdout_file=$(mktemp)
    local stderr_file=$(mktemp)

    set +e
    limactl shell "$VM_NAME" -- bash -c "$cmd" > "$stdout_file" 2> "$stderr_file"
    local exit_code=$?
    set -e

    VM_STDOUT=$(cat "$stdout_file")
    VM_STDERR=$(cat "$stderr_file")
    VM_EXIT_CODE=$exit_code

    rm -f "$stdout_file" "$stderr_file"
    return $exit_code
}

# ============================================================================
# Claude Headless Execution
# ============================================================================

# Run Claude in headless mode with JSON output
# Usage: claude_headless "prompt" [working_dir] [extra_args...]
# Sets: CLAUDE_OUTPUT (raw JSON), CLAUDE_EXIT_CODE
claude_headless() {
    local prompt="$1"
    local workdir="${2:-$TEST_WORKSPACE}"
    shift 2 || true
    local extra_args="$*"

    local cmd="cd '$workdir' && claude --print --output-format json $extra_args '$prompt'"

    log_info "Running: claude --print --output-format json $extra_args '${prompt:0:50}...'"

    set +e
    vm_exec_capture "$cmd"
    set -e

    CLAUDE_OUTPUT="$VM_STDOUT"
    CLAUDE_EXIT_CODE=$VM_EXIT_CODE

    if [ $CLAUDE_EXIT_CODE -ne 0 ]; then
        log_warn "Claude exited with code $CLAUDE_EXIT_CODE"
        log_warn "stderr: $VM_STDERR"
    fi

    return $CLAUDE_EXIT_CODE
}

# Resume a session by name
# Usage: claude_resume "session_name" "prompt" [working_dir]
claude_resume() {
    local session_name="$1"
    local prompt="$2"
    local workdir="${3:-$TEST_WORKSPACE}"

    log_info "Resuming session: $session_name"
    claude_headless "$prompt" "$workdir" "--resume \$(sesh '$session_name')"
}

# Run a slash command
# Usage: claude_slash "/command" [working_dir] [session_to_resume]
claude_slash() {
    local command="$1"
    local workdir="${2:-$TEST_WORKSPACE}"
    local resume="$3"

    local extra=""
    if [ -n "$resume" ]; then
        extra="--resume \$(sesh '$resume')"
    fi

    claude_headless "$command" "$workdir" "$extra"
}

# ============================================================================
# Output Parsing
# ============================================================================

# Extract a field from Claude's JSON output
# Usage: claude_get_field "field_path"
# Example: claude_get_field ".result" or claude_get_field ".session_id"
claude_get_field() {
    local field="$1"
    echo "$CLAUDE_OUTPUT" | jq -r "$field" 2>/dev/null || echo ""
}

# Get the session ID from the last Claude output
# Note: This depends on Claude's output format including session info
claude_get_session_id() {
    # Try to extract from structured output
    claude_get_field ".session_id" ||
    claude_get_field ".metadata.session_id" ||
    echo ""
}

# ============================================================================
# Session Management (via sesh CLI)
# ============================================================================

# Get session ID by name using sesh CLI
# Usage: sesh_get_id "session_name"
sesh_get_id() {
    local name="$1"
    vm_exec "sesh '$name'" 2>/dev/null || echo ""
}

# Get session name by ID
# Usage: sesh_get_name "session_id"
sesh_get_name() {
    local id="$1"
    vm_exec "sesh '$id'" 2>/dev/null || echo ""
}

# List all sessions
# Usage: sesh_list [--json|--names|--ids]
sesh_list() {
    local format="${1:---json}"
    vm_exec "sesh list $format" 2>/dev/null || echo "[]"
}

# Check if a session name exists
# Usage: sesh_exists "session_name"
sesh_exists() {
    local name="$1"
    local id=$(sesh_get_id "$name")
    [ -n "$id" ] && [ "$id" != "null" ]
}

# ============================================================================
# Test Framework
# ============================================================================

# Start a test
# Usage: test_start "Test description"
test_start() {
    CURRENT_TEST="$1"
    TESTS_RUN=$((TESTS_RUN + 1))
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}TEST:${NC} $CURRENT_TEST"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Mark test as passed
test_pass() {
    TESTS_PASSED=$((TESTS_PASSED + 1))
    log_pass "$CURRENT_TEST"
}

# Mark test as failed with message
# Usage: test_fail "reason"
test_fail() {
    local reason="$1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    log_fail "$CURRENT_TEST: $reason"
}

# Assert equality
# Usage: assert_eq "actual" "expected" "message"
assert_eq() {
    local actual="$1"
    local expected="$2"
    local msg="${3:-Values should be equal}"

    if [ "$actual" = "$expected" ]; then
        log_info "  ✓ $msg"
        return 0
    else
        log_fail "  ✗ $msg"
        log_fail "    Expected: $expected"
        log_fail "    Actual:   $actual"
        return 1
    fi
}

# Assert not empty
# Usage: assert_not_empty "value" "message"
assert_not_empty() {
    local value="$1"
    local msg="${2:-Value should not be empty}"

    if [ -n "$value" ] && [ "$value" != "null" ]; then
        log_info "  ✓ $msg"
        return 0
    else
        log_fail "  ✗ $msg (got empty/null)"
        return 1
    fi
}

# Assert not equal
# Usage: assert_ne "actual" "unexpected" "message"
assert_ne() {
    local actual="$1"
    local unexpected="$2"
    local msg="${3:-Values should not be equal}"

    if [ "$actual" != "$unexpected" ]; then
        log_info "  ✓ $msg"
        return 0
    else
        log_fail "  ✗ $msg (both are: $actual)"
        return 1
    fi
}

# Assert contains
# Usage: assert_contains "haystack" "needle" "message"
assert_contains() {
    local haystack="$1"
    local needle="$2"
    local msg="${3:-String should contain substring}"

    if [[ "$haystack" == *"$needle"* ]]; then
        log_info "  ✓ $msg"
        return 0
    else
        log_fail "  ✗ $msg"
        log_fail "    Looking for: $needle"
        log_fail "    In: ${haystack:0:100}..."
        return 1
    fi
}

# Assert exit code
# Usage: assert_exit_code "expected" "message"
assert_exit_code() {
    local expected="$1"
    local msg="${2:-Exit code should match}"

    assert_eq "$CLAUDE_EXIT_CODE" "$expected" "$msg"
}

# ============================================================================
# Test Lifecycle
# ============================================================================

# Setup test workspace in VM
setup_workspace() {
    log_info "Setting up test workspace: $TEST_WORKSPACE"
    vm_exec "mkdir -p '$TEST_WORKSPACE' && cd '$TEST_WORKSPACE' && rm -rf .claude"
}

# Clean up test workspace
cleanup_workspace() {
    log_info "Cleaning up test workspace"
    vm_exec "rm -rf '$TEST_WORKSPACE'" 2>/dev/null || true
}

# Print test summary
print_summary() {
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}TEST SUMMARY${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
    echo "  Total:  $TESTS_RUN"
    echo -e "  ${GREEN}Passed: $TESTS_PASSED${NC}"
    if [ $TESTS_FAILED -gt 0 ]; then
        echo -e "  ${RED}Failed: $TESTS_FAILED${NC}"
    else
        echo "  Failed: 0"
    fi
    echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"

    if [ $TESTS_FAILED -gt 0 ]; then
        return 1
    fi
    return 0
}

# ============================================================================
# Snapshot Management
# ============================================================================

# Restore VM to authenticated snapshot before tests
restore_snapshot() {
    local snapshot="${1:-authenticated}"
    log_info "Restoring VM to snapshot: $snapshot"

    limactl stop "$VM_NAME" 2>/dev/null || true
    limactl snapshot apply "$VM_NAME" --tag "$snapshot"
    limactl start "$VM_NAME"

    # Wait for VM to be ready
    sleep 2
    vm_exec "echo 'VM ready'"
}

# ============================================================================
# Result Saving
# ============================================================================

# Save test results to file
# Usage: save_results "test_name"
save_results() {
    local test_name="$1"
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local result_file="$RESULTS_DIR/${test_name}_${timestamp}.json"

    mkdir -p "$RESULTS_DIR"

    cat > "$result_file" << EOF
{
  "test": "$test_name",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "tests_run": $TESTS_RUN,
  "tests_passed": $TESTS_PASSED,
  "tests_failed": $TESTS_FAILED,
  "vm": "$VM_NAME",
  "last_claude_output": $(echo "$CLAUDE_OUTPUT" | jq -c . 2>/dev/null || echo "null")
}
EOF

    log_info "Results saved to: $result_file"
}
