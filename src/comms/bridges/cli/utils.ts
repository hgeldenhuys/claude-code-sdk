/**
 * CLI Bridge Utilities
 *
 * Shared helpers for ANSI colors, formatting, env parsing, and output
 * used across all comms CLI subcommands.
 *
 * Extracted from common patterns in comms-memo.ts, comms-paste.ts, comms-audit.ts.
 */

import type { EnvConfig, EnvConfigPartial } from './types';

// ============================================================================
// TTY Detection
// ============================================================================

const isTTY = process.stdout.isTTY ?? false;

// ============================================================================
// ANSI Color Helpers
// ============================================================================

/**
 * Apply an ANSI color code to text. Returns plain text when stdout is not a TTY.
 */
function color(text: string, code: string): string {
  if (!isTTY) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export function bold(text: string): string { return color(text, '1'); }
export function dim(text: string): string { return color(text, '2'); }
export function red(text: string): string { return color(text, '31'); }
export function green(text: string): string { return color(text, '32'); }
export function yellow(text: string): string { return color(text, '33'); }
export function cyan(text: string): string { return color(text, '36'); }
export function magenta(text: string): string { return color(text, '35'); }
export function gray(text: string): string { return color(text, '90'); }

// ============================================================================
// String Formatting
// ============================================================================

/**
 * Truncate a string to maxLen characters, appending ".." if truncated.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 2) + '..';
}

/**
 * Format an ISO timestamp as relative time (<24h) or date (older).
 * - Less than 1 minute: "just now"
 * - Less than 1 hour: "Xm ago"
 * - Less than 24 hours: "Xh ago"
 * - Older: YYYY-MM-DD
 */
export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMinutes = diffMs / (1000 * 60);
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffMinutes < 1) return 'just now';
    if (diffHours < 1) return `${Math.floor(diffMinutes)}m ago`;
    if (diffHours < 24) return `${Math.floor(diffHours)}h ago`;
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

/**
 * Format a message/memo status with appropriate color.
 */
export function formatStatus(status: string): string {
  switch (status) {
    case 'pending': return yellow('pending');
    case 'claimed': return cyan('claimed');
    case 'delivered': return green('delivered');
    case 'read': return dim('read');
    case 'expired': return gray('expired');
    case 'active': return green('active');
    case 'idle': return yellow('idle');
    case 'offline': return red('offline');
    default: return status;
  }
}

// ============================================================================
// Environment Config
// ============================================================================

/**
 * Parse full environment config (apiUrl + projectKey + agentId).
 * Exits with code 1 if any variable is missing.
 */
export function parseEnvConfig(): EnvConfig {
  const apiUrl = process.env.SIGNALDB_API_URL;
  const projectKey = process.env.SIGNALDB_PROJECT_KEY;
  const agentId = process.env.SIGNALDB_AGENT_ID;

  if (!apiUrl || !projectKey || !agentId) {
    const missing: string[] = [];
    if (!apiUrl) missing.push('SIGNALDB_API_URL');
    if (!projectKey) missing.push('SIGNALDB_PROJECT_KEY');
    if (!agentId) missing.push('SIGNALDB_AGENT_ID');
    exitWithError(`Missing environment variables: ${missing.join(', ')}`);
  }

  return { apiUrl, projectKey, agentId };
}

/**
 * Parse partial environment config (apiUrl + projectKey only).
 * Used by commands that don't require agentId.
 * Exits with code 1 if any variable is missing.
 */
export function parseEnvConfigPartial(): EnvConfigPartial {
  const apiUrl = process.env.SIGNALDB_API_URL;
  const projectKey = process.env.SIGNALDB_PROJECT_KEY;

  if (!apiUrl || !projectKey) {
    const missing: string[] = [];
    if (!apiUrl) missing.push('SIGNALDB_API_URL');
    if (!projectKey) missing.push('SIGNALDB_PROJECT_KEY');
    exitWithError(`Missing environment variables: ${missing.join(', ')}`);
  }

  return { apiUrl, projectKey };
}

// ============================================================================
// Output Helpers
// ============================================================================

/**
 * Print data as formatted JSON if isJson is true, otherwise do nothing.
 * Returns true if JSON was printed (so caller can short-circuit).
 */
export function jsonOutput(data: unknown, isJson: boolean): boolean {
  if (isJson) {
    console.log(JSON.stringify(data, null, 2));
    return true;
  }
  return false;
}

/**
 * Print an error message in red and exit with code 1.
 */
export function exitWithError(message: string): never {
  console.error(red(`Error: ${message}`));
  process.exit(1);
}

// ============================================================================
// Argument Parsing Helpers
// ============================================================================

/**
 * Check if a --json flag is present in the args array.
 */
export function hasJsonFlag(args: string[]): boolean {
  return args.includes('--json');
}

/**
 * Get the value of a named flag from args (e.g. --type direct).
 * Returns undefined if not found.
 */
export function getFlagValue(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      return args[i + 1];
    }
  }
  return undefined;
}
