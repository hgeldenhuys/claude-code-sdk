/**
 * Security Middleware
 *
 * Decorator that enforces security policies on messaging operations.
 * Wraps rate limiting, content validation, sanitization, directory
 * enforcement, and audit logging into reusable middleware methods.
 */

import type { SecurityManager } from './security-manager';
import type { AuditEntry, RateLimitAction } from './types';

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown when a rate limit is exceeded.
 */
export class RateLimitError extends Error {
  readonly action: RateLimitAction;
  readonly retryAfterMs: number;

  constructor(action: RateLimitAction, retryAfterMs: number) {
    super(
      `Rate limit exceeded for "${action}". Retry after ${retryAfterMs}ms.`,
    );
    this.name = 'RateLimitError';
    this.action = action;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Error thrown when content validation fails.
 */
export class ContentValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`Content validation failed: ${errors.join('; ')}`);
    this.name = 'ContentValidationError';
    this.errors = errors;
  }
}

/**
 * Error thrown when directory enforcement blocks an operation.
 */
export class DirectoryGuardError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`Directory guard blocked access to path: ${path}`);
    this.name = 'DirectoryGuardError';
    this.path = path;
  }
}

// ============================================================================
// Security Middleware
// ============================================================================

/**
 * Security middleware for messaging operations.
 *
 * Provides composable security enforcement methods that can be
 * used by secure wrappers (SecureChannelClient, SecureMemoClient,
 * SecurePasteClient) to add security guardrails to any operation.
 *
 * @example
 * ```typescript
 * const middleware = new SecurityMiddleware(securityManager, 'agent-001', 'mac-001');
 *
 * // Rate limiting
 * await middleware.checkAndRecord('message');
 *
 * // Content validation + sanitization
 * const clean = middleware.validateAndSanitize('Hello, world!');
 *
 * // Directory enforcement
 * middleware.enforceDirectory('/path/to/check');
 *
 * // Audit logging
 * await middleware.audit({
 *   receiverId: 'agent-002',
 *   command: 'publish',
 *   result: 'success',
 *   durationMs: 42,
 * });
 * ```
 */
export class SecurityMiddleware {
  private readonly security: SecurityManager;
  private readonly agentId: string;
  private readonly machineId: string;

  constructor(
    security: SecurityManager,
    agentId: string,
    machineId: string = 'unknown',
  ) {
    this.security = security;
    this.agentId = agentId;
    this.machineId = machineId;
  }

  // ==========================================================================
  // Rate Limiting
  // ==========================================================================

  /**
   * Check rate limit and record the action if allowed.
   * Throws RateLimitError if the action is rate-limited.
   *
   * @param action - The rate-limited action type
   */
  checkAndRecord(action: RateLimitAction): void {
    const result = this.security.checkRateLimit(this.agentId, action);
    if (!result.allowed) {
      throw new RateLimitError(action, result.retryAfterMs);
    }
    this.security.recordAction(this.agentId, action);
  }

  // ==========================================================================
  // Content Validation
  // ==========================================================================

  /**
   * Validate content and return sanitized version.
   * Throws ContentValidationError if content is invalid.
   *
   * @param content - Raw content string
   * @returns Sanitized content string
   */
  validateAndSanitize(content: string): string {
    const result = this.security.validateContent(content);
    if (!result.valid) {
      throw new ContentValidationError(result.errors);
    }
    return this.security.sanitizeContent(content);
  }

  // ==========================================================================
  // Directory Enforcement
  // ==========================================================================

  /**
   * Check if content references file paths and enforce directory restrictions.
   * Throws DirectoryGuardError if a blocked path is found.
   *
   * @param content - Content to check for file path references
   */
  enforceDirectory(content: string): void {
    // Extract potential file paths from content
    const pathPatterns = [
      // Unix absolute paths
      /(?:^|\s)(\/(?:[\w.-]+\/)*[\w.-]+)/gm,
      // Windows paths
      /(?:^|\s)([A-Za-z]:\\(?:[\w.-]+\\)*[\w.-]+)/gm,
    ];

    for (const pattern of pathPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const path = match[1];
        if (path && !this.security.isPathAllowed(path)) {
          throw new DirectoryGuardError(path);
        }
      }
    }
  }

  // ==========================================================================
  // Audit Logging
  // ==========================================================================

  /**
   * Log an audit entry with auto-populated sender and timestamp.
   *
   * @param entry - Partial audit entry (senderId and timestamp are auto-filled)
   */
  async audit(entry: Omit<AuditEntry, 'senderId' | 'timestamp' | 'machineId'>): Promise<void> {
    await this.security.logAudit({
      ...entry,
      senderId: this.agentId,
      timestamp: new Date().toISOString(),
      machineId: this.machineId,
    });
  }
}
