/**
 * JWT Token Manager
 *
 * HMAC-SHA256 JWT implementation for agent authentication.
 * Uses native crypto module -- no external JWT library needed.
 *
 * Token format: base64url(header).base64url(payload).base64url(signature)
 */

import { createHmac, randomUUID } from 'node:crypto';
import type { JWTConfig, JWTPayload } from './types';

// ============================================================================
// Base64url Helpers
// ============================================================================

/**
 * Encode a buffer or string to base64url (no padding).
 */
function base64urlEncode(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  return buf.toString('base64url');
}

/**
 * Decode a base64url string to a UTF-8 string.
 */
function base64urlDecode(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8');
}

// ============================================================================
// JWT Header (constant)
// ============================================================================

const JWT_HEADER = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

// ============================================================================
// JWT Manager
// ============================================================================

/**
 * Manages JWT tokens for agent authentication.
 *
 * Features:
 * - Create tokens with agentId, machineId, capabilities
 * - Validate tokens (signature, expiry, revocation)
 * - Refresh tokens within the rotation window
 * - Revoke tokens by JTI
 * - Auto-cleanup of expired revocation entries
 *
 * @example
 * ```typescript
 * const jwt = new JWTManager({
 *   secret: 'my-secret-key',
 *   expiryMs: 86_400_000,          // 24h
 *   rotationIntervalMs: 43_200_000, // 12h
 *   revocationListTTL: 172_800_000, // 48h
 * });
 *
 * const token = jwt.createToken('agent-001', 'mac-001', ['read', 'write']);
 * const payload = jwt.validateToken(token);
 * // { jti: '...', agentId: 'agent-001', ... }
 *
 * // Revoke a token
 * jwt.revokeToken(payload.jti);
 * jwt.validateToken(token); // null (revoked)
 *
 * // Refresh before expiry
 * const newToken = jwt.refreshToken(token);
 * ```
 */
export class JWTManager {
  private readonly config: JWTConfig;
  /** Map of revoked JTI -> revocation timestamp (ms) */
  private readonly revokedTokens: Map<string, number>;

  constructor(config: JWTConfig) {
    this.config = config;
    this.revokedTokens = new Map();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Create a new JWT token for an agent.
   *
   * @param agentId - Agent identifier
   * @param machineId - Machine identifier
   * @param capabilities - List of agent capabilities
   * @returns Signed JWT token string
   */
  createToken(agentId: string, machineId: string, capabilities: string[]): string {
    const now = Math.floor(Date.now() / 1000);

    const payload: JWTPayload = {
      jti: randomUUID(),
      agentId,
      machineId,
      capabilities,
      iat: now,
      exp: now + Math.floor(this.config.expiryMs / 1000),
    };

    return this.sign(payload);
  }

  /**
   * Validate a JWT token.
   *
   * Checks:
   * 1. Token format (3 parts, valid base64url)
   * 2. HMAC-SHA256 signature
   * 3. Expiration (exp claim)
   * 4. Revocation list
   *
   * @param token - JWT token string
   * @returns Decoded payload if valid, null if invalid
   */
  validateToken(token: string): JWTPayload | null {
    // Parse token parts
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [header, payloadStr, signature] = parts;
    if (!header || !payloadStr || !signature) {
      return null;
    }

    // Verify signature
    const expectedSignature = this.computeSignature(`${header}.${payloadStr}`);
    if (signature !== expectedSignature) {
      return null;
    }

    // Decode payload
    let payload: JWTPayload;
    try {
      payload = JSON.parse(base64urlDecode(payloadStr)) as JWTPayload;
    } catch {
      return null;
    }

    // Check required fields
    if (!payload.jti || !payload.agentId || !payload.exp || !payload.iat) {
      return null;
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      return null;
    }

    // Check revocation
    if (this.isRevoked(payload.jti)) {
      return null;
    }

    return payload;
  }

  /**
   * Refresh a token by creating a new one if the old token is still valid
   * and within the rotation window.
   *
   * The rotation window is the last `rotationIntervalMs` before expiry.
   * Tokens outside the rotation window cannot be refreshed (must wait).
   *
   * @param oldToken - Current JWT token
   * @returns New JWT token string, or null if the old token is invalid or not in rotation window
   */
  refreshToken(oldToken: string): string | null {
    const payload = this.validateToken(oldToken);
    if (!payload) {
      return null;
    }

    // Check if we're within the rotation window
    const now = Math.floor(Date.now() / 1000);
    const rotationWindowStart = payload.exp - Math.floor(this.config.rotationIntervalMs / 1000);

    if (now < rotationWindowStart) {
      // Not yet in the rotation window
      return null;
    }

    // Create new token with same identity
    return this.createToken(payload.agentId, payload.machineId, payload.capabilities);
  }

  /**
   * Revoke a token by its JTI.
   *
   * @param jti - Token identifier to revoke
   */
  revokeToken(jti: string): void {
    this.revokedTokens.set(jti, Date.now());
  }

  /**
   * Check if a token JTI is in the revocation list.
   *
   * @param jti - Token identifier to check
   * @returns true if the token is revoked
   */
  isRevoked(jti: string): boolean {
    return this.revokedTokens.has(jti);
  }

  /**
   * Remove expired entries from the revocation list.
   *
   * Entries older than `revocationListTTL` are removed.
   */
  cleanupRevocationList(): void {
    const cutoff = Date.now() - this.config.revocationListTTL;

    for (const [jti, timestamp] of this.revokedTokens) {
      if (timestamp < cutoff) {
        this.revokedTokens.delete(jti);
      }
    }
  }

  /**
   * Extract the JTI from a token without full validation.
   *
   * Useful for revocation when the token may already be expired.
   *
   * @param token - JWT token string
   * @returns JTI string, or null if token cannot be parsed
   */
  getTokenId(token: string): string | null {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) {
      return null;
    }

    try {
      const payload = JSON.parse(base64urlDecode(parts[1])) as Partial<JWTPayload>;
      return payload.jti ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get the current size of the revocation list (for diagnostics).
   */
  get revocationListSize(): number {
    return this.revokedTokens.size;
  }

  // ==========================================================================
  // Internal Helpers
  // ==========================================================================

  /**
   * Sign a payload and produce a complete JWT token string.
   */
  private sign(payload: JWTPayload): string {
    const payloadStr = base64urlEncode(JSON.stringify(payload));
    const data = `${JWT_HEADER}.${payloadStr}`;
    const signature = this.computeSignature(data);
    return `${data}.${signature}`;
  }

  /**
   * Compute HMAC-SHA256 signature for a data string.
   */
  private computeSignature(data: string): string {
    return createHmac('sha256', this.config.secret)
      .update(data)
      .digest('base64url');
  }
}
