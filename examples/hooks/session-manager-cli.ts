#!/usr/bin/env bun
/**
 * Example: Session Manager CLI
 *
 * A command-line tool for managing named sessions.
 *
 * Usage:
 *   bun run examples/hooks/session-manager-cli.ts list
 *   bun run examples/hooks/session-manager-cli.ts get-id brave-elephant
 *   bun run examples/hooks/session-manager-cli.ts rename old-name new-name
 *   bun run examples/hooks/session-manager-cli.ts help
 */

import { runSessionCLI } from '../../src/hooks';

const args = process.argv.slice(2);
const result = runSessionCLI(args);

console.log(result.message);
process.exit(result.success ? 0 : 1);
