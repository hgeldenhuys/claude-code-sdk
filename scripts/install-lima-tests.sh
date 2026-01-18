#!/bin/bash
# Install Lima VM Sandbox Testing Framework
# Usage: curl -fsSL https://raw.githubusercontent.com/hgeldenhuys/claude-code-sdk/main/scripts/install-lima-tests.sh | bash

set -e

REPO_URL="https://raw.githubusercontent.com/hgeldenhuys/claude-code-sdk/main"
INSTALL_DIR="integration-tests"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                                                                ║"
echo "║   Lima VM Sandbox Testing - Installation                       ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check for Lima
if ! command -v limactl &> /dev/null; then
    echo "[WARN] Lima not installed. Install with: brew install lima"
    echo ""
fi

# Create directory structure
echo "[INFO] Creating directory structure..."
mkdir -p "$INSTALL_DIR/lib"
mkdir -p "$INSTALL_DIR/tests"
mkdir -p "$INSTALL_DIR/fixtures"
mkdir -p "$INSTALL_DIR/results"

# Download core files
echo "[INFO] Downloading test framework..."

curl -fsSL "$REPO_URL/integration-tests/setup-lima.sh" -o "$INSTALL_DIR/setup-lima.sh"
curl -fsSL "$REPO_URL/integration-tests/run-tests.sh" -o "$INSTALL_DIR/run-tests.sh"
curl -fsSL "$REPO_URL/integration-tests/README.md" -o "$INSTALL_DIR/README.md"

# Download lib
curl -fsSL "$REPO_URL/integration-tests/lib/test-utils.sh" -o "$INSTALL_DIR/lib/test-utils.sh"

# Download example test
curl -fsSL "$REPO_URL/integration-tests/tests/session-survival.sh" -o "$INSTALL_DIR/tests/session-survival.sh" 2>/dev/null || true

# Make scripts executable
chmod +x "$INSTALL_DIR/setup-lima.sh"
chmod +x "$INSTALL_DIR/run-tests.sh"
chmod +x "$INSTALL_DIR/tests/"*.sh 2>/dev/null || true

echo ""
echo "[SUCCESS] Installation complete!"
echo ""
echo "Next steps:"
echo ""
echo "  1. Setup VM (one-time, ~5 min):"
echo "     cd $INSTALL_DIR"
echo "     ./setup-lima.sh create"
echo "     ./setup-lima.sh install"
echo ""
echo "  2. Authenticate Claude in VM:"
echo "     limactl shell claude-sdk-test"
echo "     claude login"
echo "     exit"
echo ""
echo "  3. Create authenticated snapshot:"
echo "     ./setup-lima.sh snapshot"
echo ""
echo "  4. Run tests:"
echo "     ./run-tests.sh"
echo ""
echo "Documentation: $INSTALL_DIR/README.md"
echo ""
