/**
 * Security Manager Facade
 *
 * Unified entry point for all security concerns in the agent
 * communication system. Composes independent security components
 * behind a clean facade API.
 */

import type { SignalDBClient } from '../client/signaldb';
import { DirectoryGuard } from './directory-guard';
import { ToolPolicyEngine } from './tool-policy';
import { AuditLogger } from './audit-logger';
import { RLSPolicyGenerator } from './row-level-security';
import { JWTManager } from './jwt-manager';
import { RateLimiter } from './rate-limiter';
import { MessageValidator } from './message-validator';
import type {
  SecurityConfig,
  SecurityViolation,
  AuditEntry,
  JWTPayload,
  RateLimitAction,
  RateLimitResult,
  ValidationResult,
} from './types';

// ============================================================================
// Security Manager
// ============================================================================

/**
 * Facade composing all security components for the agent communication system.
 *
 * Components:
 * - **DirectoryGuard**: --add-dir file access restrictions
 * - **ToolPolicyEngine**: per-agent tool allowlists
 * - **AuditLogger**: command history logging to SignalDB
 * - **RLSPolicyGenerator**: PostgreSQL row-level security SQL
 * - **JWTManager**: token-based agent authentication
 * - **RateLimiter**: sliding window rate limiting
 * - **MessageValidator**: content validation and sanitization
 *
 * @example
 * ```typescript
 * import { SecurityManager, createDefaultSecurityConfig } from 'claude-code-sdk/comms';
 *
 * const config = createDefaultSecurityConfig('my-jwt-secret', ['/home/user/project']);
 * const security = new SecurityManager(config, signalDBClient);
 *
 * // Directory enforcement
 * security.isPathAllowed('/home/user/project/src/index.ts'); // true
 * security.isPathAllowed('/etc/passwd');                       // false
 *
 * // Tool enforcement
 * security.isToolAllowed('agent-001', 'Bash');   // depends on policy
 *
 * // JWT authentication
 * const token = security.createToken('agent-001', 'mac-001', ['read']);
 * const payload = security.validateToken(token);
 *
 * // Rate limiting
 * const result = security.checkRateLimit('agent-001', 'message');
 * if (result.allowed) {
 *   security.recordAction('agent-001', 'message');
 * }
 *
 * // Content validation
 * const valid = security.validateContent('Hello!');
 * const clean = security.sanitizeContent('Hello\x00World');
 *
 * // Audit logging
 * await security.logAudit({
 *   timestamp: new Date().toISOString(),
 *   senderId: 'agent-001',
 *   receiverId: 'agent-002',
 *   command: 'send message',
 *   result: 'success',
 *   durationMs: 42,
 *   machineId: 'mac-001',
 * });
 * ```
 */
export class SecurityManager {
  readonly directory: DirectoryGuard;
  readonly toolPolicy: ToolPolicyEngine;
  readonly audit: AuditLogger;
  readonly rls: RLSPolicyGenerator;
  readonly jwt: JWTManager;
  readonly rateLimiter: RateLimiter;
  readonly validator: MessageValidator;

  private readonly config: SecurityConfig;

  constructor(config: SecurityConfig, client: SignalDBClient) {
    this.config = config;

    // Initialize all components
    this.directory = new DirectoryGuard(config.allowedDirs);
    this.toolPolicy = new ToolPolicyEngine(
      config.defaultToolPolicies,
      config.agentToolOverrides,
    );
    this.audit = new AuditLogger(client, config.audit);
    this.rls = new RLSPolicyGenerator();
    this.jwt = new JWTManager(config.jwt);
    this.rateLimiter = new RateLimiter(config.rateLimits);
    this.validator = new MessageValidator();
  }

  // ==========================================================================
  // Directory Guard (delegated)
  // ==========================================================================

  /**
   * Check if a path is within allowed directories.
   */
  isPathAllowed(path: string): boolean {
    return this.directory.isPathAllowed(path);
  }

  /**
   * Validate a command for directory violations.
   */
  validateCommand(command: string): SecurityViolation | null {
    return this.directory.validateCommand(command);
  }

  /**
   * Get --add-dir CLI flags for allowed directories.
   */
  getAddDirFlags(): string[] {
    return this.directory.getAddDirFlags();
  }

  // ==========================================================================
  // Tool Policy (delegated)
  // ==========================================================================

  /**
   * Check if a tool is allowed for an agent.
   */
  isToolAllowed(agentId: string, toolName: string): boolean {
    return this.toolPolicy.isToolAllowed(agentId, toolName);
  }

  /**
   * CRITICAL: Validate that arguments don't contain --dangerously-skip-permissions.
   */
  validateNoSkipPermissions(args: string[]): boolean {
    return this.toolPolicy.validateNoSkipPermissions(args);
  }

  // ==========================================================================
  // JWT Authentication (delegated)
  // ==========================================================================

  /**
   * Create a JWT token for an agent.
   */
  createToken(agentId: string, machineId: string, capabilities: string[]): string {
    return this.jwt.createToken(agentId, machineId, capabilities);
  }

  /**
   * Validate a JWT token.
   */
  validateToken(token: string): JWTPayload | null {
    return this.jwt.validateToken(token);
  }

  /**
   * Refresh a JWT token if within rotation window.
   */
  refreshToken(oldToken: string): string | null {
    return this.jwt.refreshToken(oldToken);
  }

  /**
   * Revoke a JWT token by its JTI.
   */
  revokeToken(jti: string): void {
    this.jwt.revokeToken(jti);
  }

  // ==========================================================================
  // Rate Limiting (delegated)
  // ==========================================================================

  /**
   * Check if an action is within rate limits.
   */
  checkRateLimit(agentId: string, action: RateLimitAction): RateLimitResult {
    return this.rateLimiter.checkLimit(agentId, action);
  }

  /**
   * Record that an action was performed (for rate tracking).
   */
  recordAction(agentId: string, action: RateLimitAction): void {
    this.rateLimiter.recordAction(agentId, action);
  }

  // ==========================================================================
  // Content Validation (delegated)
  // ==========================================================================

  /**
   * Validate message content.
   */
  validateContent(content: string): ValidationResult {
    return this.validator.validateContent(content, this.config.maxMessageSize);
  }

  /**
   * Sanitize message content.
   */
  sanitizeContent(content: string): string {
    return this.validator.sanitizeContent(content);
  }

  /**
   * Validate message metadata.
   */
  validateMetadata(metadata: Record<string, unknown>): ValidationResult {
    return this.validator.validateMetadata(metadata);
  }

  // ==========================================================================
  // Audit Logging (delegated)
  // ==========================================================================

  /**
   * Log an audit entry.
   */
  async logAudit(entry: AuditEntry): Promise<void> {
    return this.audit.log(entry);
  }

  /**
   * Flush buffered audit entries to SignalDB.
   */
  async flushAudit(): Promise<void> {
    return this.audit.flush();
  }

  /**
   * Start periodic audit log flushing.
   * @returns Cleanup function to stop flushing
   */
  startAuditAutoFlush(): () => void {
    return this.audit.startAutoFlush();
  }

  // ==========================================================================
  // RLS SQL Generation (delegated)
  // ==========================================================================

  /**
   * Generate all PostgreSQL RLS policies.
   */
  generateRLSPolicies(): string {
    return this.rls.generateAllPolicies();
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Clean up resources: stop auto-flush, cleanup revocation list.
   */
  shutdown(): void {
    this.audit.stopAutoFlush();
    this.jwt.cleanupRevocationList();
  }
}
