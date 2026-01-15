# Claude Code SDK - Integration Tests

End-to-end integration tests that run Claude Code in isolated Lima VM sandboxes.

## Overview

These tests verify that Claude Code features work correctly in real scenarios, including:
- Session naming survives `/compact` operations
- Session resume by human-friendly name
- Hook behavior with actual Claude Code execution

## Prerequisites

- macOS with Lima installed (`brew install lima`)
- Claude Code Max subscription (for authentication)
- ~20GB disk space for VM

## Quick Start

### 1. Setup Lima VM

```bash
cd integration-tests

# Create the VM
./setup-lima.sh create

# Install Claude Code and dependencies
./setup-lima.sh install
```

### 2. Authenticate Claude

```bash
# Open shell in VM
limactl shell claude-sdk-test

# Inside VM: authenticate with your Claude Code subscription
claude login

# Exit VM
exit
```

### 3. Create Snapshot

```bash
# Create authenticated snapshot for repeatable tests
./setup-lima.sh snapshot
```

### 4. Run Tests

```bash
# Run all tests
./run-tests.sh

# Run specific test
./run-tests.sh session-survival

# Restore to clean state first, then run
./run-tests.sh --restore session-survival
```

## Test Structure

```
integration-tests/
├── setup-lima.sh          # VM setup and management
├── run-tests.sh           # Test runner
├── lib/
│   └── test-utils.sh      # Shared test utilities
├── tests/
│   └── session-survival.sh  # Session naming tests
├── fixtures/              # Test data
└── results/               # Test output
```

## Available Tests

### session-survival

Tests that session names persist across `/compact` operations:

1. Start a new Claude session
2. Get the session name from our hooks
3. Record the session ID
4. Run `/compact` to force a new session
5. Resume using the session name
6. Verify the name still works (even if ID changed)

## Writing New Tests

### Test Template

```bash
#!/bin/bash
# Integration Test: My New Test
#
# Description of what this test verifies.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/test-utils.sh"

# Setup
setup() {
    log_info "Setting up test..."
    # Create workspace, initialize state, etc.
}

# Teardown
teardown() {
    log_info "Cleaning up..."
    # Remove test artifacts
}

# Test cases
test_something() {
    test_start "Can do something"

    # Run Claude
    claude_headless "Your prompt here" "/tmp/test-workspace"

    # Assert
    if [ $CLAUDE_EXIT_CODE -eq 0 ]; then
        assert_contains "$CLAUDE_OUTPUT" "expected" "Should contain expected"
        test_pass
    else
        test_fail "Command failed"
    fi
}

# Main
main() {
    setup
    test_something
    teardown
    print_summary
}

trap teardown EXIT
main "$@"
```

### Available Test Utilities

```bash
# Run Claude headless
claude_headless "prompt" "/workspace"   # Run Claude with prompt
claude_resume "name" "prompt" "/ws"     # Resume session by name
claude_slash "/compact" "/workspace"    # Run slash command

# Session management (sesh CLI)
sesh_get_id "session-name"     # Get session ID from name
sesh_get_name "session-id"     # Get name from session ID
sesh_list "--json"             # List all sessions
sesh_exists "session-name"     # Check if name exists

# Assertions
assert_eq "$actual" "$expected" "message"
assert_ne "$actual" "$unexpected" "message"
assert_not_empty "$value" "message"
assert_contains "$string" "substring" "message"
assert_exit_code 0 "Should succeed"

# VM execution
vm_exec "command"              # Run command in VM
vm_exec_capture "cmd"          # Run and capture stdout/stderr

# Results
save_results "test-name"       # Save JSON results
```

## VM Management

```bash
# Check VM status
./setup-lima.sh status

# Open shell in VM
./setup-lima.sh shell

# Restore to authenticated snapshot
./setup-lima.sh restore

# Destroy VM (start fresh)
./setup-lima.sh destroy
```

## Troubleshooting

### VM won't start

```bash
# Check status
limactl list

# Try stopping and starting
limactl stop claude-sdk-test
limactl start claude-sdk-test
```

### Tests failing after changes

```bash
# Restore to clean authenticated state
./setup-lima.sh restore

# Re-run tests
./run-tests.sh
```

### Authentication expired

```bash
# Re-authenticate
limactl shell claude-sdk-test -- claude login

# Update snapshot
./setup-lima.sh snapshot
```

## Notes

- Tests are NOT run in CI (GitHub Actions) - they require authenticated Claude
- Run locally on-demand for validation
- Each test run should restore from snapshot for isolation
- Results are saved to `results/` directory
