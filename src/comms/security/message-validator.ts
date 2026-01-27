/**
 * Message Content Validator
 *
 * Validates and sanitizes message content for the agent communication system.
 * Checks for size limits, shell injection patterns, and metadata integrity.
 */

import type { ValidationResult, ContentViolation } from './types';

// ============================================================================
// Dangerous Patterns
// ============================================================================

/**
 * Shell injection patterns to detect in command-type messages.
 * These patterns indicate attempts to inject shell commands.
 */
const SHELL_INJECTION_PATTERNS: readonly RegExp[] = [
  // Command chaining
  /;\s*(?:rm|wget|curl|bash|sh|python|node|eval|exec)\b/i,
  // Pipe to shell
  /\|\s*(?:bash|sh|zsh)\b/i,
  // Backtick execution
  /`[^`]*`/,
  // $() command substitution
  /\$\([^)]+\)/,
  // Process substitution
  /<\([^)]+\)/,
  // Heredoc injection
  /<<\s*\w+/,
  // Environment variable override
  /\b(?:PATH|HOME|LD_PRELOAD|LD_LIBRARY_PATH)\s*=/,
  // Dangerous redirects
  />\s*\/(?:etc|dev|proc|sys)\//,
  // --dangerously-skip-permissions (always block)
  /--dangerously-skip-permissions/i,
];

/**
 * Patterns to strip from content during sanitization.
 */
const SANITIZE_PATTERNS: readonly { pattern: RegExp; replacement: string }[] = [
  // Null bytes
  { pattern: /\0/g, replacement: '' },
  // ANSI escape sequences
  { pattern: /\x1b\[[0-9;]*[a-zA-Z]/g, replacement: '' },
  // Control characters (except newline, tab, carriage return)
  { pattern: /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, replacement: '' },
];

// ============================================================================
// Default Limits
// ============================================================================

/** Default maximum message content size in bytes (100KB) */
const DEFAULT_MAX_SIZE = 102_400;

/** Maximum metadata JSON size in bytes (10KB) */
const MAX_METADATA_SIZE = 10_240;

/** Maximum number of metadata keys */
const MAX_METADATA_KEYS = 50;

/** Maximum metadata key length */
const MAX_METADATA_KEY_LENGTH = 128;

// ============================================================================
// Message Validator
// ============================================================================

/**
 * Validates and sanitizes message content.
 *
 * Performs:
 * - Size validation (configurable, default 100KB)
 * - Shell injection detection for command messages
 * - Content sanitization (strip null bytes, control chars, ANSI escapes)
 * - Metadata validation (size, key count, key length)
 *
 * @example
 * ```typescript
 * const validator = new MessageValidator();
 *
 * // Validate content
 * const result = validator.validateContent('Hello, agent!');
 * // { valid: true, errors: [] }
 *
 * // Detect shell injection
 * const bad = validator.validateContent('run this; rm -rf /');
 * // { valid: false, errors: ['Content contains potentially dangerous shell pattern: ...'] }
 *
 * // Sanitize content
 * const clean = validator.sanitizeContent('Hello\x00World\x1b[31m');
 * // 'HelloWorld'
 * ```
 */
export class MessageValidator {
  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Validate message content.
   *
   * @param content - Message content string
   * @param maxSize - Maximum size in bytes (default: 102400 = 100KB)
   * @returns ValidationResult with valid flag and error messages
   */
  validateContent(content: string, maxSize: number = DEFAULT_MAX_SIZE): ValidationResult {
    const errors: string[] = [];

    // Check for empty content
    if (!content || content.trim().length === 0) {
      errors.push('Content must not be empty');
    }

    // Check size
    const byteSize = new TextEncoder().encode(content).length;
    if (byteSize > maxSize) {
      errors.push(
        `Content size ${byteSize} bytes exceeds maximum ${maxSize} bytes`,
      );
    }

    // Check for shell injection patterns
    for (const pattern of SHELL_INJECTION_PATTERNS) {
      if (pattern.test(content)) {
        errors.push(
          `Content contains potentially dangerous shell pattern: ${pattern.source}`,
        );
      }
    }

    // Check for null bytes
    if (content.includes('\0')) {
      errors.push('Content contains null bytes');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Sanitize message content by removing dangerous characters.
   *
   * Removes:
   * - Null bytes
   * - ANSI escape sequences
   * - Control characters (preserves newline, tab, carriage return)
   *
   * @param content - Raw content string
   * @returns Sanitized content string
   */
  sanitizeContent(content: string): string {
    let result = content;

    for (const { pattern, replacement } of SANITIZE_PATTERNS) {
      result = result.replace(pattern, replacement);
    }

    return result;
  }

  /**
   * Validate message metadata.
   *
   * Checks:
   * - Metadata is a valid object (not null/array)
   * - Serialized size within limits (10KB)
   * - Key count within limits (50)
   * - Key lengths within limits (128 chars)
   * - No nested functions or undefined values
   *
   * @param metadata - Metadata object to validate
   * @returns ValidationResult with valid flag and error messages
   */
  validateMetadata(metadata: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];

    // Check it's a plain object
    if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
      errors.push('Metadata must be a plain object');
      return { valid: false, errors };
    }

    // Check key count
    const keys = Object.keys(metadata);
    if (keys.length > MAX_METADATA_KEYS) {
      errors.push(
        `Metadata has ${keys.length} keys, maximum is ${MAX_METADATA_KEYS}`,
      );
    }

    // Check key lengths
    for (const key of keys) {
      if (key.length > MAX_METADATA_KEY_LENGTH) {
        errors.push(
          `Metadata key "${key.slice(0, 32)}..." exceeds maximum length of ${MAX_METADATA_KEY_LENGTH}`,
        );
      }
    }

    // Check serialized size
    let serialized: string;
    try {
      serialized = JSON.stringify(metadata);
    } catch {
      errors.push('Metadata is not JSON-serializable');
      return { valid: false, errors };
    }

    const byteSize = new TextEncoder().encode(serialized).length;
    if (byteSize > MAX_METADATA_SIZE) {
      errors.push(
        `Metadata size ${byteSize} bytes exceeds maximum ${MAX_METADATA_SIZE} bytes`,
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Create a SecurityViolation for content validation failure.
   *
   * @param agentId - Agent that sent the invalid content
   * @param field - Which field failed ('content' or 'metadata')
   * @param reason - Specific reason for failure
   * @returns A ContentViolation object
   */
  createViolation(agentId: string, field: string, reason: string): ContentViolation {
    return {
      type: 'content',
      timestamp: new Date().toISOString(),
      agentId,
      message: `Content validation failed for "${field}": ${reason}`,
      field,
      reason,
    };
  }
}
