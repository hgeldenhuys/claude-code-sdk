/**
 * Secure Memo Client
 *
 * Wraps MemoClient with security enforcement:
 * - Rate limiting on compose, claim, reply
 * - Content validation on compose body
 * - Audit logging on all mutations
 */

import type { SecurityManager } from '../security/security-manager';
import { SecurityMiddleware } from '../security/middleware';
import type { MemoClient } from './memo-client';
import type {
  ClaimResult,
  MemoCompose,
  MemoFilter,
  MemoView,
  ThreadSummary,
} from './types';

// ============================================================================
// Secure Memo Client
// ============================================================================

/**
 * Security-wrapped memo client.
 *
 * Delegates all operations to the underlying MemoClient while
 * enforcing rate limits, validating content, and logging audits.
 *
 * @example
 * ```typescript
 * const secure = new SecureMemoClient(memoClient, securityManager, 'agent-001');
 *
 * // Compose is rate-limited, validated, and audited
 * await secure.compose({
 *   to: 'agent://mac-1/agent-002',
 *   subject: 'Build Results',
 *   body: 'All tests passed.',
 * });
 * ```
 */
export class SecureMemoClient {
  private readonly inner: MemoClient;
  private readonly middleware: SecurityMiddleware;

  constructor(
    inner: MemoClient,
    security: SecurityManager,
    agentId: string,
    machineId?: string,
  ) {
    this.inner = inner;
    this.middleware = new SecurityMiddleware(security, agentId, machineId);
  }

  // ==========================================================================
  // Compose (rate-limited + validated + audited)
  // ==========================================================================

  async compose(input: MemoCompose): Promise<MemoView> {
    this.middleware.checkAndRecord('message');

    const sanitizedBody = this.middleware.validateAndSanitize(input.body);
    const sanitizedInput: MemoCompose = { ...input, body: sanitizedBody };

    const start = Date.now();
    try {
      const memo = await this.inner.compose(sanitizedInput);
      await this.middleware.audit({
        receiverId: input.to,
        command: `memo.compose:${input.subject}`,
        result: 'success',
        durationMs: Date.now() - start,
      });
      return memo;
    } catch (error) {
      await this.middleware.audit({
        receiverId: input.to,
        command: `memo.compose:${input.subject}`,
        result: `failure:${(error as Error).message}`,
        durationMs: Date.now() - start,
      });
      throw error;
    }
  }

  // ==========================================================================
  // Claim (rate-limited + audited)
  // ==========================================================================

  async claim(memoId: string): Promise<ClaimResult> {
    this.middleware.checkAndRecord('message');

    const start = Date.now();
    try {
      const result = await this.inner.claim(memoId);
      await this.middleware.audit({
        receiverId: memoId,
        command: 'memo.claim',
        result: result.success ? 'success' : 'failure:already_claimed',
        durationMs: Date.now() - start,
      });
      return result;
    } catch (error) {
      await this.middleware.audit({
        receiverId: memoId,
        command: 'memo.claim',
        result: `failure:${(error as Error).message}`,
        durationMs: Date.now() - start,
      });
      throw error;
    }
  }

  // ==========================================================================
  // Reply (rate-limited + validated + audited)
  // ==========================================================================

  async reply(
    memoId: string,
    input: Omit<MemoCompose, 'to' | 'threadId'>,
  ): Promise<MemoView> {
    this.middleware.checkAndRecord('message');

    const sanitizedBody = this.middleware.validateAndSanitize(input.body);
    const sanitizedInput = { ...input, body: sanitizedBody };

    const start = Date.now();
    try {
      const memo = await this.inner.reply(memoId, sanitizedInput);
      await this.middleware.audit({
        receiverId: memoId,
        command: `memo.reply:${input.subject ?? '(reply)'}`,
        result: 'success',
        durationMs: Date.now() - start,
      });
      return memo;
    } catch (error) {
      await this.middleware.audit({
        receiverId: memoId,
        command: `memo.reply:${input.subject ?? '(reply)'}`,
        result: `failure:${(error as Error).message}`,
        durationMs: Date.now() - start,
      });
      throw error;
    }
  }

  // ==========================================================================
  // Read-only operations (pass-through)
  // ==========================================================================

  async inbox(options?: MemoFilter): Promise<MemoView[]> {
    return this.inner.inbox(options);
  }

  async outbox(options?: MemoFilter): Promise<MemoView[]> {
    return this.inner.outbox(options);
  }

  async getUnreadCount(): Promise<number> {
    return this.inner.getUnreadCount();
  }

  async read(memoId: string): Promise<MemoView> {
    return this.inner.read(memoId);
  }

  async archive(memoId: string): Promise<MemoView> {
    const start = Date.now();
    const memo = await this.inner.archive(memoId);
    await this.middleware.audit({
      receiverId: memoId,
      command: 'memo.archive',
      result: 'success',
      durationMs: Date.now() - start,
    });
    return memo;
  }

  async getThread(threadId: string): Promise<MemoView[]> {
    return this.inner.getThread(threadId);
  }

  async getThreadSummary(threadId: string): Promise<ThreadSummary> {
    return this.inner.getThreadSummary(threadId);
  }
}
