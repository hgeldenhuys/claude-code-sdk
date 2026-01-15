#!/bin/bash
# Lima VM Setup for Claude Code Integration Tests
#
# This script sets up a Lima VM with Claude Code installed.
# After initial setup and authentication, create a snapshot for repeatable testing.
#
# Usage:
#   ./setup-lima.sh create     # Create new VM
#   ./setup-lima.sh install    # Install Claude Code in VM
#   ./setup-lima.sh snapshot   # Create authenticated snapshot
#   ./setup-lima.sh restore    # Restore to authenticated snapshot
#   ./setup-lima.sh destroy    # Remove VM completely
#   ./setup-lima.sh status     # Check VM status

set -e

VM_NAME="claude-sdk-test"
SNAPSHOT_NAME="authenticated"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

check_lima() {
    if ! command -v limactl &> /dev/null; then
        log_error "Lima is not installed. Install with: brew install lima"
        exit 1
    fi
}

cmd_create() {
    log_info "Creating Lima VM: $VM_NAME"

    # Check if VM already exists
    if limactl list -q | grep -q "^$VM_NAME$"; then
        log_warn "VM $VM_NAME already exists. Use 'destroy' first to recreate."
        exit 1
    fi

    # Create VM with Ubuntu 24.04
    limactl create --name="$VM_NAME" --cpus=2 --memory=4 --disk=20 template://ubuntu-24.04

    # Start the VM
    limactl start "$VM_NAME"

    log_info "VM created and started successfully"
    log_info "Next steps:"
    echo "  1. Run: ./setup-lima.sh install"
    echo "  2. Authenticate: limactl shell $VM_NAME -- claude login"
    echo "  3. Create snapshot: ./setup-lima.sh snapshot"
}

cmd_install() {
    log_info "Installing Claude Code and dependencies in VM..."

    limactl shell "$VM_NAME" -- bash -c '
        set -e

        # Update packages
        sudo apt-get update
        sudo apt-get install -y curl git jq

        # Install Node.js (required for Claude Code)
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs

        # Install Claude Code
        npm install -g @anthropic-ai/claude-code

        # Verify installation
        claude --version

        echo "Claude Code installed successfully!"
    '

    log_info "Installation complete"
    log_info "Next: Run 'limactl shell $VM_NAME -- claude login' to authenticate"
}

cmd_snapshot() {
    log_info "Creating authenticated snapshot..."

    # Stop VM first (required for snapshot)
    limactl stop "$VM_NAME" 2>/dev/null || true

    # Create snapshot
    limactl snapshot create "$VM_NAME" --tag "$SNAPSHOT_NAME"

    # Restart VM
    limactl start "$VM_NAME"

    log_info "Snapshot '$SNAPSHOT_NAME' created successfully"
    log_info "You can now run integration tests with: ./run-tests.sh"
}

cmd_restore() {
    log_info "Restoring to authenticated snapshot..."

    # Stop VM
    limactl stop "$VM_NAME" 2>/dev/null || true

    # Apply snapshot
    limactl snapshot apply "$VM_NAME" --tag "$SNAPSHOT_NAME"

    # Start VM
    limactl start "$VM_NAME"

    log_info "Restored to snapshot '$SNAPSHOT_NAME'"
}

cmd_destroy() {
    log_warn "This will permanently delete VM $VM_NAME and all snapshots"
    read -p "Are you sure? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        limactl delete "$VM_NAME" --force 2>/dev/null || true
        log_info "VM destroyed"
    else
        log_info "Cancelled"
    fi
}

cmd_status() {
    log_info "VM Status:"
    limactl list | grep -E "^NAME|$VM_NAME" || echo "VM not found"

    echo ""
    log_info "Snapshots:"
    limactl snapshot list "$VM_NAME" 2>/dev/null || echo "No snapshots or VM not found"
}

cmd_shell() {
    limactl shell "$VM_NAME"
}

# Main
check_lima

case "${1:-status}" in
    create)   cmd_create ;;
    install)  cmd_install ;;
    snapshot) cmd_snapshot ;;
    restore)  cmd_restore ;;
    destroy)  cmd_destroy ;;
    status)   cmd_status ;;
    shell)    cmd_shell ;;
    *)
        echo "Lima VM Setup for Claude Code Integration Tests"
        echo ""
        echo "Usage: $0 <command>"
        echo ""
        echo "Commands:"
        echo "  create    - Create new Lima VM"
        echo "  install   - Install Claude Code in VM"
        echo "  snapshot  - Create authenticated snapshot (after login)"
        echo "  restore   - Restore VM to authenticated snapshot"
        echo "  destroy   - Delete VM and all snapshots"
        echo "  status    - Show VM and snapshot status"
        echo "  shell     - Open shell in VM"
        echo ""
        echo "Initial Setup:"
        echo "  1. $0 create"
        echo "  2. $0 install"
        echo "  3. limactl shell $VM_NAME -- claude login"
        echo "  4. $0 snapshot"
        ;;
esac
