/**
 * Dangerous Command Guard Built-in Handler
 *
 * Blocks dangerous Bash commands from executing on PreToolUse.
 * Supports configurable patterns and allow-lists.
 */

import type { HandlerDefinition, HandlerResult, PipelineContext } from '../types';
import type { DangerousCommandGuardOptions } from '../config/types';
import type { PreToolUseInput } from '../../types';

// ============================================================================
// Default Blocked Patterns
// ============================================================================

/**
 * Default patterns that are always blocked in strict mode
 */
const STRICT_BLOCKED_PATTERNS: RegExp[] = [
  // Destructive file operations
  /rm\s+(-[rRf]+\s+)*\//, // rm -rf / or rm /
  /rm\s+-[rRf]*\s+~/, // rm -rf ~
  /rm\s+-[rRf]*\s+\*/, // rm -rf *
  /rm\s+-[rRf]*\s+\.\*/, // rm -rf .*
  />\s*\/dev\/sd[a-z]/, // Writing to disk devices
  /dd\s+.*of=\/dev\/sd/, // dd to disk devices
  /mkfs\./, // Formatting filesystems
  /wipefs/, // Wiping filesystem signatures

  // Dangerous permission changes
  /chmod\s+(-[rR]+\s+)*777\s+\//, // chmod 777 /
  /chmod\s+(-[rR]+\s+)*000\s+\//, // chmod 000 /
  /chown\s+.*:.*\s+\/(?!tmp)/, // chown on root (except /tmp)

  // Database operations
  /drop\s+(database|table|schema)/i, // DROP DATABASE/TABLE
  /truncate\s+table/i, // TRUNCATE TABLE
  /delete\s+from\s+\w+\s*(;|$)/i, // DELETE without WHERE

  // System modifications
  /:(){ :|:& };:/, // Fork bomb
  />\s*\/etc\/passwd/, // Overwrite passwd
  />\s*\/etc\/shadow/, // Overwrite shadow
  />\s*\/boot\//, // Overwrite boot files

  // Network attacks
  /curl\s+.*\|\s*(ba)?sh/, // curl | bash
  /wget\s+.*\|\s*(ba)?sh/, // wget | bash
];

/**
 * Default patterns blocked in normal mode (less strict)
 */
const DEFAULT_BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-[rRf]*\s+\/\s*$/, // rm -rf / (root only)
  /rm\s+-[rRf]*\s+\/\*/, // rm -rf /*
  /:(){ :|:& };:/, // Fork bomb
  /drop\s+database/i, // DROP DATABASE
  />\s*\/etc\/passwd/, // Overwrite passwd
];

// ============================================================================
// Handler Factory
// ============================================================================

/**
 * Create a dangerous-command-guard handler with the given options
 */
export function createDangerousCommandGuardHandler(
  options: DangerousCommandGuardOptions = {}
): HandlerDefinition {
  const {
    blockedPatterns = [],
    allowedPatterns = [],
    strict = false,
    messageTemplate = 'Command blocked: {{reason}}',
  } = options;

  // Compile custom patterns
  const customBlockedRegex = compilePatterns(blockedPatterns);
  const customAllowedRegex = compilePatterns(allowedPatterns);

  // Select base patterns based on strict mode
  const basePatterns = strict ? STRICT_BLOCKED_PATTERNS : DEFAULT_BLOCKED_PATTERNS;

  return {
    id: 'dangerous-command-guard',
    name: 'Dangerous Command Guard',
    description: 'Blocks dangerous Bash commands from executing',
    priority: 20,
    enabled: true,
    handler: async (ctx: PipelineContext): Promise<HandlerResult> => {
      const event = ctx.event as PreToolUseInput;

      // Only check Bash tool
      if (event.tool_name !== 'Bash') {
        return { success: true, durationMs: 0 };
      }

      const command = event.tool_input?.command as string | undefined;
      if (!command) {
        return { success: true, durationMs: 0 };
      }

      // Check if command is allowed (overrides blocks)
      if (isAllowed(command, customAllowedRegex)) {
        return { success: true, durationMs: 0 };
      }

      // Check against blocked patterns
      const matchedPattern = findMatchingPattern(command, basePatterns, customBlockedRegex);
      if (matchedPattern) {
        const reason = formatBlockReason(matchedPattern, command);
        const message = messageTemplate.replace('{{reason}}', reason);

        return {
          success: true,
          durationMs: 0,
          block: true,
          blockReason: message,
          data: {
            command,
            pattern: matchedPattern.toString(),
            reason,
          },
        };
      }

      return { success: true, durationMs: 0 };
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Compile string patterns to RegExp objects
 */
function compilePatterns(patterns: string[]): RegExp[] {
  const compiled: RegExp[] = [];

  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(pattern, 'i'));
    } catch (error) {
      console.error(`[dangerous-command-guard] Invalid pattern: ${pattern}`, error);
    }
  }

  return compiled;
}

/**
 * Check if a command matches any allowed pattern
 */
function isAllowed(command: string, allowedPatterns: RegExp[]): boolean {
  for (const pattern of allowedPatterns) {
    if (pattern.test(command)) {
      return true;
    }
  }
  return false;
}

/**
 * Find the first matching blocked pattern
 */
function findMatchingPattern(
  command: string,
  basePatterns: RegExp[],
  customPatterns: RegExp[]
): RegExp | null {
  // Check custom patterns first
  for (const pattern of customPatterns) {
    if (pattern.test(command)) {
      return pattern;
    }
  }

  // Check base patterns
  for (const pattern of basePatterns) {
    if (pattern.test(command)) {
      return pattern;
    }
  }

  return null;
}

/**
 * Format a human-readable block reason
 */
function formatBlockReason(pattern: RegExp, command: string): string {
  const patternStr = pattern.toString();

  // Provide friendly descriptions for common patterns
  if (patternStr.includes('rm') && patternStr.includes('-[rRf]')) {
    return 'Recursive file deletion is not allowed';
  }
  if (patternStr.includes('chmod') && patternStr.includes('777')) {
    return 'Setting permissions to 777 is not allowed';
  }
  if (patternStr.includes('drop') && patternStr.includes('database')) {
    return 'DROP DATABASE is not allowed';
  }
  if (patternStr.includes('drop') && patternStr.includes('table')) {
    return 'DROP TABLE is not allowed';
  }
  if (patternStr.includes('fork')) {
    return 'Fork bomb detected';
  }
  if (patternStr.includes('curl') || patternStr.includes('wget')) {
    return 'Piping remote content to shell is not allowed';
  }
  if (patternStr.includes('/etc/passwd') || patternStr.includes('/etc/shadow')) {
    return 'Modifying system authentication files is not allowed';
  }
  if (patternStr.includes('truncate') || patternStr.includes('delete')) {
    return 'Bulk data deletion without WHERE clause is not allowed';
  }

  // Fallback to generic message
  return `Matches blocked pattern: ${patternStr}`;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a command would be blocked
 * Useful for testing and debugging
 */
export function wouldBlock(
  command: string,
  options: DangerousCommandGuardOptions = {}
): { blocked: boolean; reason?: string; pattern?: string } {
  const {
    blockedPatterns = [],
    allowedPatterns = [],
    strict = false,
  } = options;

  const customBlockedRegex = compilePatterns(blockedPatterns);
  const customAllowedRegex = compilePatterns(allowedPatterns);
  const basePatterns = strict ? STRICT_BLOCKED_PATTERNS : DEFAULT_BLOCKED_PATTERNS;

  if (isAllowed(command, customAllowedRegex)) {
    return { blocked: false };
  }

  const matchedPattern = findMatchingPattern(command, basePatterns, customBlockedRegex);
  if (matchedPattern) {
    return {
      blocked: true,
      reason: formatBlockReason(matchedPattern, command),
      pattern: matchedPattern.toString(),
    };
  }

  return { blocked: false };
}

/**
 * Get all blocked patterns (for debugging/documentation)
 */
export function getBlockedPatterns(strict = false): string[] {
  const patterns = strict ? STRICT_BLOCKED_PATTERNS : DEFAULT_BLOCKED_PATTERNS;
  return patterns.map((p) => p.toString());
}

// ============================================================================
// Default Export
// ============================================================================

export default createDangerousCommandGuardHandler;
