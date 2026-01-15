#!/bin/bash
# Integration Test Runner
#
# Runs Claude Code integration tests in a Lima VM sandbox.
#
# Usage:
#   ./run-tests.sh                    # Run all tests
#   ./run-tests.sh session-survival   # Run specific test
#   ./run-tests.sh --restore          # Restore snapshot first, then run
#   ./run-tests.sh --list             # List available tests
#
# Prerequisites:
#   1. Lima VM created with: ./setup-lima.sh create
#   2. Claude installed: ./setup-lima.sh install
#   3. Authenticated: limactl shell claude-sdk-test -- claude login
#   4. Snapshot created: ./setup-lima.sh snapshot

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_DIR="$SCRIPT_DIR/tests"
VM_NAME="claude-sdk-test"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# ============================================================================
# VM Checks
# ============================================================================

check_vm() {
    if ! command -v limactl &> /dev/null; then
        log_fail "Lima is not installed. Install with: brew install lima"
        exit 1
    fi

    if ! limactl list -q | grep -q "^$VM_NAME$"; then
        log_fail "VM '$VM_NAME' not found. Run: ./setup-lima.sh create"
        exit 1
    fi

    local status=$(limactl list --json | jq -r ".[] | select(.name == \"$VM_NAME\") | .status")
    if [ "$status" != "Running" ]; then
        log_info "Starting VM '$VM_NAME'..."
        limactl start "$VM_NAME"
        sleep 2
    fi

    log_info "VM '$VM_NAME' is running"
}

# ============================================================================
# Test Discovery
# ============================================================================

list_tests() {
    echo "Available integration tests:"
    echo ""
    for test_file in "$TESTS_DIR"/*.sh; do
        if [ -f "$test_file" ]; then
            local name=$(basename "$test_file" .sh)
            local desc=$(head -10 "$test_file" | grep -m1 "^# " | sed 's/^# //' || echo "No description")
            echo "  $name"
            echo "    $desc"
            echo ""
        fi
    done
}

# ============================================================================
# Test Execution
# ============================================================================

run_test() {
    local test_name="$1"
    local test_file="$TESTS_DIR/${test_name}.sh"

    if [ ! -f "$test_file" ]; then
        log_fail "Test not found: $test_name"
        log_info "Available tests:"
        ls -1 "$TESTS_DIR"/*.sh 2>/dev/null | xargs -n1 basename | sed 's/.sh$/  /' || echo "  (none)"
        exit 1
    fi

    log_info "Running test: $test_name"
    echo ""

    # Make executable
    chmod +x "$test_file"

    # Run test
    set +e
    "$test_file"
    local exit_code=$?
    set -e

    return $exit_code
}

run_all_tests() {
    local total=0
    local passed=0
    local failed=0
    local failed_tests=()

    for test_file in "$TESTS_DIR"/*.sh; do
        if [ -f "$test_file" ]; then
            local test_name=$(basename "$test_file" .sh)
            total=$((total + 1))

            echo ""
            echo "╔════════════════════════════════════════════════════════╗"
            echo "║  Running: $test_name"
            echo "╚════════════════════════════════════════════════════════╝"

            set +e
            run_test "$test_name"
            local result=$?
            set -e

            if [ $result -eq 0 ]; then
                passed=$((passed + 1))
                log_pass "Test suite passed: $test_name"
            else
                failed=$((failed + 1))
                failed_tests+=("$test_name")
                log_fail "Test suite failed: $test_name"
            fi
        fi
    done

    # Final summary
    echo ""
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║                  FINAL SUMMARY                         ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo ""
    echo "  Test suites run:    $total"
    echo -e "  ${GREEN}Passed:              $passed${NC}"

    if [ $failed -gt 0 ]; then
        echo -e "  ${RED}Failed:              $failed${NC}"
        echo ""
        echo "  Failed tests:"
        for t in "${failed_tests[@]}"; do
            echo "    - $t"
        done
        return 1
    fi

    echo ""
    log_pass "All test suites passed!"
    return 0
}

# ============================================================================
# Snapshot Restore
# ============================================================================

restore_snapshot() {
    local snapshot="${1:-authenticated}"
    log_info "Restoring VM to snapshot: $snapshot"

    limactl stop "$VM_NAME" 2>/dev/null || true
    limactl snapshot apply "$VM_NAME" --tag "$snapshot"
    limactl start "$VM_NAME"

    # Wait for VM to be ready
    sleep 3
    limactl shell "$VM_NAME" -- echo "VM ready"

    log_info "Snapshot restored successfully"
}

# ============================================================================
# Main
# ============================================================================

print_banner() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║                                                                ║"
    echo "║   Claude Code SDK - Integration Test Runner                    ║"
    echo "║                                                                ║"
    echo "║   Tests run in isolated Lima VM sandbox                        ║"
    echo "║                                                                ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
}

show_help() {
    echo "Claude Code SDK - Integration Test Runner"
    echo ""
    echo "Usage: $0 [options] [test-name]"
    echo ""
    echo "Options:"
    echo "  --list, -l        List available tests"
    echo "  --restore, -r     Restore VM to snapshot before running tests"
    echo "  --help, -h        Show this help"
    echo ""
    echo "Examples:"
    echo "  $0                          # Run all tests"
    echo "  $0 session-survival         # Run specific test"
    echo "  $0 --restore                # Restore snapshot, run all tests"
    echo "  $0 --restore session-survival  # Restore, run specific test"
    echo ""
    echo "Setup (first time):"
    echo "  ./setup-lima.sh create      # Create VM"
    echo "  ./setup-lima.sh install     # Install Claude Code"
    echo "  limactl shell claude-sdk-test -- claude login  # Authenticate"
    echo "  ./setup-lima.sh snapshot    # Create authenticated snapshot"
}

main() {
    local do_restore=false
    local test_name=""

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --list|-l)
                list_tests
                exit 0
                ;;
            --restore|-r)
                do_restore=true
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            -*)
                log_fail "Unknown option: $1"
                show_help
                exit 1
                ;;
            *)
                test_name="$1"
                shift
                ;;
        esac
    done

    print_banner

    # Check VM
    check_vm

    # Restore snapshot if requested
    if $do_restore; then
        restore_snapshot
    fi

    # Run tests
    if [ -n "$test_name" ]; then
        run_test "$test_name"
    else
        run_all_tests
    fi
}

main "$@"
