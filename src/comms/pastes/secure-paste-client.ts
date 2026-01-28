/**
 * Secure Paste Client
 *
 * Wraps PasteClient with security enforcement:
 * - Rate limiting on create, read
 * - Content validation on create content
 * - Directory enforcement on paste content referencing file paths
 * - Audit logging on all mutations
 */

import type { SecurityManager } from '../security/security-manager';
import { SecurityMiddleware } from '../security/middleware';
import type { PasteClient } from './paste-client';
import type { PasteCompose, PasteFilter, PasteView } from './types';

// ============================================================================
// Secure Paste Client
// ============================================================================

/**
 * Security-wrapped paste client.
 *
 * Delegates all operations to the underlying PasteClient while
 * enforcing rate limits, validating content, enforcing directory
 * restrictions, and logging audits.
 *
 * @example
 * ```typescript
 * const secure = new SecurePasteClient(pasteClient, securityManager, 'agent-001');
 *
 * // Create is rate-limited, validated, directory-checked, and audited
 * await secure.create({
 *   content: 'Hello, world!',
 *   accessMode: 'ttl',
 *   ttlSeconds: 3600,
 * });
 * ```
 */
export class SecurePasteClient {
  private readonly inner: PasteClient;
  private readonly middleware: SecurityMiddleware;

  constructor(
    inner: PasteClient,
    security: SecurityManager,
    agentId: string,
    machineId?: string,
  ) {
    this.inner = inner;
    this.middleware = new SecurityMiddleware(security, agentId, machineId);
  }

  // ==========================================================================
  // Create (rate-limited + validated + directory-checked + audited)
  // ==========================================================================

  async create(compose: PasteCompose): Promise<PasteView> {
    this.middleware.checkAndRecord('paste_create');

    const sanitized = this.middleware.validateAndSanitize(compose.content);
    this.middleware.enforceDirectory(sanitized);

    const sanitizedCompose: PasteCompose = { ...compose, content: sanitized };

    const start = Date.now();
    try {
      const paste = await this.inner.create(sanitizedCompose);
      await this.middleware.audit({
        receiverId: compose.recipientId ?? '',
        command: `paste.create:${compose.contentType ?? 'text/plain'}`,
        result: 'success',
        durationMs: Date.now() - start,
      });
      return paste;
    } catch (error) {
      await this.middleware.audit({
        receiverId: compose.recipientId ?? '',
        command: `paste.create:${compose.contentType ?? 'text/plain'}`,
        result: `failure:${(error as Error).message}`,
        durationMs: Date.now() - start,
      });
      throw error;
    }
  }

  // ==========================================================================
  // Read (rate-limited + audited)
  // ==========================================================================

  async read(pasteId: string): Promise<PasteView> {
    this.middleware.checkAndRecord('message');

    const start = Date.now();
    try {
      const paste = await this.inner.read(pasteId);
      await this.middleware.audit({
        receiverId: pasteId,
        command: 'paste.read',
        result: 'success',
        durationMs: Date.now() - start,
      });
      return paste;
    } catch (error) {
      await this.middleware.audit({
        receiverId: pasteId,
        command: 'paste.read',
        result: `failure:${(error as Error).message}`,
        durationMs: Date.now() - start,
      });
      throw error;
    }
  }

  // ==========================================================================
  // Delete (audited)
  // ==========================================================================

  async delete(pasteId: string): Promise<void> {
    const start = Date.now();
    try {
      await this.inner.delete(pasteId);
      await this.middleware.audit({
        receiverId: pasteId,
        command: 'paste.delete',
        result: 'success',
        durationMs: Date.now() - start,
      });
    } catch (error) {
      await this.middleware.audit({
        receiverId: pasteId,
        command: 'paste.delete',
        result: `failure:${(error as Error).message}`,
        durationMs: Date.now() - start,
      });
      throw error;
    }
  }

  // ==========================================================================
  // Sharing (audited)
  // ==========================================================================

  async shareWith(pasteId: string, recipientId: string): Promise<PasteView> {
    this.middleware.checkAndRecord('paste_create');

    const start = Date.now();
    try {
      const paste = await this.inner.shareWith(pasteId, recipientId);
      await this.middleware.audit({
        receiverId: recipientId,
        command: `paste.share:${pasteId}`,
        result: 'success',
        durationMs: Date.now() - start,
      });
      return paste;
    } catch (error) {
      await this.middleware.audit({
        receiverId: recipientId,
        command: `paste.share:${pasteId}`,
        result: `failure:${(error as Error).message}`,
        durationMs: Date.now() - start,
      });
      throw error;
    }
  }

  // ==========================================================================
  // Read-only operations (pass-through)
  // ==========================================================================

  async list(filter?: PasteFilter): Promise<PasteView[]> {
    return this.inner.list(filter);
  }

  async getSharedWithMe(): Promise<PasteView[]> {
    return this.inner.getSharedWithMe();
  }

  async getMyPastes(): Promise<PasteView[]> {
    return this.inner.getMyPastes();
  }

  isExpired(paste: PasteView): boolean {
    return this.inner.isExpired(paste);
  }
}
