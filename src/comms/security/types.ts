/**
 * Security Types and Configuration
 *
 * Type definitions for the agent communication security layer:
 * - Directory restrictions (--add-dir enforcement)
 * - Tool allowlists (per-agent tool policies)
 * - Rate limiting (sliding window)
 * - JWT authentication
 * - Audit logging
 * - Message validation
 */

// ============================================================================
// Tool Policy
// ============================================================================

/**
 * Policy for a specific tool, defining whether an agent may use it.
 */
export interface ToolPolicy {
  /** Tool name or wildcard pattern (e.g. 'Bash', 'Bash*') */
  tool: string;
  /** Whether this tool is allowed */
  allowed: boolean;
  /** Human-readable reason for the restriction */
  reason: string;
}

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Actions that are rate-limited.
 */
export type RateLimitAction = 'message' | 'channel_create' | 'paste_create';

/**
 * Configuration for rate limits per action.
 */
export interface RateLimitConfig {
  /** Maximum messages per minute (default: 60) */
  messagesPerMinute: number;
  /** Maximum channel creates per hour (default: 10) */
  channelCreatesPerHour: number;
  /** Maximum paste creates per hour (default: 100) */
  pasteCreatesPerHour: number;
}

/**
 * Current state of a rate limiter for one agent and action.
 */
export interface RateLimitState {
  /** Timestamps of actions within the current window */
  timestamps: number[];
  /** Window size in milliseconds */
  windowMs: number;
  /** Maximum allowed actions in the window */
  maxActions: number;
}

/**
 * Result of checking a rate limit.
 */
export interface RateLimitResult {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Remaining capacity in the current window */
  remaining: number;
  /** Milliseconds until the oldest entry expires (0 if allowed) */
  retryAfterMs: number;
}

// ============================================================================
// JWT Authentication
// ============================================================================

/**
 * Configuration for JWT token management.
 */
export interface JWTConfig {
  /** HMAC-SHA256 secret key (hex string or raw bytes) */
  secret: string;
  /** Token expiry in milliseconds (default: 86400000 = 24h) */
  expiryMs: number;
  /** Token rotation interval in milliseconds (default: 43200000 = 12h) */
  rotationIntervalMs: number;
  /** How long revoked token IDs are kept in milliseconds (default: 172800000 = 48h) */
  revocationListTTL: number;
}

/**
 * JWT token payload for agent authentication.
 */
export interface JWTPayload {
  /** Unique token identifier */
  jti: string;
  /** Agent identifier */
  agentId: string;
  /** Machine identifier */
  machineId: string;
  /** Agent capabilities */
  capabilities: string[];
  /** Token issued-at timestamp (seconds since epoch) */
  iat: number;
  /** Token expiration timestamp (seconds since epoch) */
  exp: number;
}

// ============================================================================
// Audit Logging
// ============================================================================

/**
 * Configuration for audit log batching.
 */
export interface AuditLogConfig {
  /** Number of entries to buffer before flushing (default: 50) */
  batchSize: number;
  /** Auto-flush interval in milliseconds (default: 30000 = 30s) */
  flushIntervalMs: number;
}

/**
 * A single audit log entry recording a command execution.
 */
export interface AuditEntry {
  /** Timestamp of the action (ISO 8601) */
  timestamp: string;
  /** ID of the agent that initiated the action */
  senderId: string;
  /** ID of the agent that received the action (empty for broadcast) */
  receiverId: string;
  /** Command or action description */
  command: string;
  /** Result: 'success', 'failure', 'blocked', or error message */
  result: string;
  /** Duration of the action in milliseconds */
  durationMs: number;
  /** Machine identifier where the action originated */
  machineId: string;
}

// ============================================================================
// Security Violations (Discriminated Union)
// ============================================================================

/**
 * Base fields shared by all security violations.
 */
interface SecurityViolationBase {
  /** Timestamp of the violation (ISO 8601) */
  timestamp: string;
  /** Agent ID that triggered the violation */
  agentId: string;
  /** Human-readable description */
  message: string;
}

/**
 * Directory access violation: agent tried to access a path outside allowed directories.
 */
export interface DirectoryViolation extends SecurityViolationBase {
  type: 'directory';
  /** The path that was attempted */
  attemptedPath: string;
  /** The allowed directories */
  allowedDirs: string[];
}

/**
 * Tool usage violation: agent tried to use a disallowed tool.
 */
export interface ToolViolation extends SecurityViolationBase {
  type: 'tool';
  /** The tool that was attempted */
  toolName: string;
  /** Reason the tool is restricted */
  reason: string;
}

/**
 * Rate limit violation: agent exceeded rate limits.
 */
export interface RateLimitViolation extends SecurityViolationBase {
  type: 'rate_limit';
  /** The action type that was rate-limited */
  action: RateLimitAction;
  /** Current count in the window */
  currentCount: number;
  /** Maximum allowed in the window */
  maxAllowed: number;
  /** Milliseconds until retry is allowed */
  retryAfterMs: number;
}

/**
 * Authentication violation: invalid or expired token.
 */
export interface AuthViolation extends SecurityViolationBase {
  type: 'auth';
  /** Reason for authentication failure */
  reason: 'expired' | 'invalid' | 'revoked' | 'missing';
}

/**
 * Content validation violation: message content failed validation.
 */
export interface ContentViolation extends SecurityViolationBase {
  type: 'content';
  /** What failed validation */
  field: string;
  /** Reason for validation failure */
  reason: string;
}

/**
 * Discriminated union of all security violation types.
 * Use the `type` field to narrow.
 */
export type SecurityViolation =
  | DirectoryViolation
  | ToolViolation
  | RateLimitViolation
  | AuthViolation
  | ContentViolation;

// ============================================================================
// Validation Result
// ============================================================================

/**
 * Result of a validation check.
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Error messages if validation failed */
  errors: string[];
}

// ============================================================================
// Security Configuration
// ============================================================================

/**
 * Top-level security configuration for the agent communication system.
 */
export interface SecurityConfig {
  /** Allowed directories for agent file access */
  allowedDirs: string[];
  /** Default tool policies applied to all agents */
  defaultToolPolicies: ToolPolicy[];
  /** Per-agent tool policy overrides (agentId -> policies) */
  agentToolOverrides: Record<string, ToolPolicy[]>;
  /** Rate limiting configuration */
  rateLimits: RateLimitConfig;
  /** JWT authentication configuration */
  jwt: JWTConfig;
  /** Audit logging configuration */
  audit: AuditLogConfig;
  /** Maximum message content size in bytes (default: 102400 = 100KB) */
  maxMessageSize: number;
}

// ============================================================================
// Default Configuration Factory
// ============================================================================

/**
 * Create a SecurityConfig with sensible defaults.
 * Requires at minimum a JWT secret.
 *
 * @param jwtSecret - HMAC-SHA256 secret for JWT signing
 * @param allowedDirs - Optional list of allowed directories (defaults to empty)
 * @returns Complete SecurityConfig with defaults
 */
export function createDefaultSecurityConfig(
  jwtSecret: string,
  allowedDirs: string[] = [],
): SecurityConfig {
  return {
    allowedDirs,
    defaultToolPolicies: [],
    agentToolOverrides: {},
    rateLimits: {
      messagesPerMinute: 60,
      channelCreatesPerHour: 10,
      pasteCreatesPerHour: 100,
    },
    jwt: {
      secret: jwtSecret,
      expiryMs: 86_400_000, // 24 hours
      rotationIntervalMs: 43_200_000, // 12 hours
      revocationListTTL: 172_800_000, // 48 hours
    },
    audit: {
      batchSize: 50,
      flushIntervalMs: 30_000,
    },
    maxMessageSize: 102_400, // 100KB
  };
}
