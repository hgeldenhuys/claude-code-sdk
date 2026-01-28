/**
 * Security Module
 *
 * Agent communication security layer providing:
 * - Directory restriction enforcement (--add-dir)
 * - Tool allowlist policies
 * - Audit logging
 * - Row-level security (PostgreSQL RLS)
 * - JWT token management
 * - Rate limiting
 * - Message content validation
 *
 * @example
 * ```typescript
 * import {
 *   SecurityManager,
 *   createDefaultSecurityConfig,
 *   DirectoryGuard,
 *   ToolPolicyEngine,
 *   JWTManager,
 *   RateLimiter,
 *   MessageValidator,
 * } from 'claude-code-sdk/comms';
 * ```
 */

// Types
export type {
  SecurityConfig,
  ToolPolicy,
  RateLimitAction,
  RateLimitConfig,
  RateLimitState,
  RateLimitResult,
  JWTConfig,
  JWTPayload,
  AuditLogConfig,
  AuditEntry,
  SecurityViolation,
  DirectoryViolation,
  ToolViolation,
  RateLimitViolation,
  AuthViolation,
  ContentViolation,
  ValidationResult,
} from './types';

export { createDefaultSecurityConfig } from './types';

// Components
export { DirectoryGuard } from './directory-guard';
export { ToolPolicyEngine } from './tool-policy';
export { AuditLogger } from './audit-logger';
export { RLSPolicyGenerator } from './row-level-security';
export { JWTManager } from './jwt-manager';
export { RateLimiter } from './rate-limiter';
export { MessageValidator } from './message-validator';

// Middleware
export { SecurityMiddleware, RateLimitError, ContentValidationError, DirectoryGuardError } from './middleware';

// Facade
export { SecurityManager } from './security-manager';
